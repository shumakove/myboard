// Приёмка T7.1 · изображения: IMG-01…07; попутно CVS-20 (копирование между досками), SHR-04, MOB-01, ARCH.
// Сценарии — docs/qa/reports/T7.1.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T7.1.
// Наблюдение: DOM холста и панели, документ доски глазами позднего клиента по /api/ws, второй клиент,
// пиксели картинок, прочитанные браузером. Код из apps/ не импортируется.
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, dragBy, openGuest, openOwner, profileOpts, type Opts } from './camera';
import { allObjects, boxOf, centerOf, obj, onCanvas, seed, selectionBar, tool, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

// ---------- интерфейс (подписи из handoff T7.1) ----------

const images = (page: Page) => page.locator('[data-object-id][data-type="image"]');
const barBtn = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const barSelect = (page: Page, name: string) => selectionBar(page).locator(`xpath=.//label[normalize-space(text())="${name}"]//select`).first();
const imgOf = (page: Page, id: string) => obj(page, id).locator('img.image-source');

type Raw = Record<string, Record<string, unknown>>;
const rawObjects = async (page: Page, boardId: string) => (await docSeenByLateClient(page, `board=${boardId}`)).getMap('objects').toJSON() as Raw;
async function untilRaw(page: Page, boardId: string, check: (o: Raw) => void, timeout = 15_000): Promise<Raw> {
  let last: Raw = {};
  await expect(async () => {
    last = await rawObjects(page, boardId);
    check(last);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}
const ofType = (o: Raw, t: string) => Object.entries(o).filter(([, v]) => v.type === t);
const ids = async (l: ReturnType<Page['locator']>) => (await l.evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();

/** PNG, нарисованный в браузере: фон `bg`, в центре квадрат `fg` на половину стороны. */
async function pngOf(page: Page, w: number, h: number, bg: string, fg = '#000000'): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ w, h, bg, fg }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = fg;
      g.fillRect(w / 4, h / 4, w / 2, h / 2);
      return c.toDataURL('image/png').split(',')[1];
    },
    { w, h, bg, fg },
  );
  return Buffer.from(b64, 'base64');
}

/** Анимированный GIF 64×64 из двух кадров (красный и синий пиксель 1×1 в углу, остальное — фон). */
function animatedGif(): Buffer {
  const frame = (pixel: number) => [0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0x02, 0x02, pixel === 0 ? 0x44 : 0x4c, 0x01, 0x00];
  return Buffer.from([
    ...Buffer.from('GIF89a'),
    64, 0, 64, 0, 0x80, 0, 0,
    0xff, 0, 0, 0, 0, 0xff,
    0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00,
    ...frame(0),
    ...frame(1),
    0x3b,
  ]);
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" onload="document.title=\'pwned-onload\'">' +
    '<rect width="120" height="80" fill="#2e7d32"/><circle cx="60" cy="40" r="20" fill="#fdd835"/>' +
    "<script>document.title='pwned-script'</script></svg>",
);

/** Загрузка через All tools → Image (выбор файла), как это делает пользователь. */
async function uploadViaTool(page: Page, file: { name: string; mimeType: string; buffer: Buffer }, isMobile = false): Promise<string> {
  const before = new Set(await ids(images(page)));
  await page.keyboard.press('Escape');
  const chooser = page.waitForEvent('filechooser');
  if (isMobile) {
    await tool(page, 'All tools').tap();
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Image', exact: true }).tap();
  } else {
    await tool(page, 'All tools').click();
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Image', exact: true }).click();
  }
  await (await chooser).setFiles(file);
  await expect.poll(async () => (await ids(images(page))).filter((x) => !before.has(x)).length, { timeout: 20_000 }).toBe(1);
  return (await ids(images(page))).find((x) => !before.has(x))!;
}

/** Картинка объекта загружена браузером (не «Image unavailable»). */
async function expectLoaded(page: Page, id: string) {
  await expect(obj(page, id).getByText('Image unavailable')).toHaveCount(0);
  await expect.poll(async () => obj(page, id).locator('img.image-source, canvas').first().evaluate((e) => (e instanceof HTMLImageElement ? e.complete && e.naturalWidth > 0 : (e as HTMLCanvasElement).width > 0)), { timeout: 15_000 }).toBe(true);
}

/** Пиксели файла media (читает браузер страницы со своей сессией): RGBA в долях ширины/высоты. */
async function pixelsOf(page: Page, mediaId: string, points: [number, number][]): Promise<number[][]> {
  return page.evaluate(
    async ({ url, points }) => {
      const blob = await (await fetch(url, { credentials: 'same-origin' })).blob();
      const bmp = new Image();
      bmp.src = URL.createObjectURL(blob);
      await bmp.decode();
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const g = c.getContext('2d')!;
      g.drawImage(bmp, 0, 0);
      return points.map(([fx, fy]) => [...g.getImageData(Math.min(bmp.width - 1, Math.floor(bmp.width * fx)), Math.min(bmp.height - 1, Math.floor(bmp.height * fy)), 1, 1).data]);
    },
    { url: `/api/media/${mediaId}`, points },
  );
}

async function selectOnly(page: Page, id: string) {
  await page.keyboard.press('Escape');
  const b = await boxOf(obj(page, id));
  await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

const mediaOf = (o: Record<string, unknown>) => String(o.media);
const noDataUrls = (o: Raw) => expect(JSON.stringify(o)).not.toContain('data:');

async function owner2(browser: Browser, f: Fx, guestName = 'QA Guest') {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, guestName);
  return { owner, guest, opts: o };
}

// ---------- IMG-01 ----------

test('IMG-01 ARCH upload from device creates an image object referencing /api/media; second client and reload see it; no data URL in the document', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  try {
    const png = await pngOf(page, 640, 320, '#e53935');
    const id = await uploadViaTool(page, { name: 'qa.png', mimeType: 'image/png', buffer: png });
    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.media).toBeTruthy());
    noDataUrls(doc);
    expect(doc[id].type).toBe('image');
    const media = mediaOf(doc[id]);
    await expect(imgOf(page, id)).toHaveAttribute('src', new RegExp(`/api/media/${media}$`));
    await expectLoaded(page, id);
    // пропорции файла 2:1
    const b = await boxOf(obj(page, id));
    expect(Math.abs(b.width / b.height - 2)).toBeLessThan(0.05);
    // файл на сервере — те же байты
    const got = await page.request.get(`/api/media/${media}`);
    expect(got.status()).toBe(200);
    expect(Buffer.compare(await got.body(), png)).toBe(0);
    // второй клиент (участник по ссылке) и перезагрузка
    await expect(obj(guest.page, id)).toBeAttached();
    await expectLoaded(guest.page, id);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expectLoaded(page, id);
    expect(requests.filter((u) => /localhost|127\.0\.0\.1/.test(u))).toEqual([]);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('IMG-01 image pasted from the clipboard becomes an image object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const png = await pngOf(page, 200, 200, '#43a047');
    const p = await onCanvas(page, 0.5, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.evaluate((b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, png.toString('base64'));
    await expect(images(page)).toHaveCount(1, { timeout: 20_000 });
    const id = (await ids(images(page)))[0];
    await expectLoaded(page, id);
    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.media).toBeTruthy());
    noDataUrls(doc);
    await expectLoaded(guest.page, id);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('IMG-01 SHR-04 participant by link uploads an image; owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const png = await pngOf(guest.page, 300, 300, '#1e88e5');
    const id = await uploadViaTool(guest.page, { name: 'guest.png', mimeType: 'image/png', buffer: png });
    await expectLoaded(guest.page, id);
    await expect(obj(owner.page, id)).toBeAttached();
    await expectLoaded(owner.page, id);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('IMG-01 non-image file is refused with a message and creates no object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await page.keyboard.press('Escape');
    const chooser = page.waitForEvent('filechooser');
    await tool(page, 'All tools').click();
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Image', exact: true }).click();
    await (await chooser).setFiles({ name: 'evil.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
    await expect(page.getByRole('alert').filter({ hasText: /not supported|not an image/i })).toBeVisible();
    await page.waitForTimeout(1000);
    await expect(images(page)).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

// ---------- IMG-02 ----------

test('IMG-02 crop, shape mask and rounded corners; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'crop.png', mimeType: 'image/png', buffer: await pngOf(page, 400, 400, '#fb8c00') });
    await expectLoaded(page, id);
    await selectOnly(page, id);
    const before = await boxOf(obj(page, id));

    // обрезка: правая сторона рамки обрезки влево на четверть
    await barBtn(page, 'Crop').click();
    await expect(page.getByLabel('Crop area')).toBeVisible();
    const eb = await boxOf(page.getByLabel('Crop e', { exact: true }));
    await dragBy(page, centerOf(eb), { x: -before.width / 4, y: 0 });
    await page.getByRole('button', { name: 'Done cropping', exact: true }).click();
    const cropped = await untilRaw(page, owner.boardId, (o) => {
      const c = o[id]?.crop as { width: number } | undefined;
      expect(c && c.width).toBeLessThan(0.9);
    });
    const after = await boxOf(obj(page, id));
    expect(after.width).toBeLessThan(before.width * 0.9);

    // маска и скругление
    await selectOnly(page, id);
    await barSelect(page, 'Mask').selectOption({ label: 'Circle' });
    await untilRaw(page, owner.boardId, (o) => expect(o[id]?.mask).toBe('circle'));
    await expect(obj(page, id).locator('.image-view')).toHaveAttribute('data-mask', 'circle');
    const clip = await obj(page, id).locator('.image-clip').evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip).not.toBe('none');
    await barSelect(page, 'Mask').selectOption({ label: 'Star' });
    await untilRaw(page, owner.boardId, (o) => expect(o[id]?.mask).toBe('star'));
    await barSelect(page, 'Mask').selectOption({ label: 'None' });
    await barSelect(page, 'Corners').selectOption({ label: '24' });
    const doc = await untilRaw(page, owner.boardId, (o) => {
      expect(o[id]?.mask).toBe('none');
      expect(JSON.stringify(o[id])).toContain('24');
    });
    await expect.poll(() => obj(page, id).locator('.image-clip').evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px');
    expect(doc[id].crop).toEqual(cropped[id].crop);

    // второй клиент и перезагрузка — та же обрезка и скругление
    for (const p of [guest.page, page]) {
      if (p === page) await p.reload();
      await expectLoaded(p, id);
      const b = await boxOf(obj(p, id));
      expect(Math.abs(b.width / b.height - after.width / after.height)).toBeLessThan(0.05);
      await expect.poll(() => obj(p, id).locator('.image-clip').evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).not.toBe('0px');
    }
    // маска у второго клиента
    await selectOnly(page, id);
    await barSelect(page, 'Mask').selectOption({ label: 'Hexagon' });
    await expect(obj(guest.page, id).locator('.image-view')).toHaveAttribute('data-mask', 'hexagon');
  } finally {
    await owner.close();
    await guest.close();
  }
});

// ---------- IMG-03 ----------

test('IMG-03 border colour and width; flip horizontally and vertically, twice returns; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'flip.png', mimeType: 'image/png', buffer: await pngOf(page, 300, 200, '#8e24aa') });
    await expectLoaded(page, id);
    await selectOnly(page, id);
    const border = barSelect(page, 'Border');
    const opts = await border.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    expect(opts.length).toBeGreaterThan(1);
    await border.selectOption(opts[1]);
    await barSelect(page, 'Border width').selectOption({ label: '6' });
    await untilRaw(page, owner.boardId, (o) => {
      expect(o[id]?.style ?? o[id]).toBeTruthy();
      const s = JSON.stringify(o[id]);
      expect(s).toContain(opts[1]);
      expect(s).toMatch(/"strokeWidth":6/);
    });
    await expect(obj(page, id).locator('.image-stroke')).toBeVisible();
    await expect(obj(guest.page, id).locator('.image-stroke')).toBeVisible();

    const flipT = (p: Page) => obj(p, id).locator('.image-flip').evaluate((el) => getComputedStyle(el).transform);
    expect(await flipT(page)).toMatch(/none|matrix\(1, 0, 0, 1/);
    await barBtn(page, 'Flip horizontal').click();
    await untilRaw(page, owner.boardId, (o) => expect(o[id]?.flipX).toBe(true));
    await expect.poll(() => flipT(page)).toMatch(/^matrix\(-1, 0, 0, 1/);
    await expect.poll(() => flipT(guest.page)).toMatch(/^matrix\(-1, 0, 0, 1/);
    await barBtn(page, 'Flip vertical').click();
    await untilRaw(page, owner.boardId, (o) => expect(o[id]?.flipY).toBe(true));
    await expect.poll(() => flipT(page)).toMatch(/^matrix\(-1, 0, 0, -1/);
    await page.reload();
    await expectLoaded(page, id);
    await expect.poll(() => flipT(page)).toMatch(/^matrix\(-1, 0, 0, -1/);
    await expect(obj(page, id).locator('.image-stroke')).toBeVisible();
    await selectOnly(page, id);
    await barBtn(page, 'Flip horizontal').click();
    await barBtn(page, 'Flip vertical').click();
    await untilRaw(page, owner.boardId, (o) => {
      expect(Boolean(o[id]?.flipX)).toBe(false);
      expect(Boolean(o[id]?.flipY)).toBe(false);
    });
    await expect.poll(() => flipT(guest.page)).toMatch(/none|matrix\(1, 0, 0, 1/);
  } finally {
    await owner.close();
    await guest.close();
  }
});

// ---------- IMG-04 ----------

test('IMG-04 replace image keeps crop, position and width; second client sees the new file', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'one.png', mimeType: 'image/png', buffer: await pngOf(page, 400, 400, '#ff0000') });
    await expectLoaded(page, id);
    await selectOnly(page, id);
    const b0 = await boxOf(obj(page, id));
    await barBtn(page, 'Crop').click();
    await dragBy(page, centerOf(await boxOf(page.getByLabel('Crop s', { exact: true }))), { x: 0, y: -b0.height / 3 });
    await page.getByRole('button', { name: 'Done cropping', exact: true }).click();
    const before = await untilRaw(page, owner.boardId, (o) => expect((o[id]?.crop as { height: number }).height).toBeLessThan(0.8));
    const b1 = await boxOf(obj(page, id));

    await selectOnly(page, id);
    const chooser = page.waitForEvent('filechooser');
    await barBtn(page, 'Replace image').click();
    await (await chooser).setFiles({ name: 'two.png', mimeType: 'image/png', buffer: await pngOf(page, 400, 400, '#0000ff') });
    const after = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.media).not.toBe(before[id].media));
    expect(after[id].crop).toEqual(before[id].crop);
    expect(after[id].x).toBeCloseTo(Number(before[id].x), 0);
    expect(after[id].width).toBeCloseTo(Number(before[id].width), 0);
    const b2 = await boxOf(obj(page, id));
    expect(Math.abs(b2.width - b1.width)).toBeLessThan(2);
    expect(Math.abs(b2.height - b1.height)).toBeLessThan(2);
    // новый файл — синий
    const px = await pixelsOf(page, mediaOf(after[id]), [[0.05, 0.05]]);
    expect(px[0].slice(0, 3)).toEqual([0, 0, 255]);
    await expect(imgOf(guest.page, id)).toHaveAttribute('src', new RegExp(String(after[id].media)));
    await expectLoaded(guest.page, id);
  } finally {
    await owner.close();
    await guest.close();
  }
});

// ---------- IMG-05 ----------

test('IMG-05 remove background from the selection menu makes a plain background transparent and keeps the subject; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'bg.png', mimeType: 'image/png', buffer: await pngOf(page, 200, 200, '#ffffff', '#d32f2f') });
    await expectLoaded(page, id);
    const before = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.media).toBeTruthy());
    const orig = await pixelsOf(page, mediaOf(before[id]), [[0.02, 0.02], [0.5, 0.5]]);
    expect(orig[0][3]).toBe(255);
    await selectOnly(page, id);
    await barBtn(page, 'Remove background').click();
    const after = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.media).not.toBe(before[id].media), 30_000);
    const px = await pixelsOf(page, mediaOf(after[id]), [[0.02, 0.02], [0.98, 0.98], [0.02, 0.98], [0.5, 0.5]]);
    for (const corner of px.slice(0, 3)) expect(corner[3]).toBe(0);
    expect(px[3][3]).toBe(255);
    expect(px[3].slice(0, 3)).toEqual([0xd3, 0x2f, 0x2f]);
    await expect(imgOf(guest.page, id)).toHaveAttribute('src', new RegExp(String(after[id].media)));
    await page.reload();
    await expect(imgOf(page, id)).toHaveAttribute('src', new RegExp(String(after[id].media)));
    await expectLoaded(page, id);
  } finally {
    await owner.close();
    await guest.close();
  }
});

// ---------- IMG-06 ----------

test('IMG-06 GIF is shown and plays; with many objects on screen it is still and plays on hover', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'anim.gif', mimeType: 'image/gif', buffer: animatedGif() });
    const view = obj(page, id).locator('.image-view');
    await expect(view).toHaveAttribute('data-playing', 'true');
    await expectLoaded(page, id);
    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.mime).toBe('image/gif'));
    noDataUrls(doc);

    // много объектов на экране: 60 мелких фигур в видимой части
    const items: Record<string, Obj> = {};
    for (let i = 0; i < 60; i++) items[`qa-m${i}`] = { type: 'shape', x: (i % 12) * 30, y: 380 + Math.floor(i / 12) * 30, width: 20, height: 20 };
    await seed(page, owner.boardId, items);
    await page.keyboard.press('Escape');
    await page.mouse.move(2, 2);
    await expect(view).toHaveAttribute('data-playing', 'false');
    await expect(obj(page, id).locator('canvas')).toHaveCount(1);
    const b = await boxOf(obj(page, id));
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await expect(view).toHaveAttribute('data-playing', 'true');
    await expect(imgOf(page, id)).toHaveCount(1);
    await page.mouse.move(2, 2);
    await expect(view).toHaveAttribute('data-playing', 'false');
  } finally {
    await owner.close();
  }
});

// ---------- IMG-07 ----------

test('IMG-07 SVG is uploaded as an image; opened directly from /api/media it runs no script', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'pic.svg', mimeType: 'image/svg+xml', buffer: SVG });
    await expectLoaded(page, id);
    await expectLoaded(guest.page, id);
    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[id]?.mime).toBe('image/svg+xml'));
    const b = await boxOf(obj(page, id));
    expect(Math.abs(b.width / b.height - 1.5)).toBeLessThan(0.05);
    expect(await page.title()).not.toMatch(/pwned/);
    // картинка нарисована: центр — жёлтый круг
    const px = await pixelsOf(page, mediaOf(doc[id]), [[0.5, 0.5]]);
    expect(px[0][3]).toBe(255);

    // открыть файл напрямую во вкладке и во фрейме страницы того же сайта
    const direct = await page.context().newPage();
    let dialogs = 0;
    direct.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    const resp = await direct.goto(`/api/media/${mediaOf(doc[id])}`);
    expect(resp?.status()).toBe(200);
    await direct.waitForTimeout(800);
    expect(await direct.title()).not.toMatch(/pwned/);
    await direct.goto('/');
    await direct.evaluate((url) => {
      const f = document.createElement('iframe');
      f.id = 'qa-frame';
      f.src = url;
      document.body.appendChild(f);
    }, `/api/media/${mediaOf(doc[id])}`);
    await direct.waitForTimeout(1500);
    const framed = direct.frames().find((f) => f.url().includes('/api/media/'));
    if (framed) {
      const t = await framed.evaluate(() => document.title).catch(() => 'blocked');
      expect(t).not.toMatch(/pwned/);
    }
    expect(dialogs).toBe(0);
    await direct.close();
  } finally {
    await owner.close();
    await guest.close();
  }
});

// ---------- CVS-20 × изображения ----------

test('CVS-20 IMG-01 image copied to another board of the user is shown to a participant by link of that board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const page = owner.page;
  let guest: Awaited<ReturnType<typeof openGuest>> | null = null;
  try {
    const id = await uploadViaTool(page, { name: 'copy.png', mimeType: 'image/png', buffer: await pngOf(page, 300, 200, '#00897b') });
    await expectLoaded(page, id);
    await selectOnly(page, id);
    await page.keyboard.press('ControlOrMeta+C');
    const board2 = await owner.newBoard();
    await page.goto(`/boards/${board2}`);
    await expect(canvas(page)).toBeVisible();
    const P = await onCanvas(page, 0.5, 0.5);
    await page.mouse.click(P.x, P.y);
    await page.keyboard.press('ControlOrMeta+V');
    await expect(images(page)).toHaveCount(1, { timeout: 15_000 });
    const copy = (await ids(images(page)))[0];
    await expectLoaded(page, copy);

    const share = await page.request.get(`/api/boards/${board2}/share`);
    const token2 = ((await share.json()) as { token: string }).token;
    guest = await openGuest(browser, o, token2, 'QA Guest B');
    await expect(obj(guest.page, copy)).toBeAttached();
    await expectLoaded(guest.page, copy);
  } finally {
    await owner.close();
    if (guest) await guest.close();
  }
});

test('CVS-20 IMG-01 image copied to another board survives deletion of the source board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'copy.png', mimeType: 'image/png', buffer: await pngOf(page, 300, 200, '#6d4c41') });
    await expectLoaded(page, id);
    await selectOnly(page, id);
    await page.keyboard.press('ControlOrMeta+C');
    const board2 = await owner.newBoard();
    await page.goto(`/boards/${board2}`);
    await expect(canvas(page)).toBeVisible();
    const P = await onCanvas(page, 0.5, 0.5);
    await page.mouse.click(P.x, P.y);
    await page.keyboard.press('ControlOrMeta+V');
    await expect(images(page)).toHaveCount(1, { timeout: 15_000 });
    const copy = (await ids(images(page)))[0];
    expect((await page.request.delete(`/api/boards/${owner.boardId}`)).status()).toBeLessThan(300);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expectLoaded(page, copy);
  } finally {
    await owner.close();
  }
});

// ---------- MOB-01 ----------

test('IMG-01 MOB-01 image upload works by touch at phone width; participant sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const { owner, guest } = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const id = await uploadViaTool(page, { name: 'phone.png', mimeType: 'image/png', buffer: await pngOf(page, 240, 240, '#3949ab') }, true);
    await expectLoaded(page, id);
    await expectLoaded(guest.page, id);
    await expect(allObjects(page)).toHaveCount(1);
  } finally {
    await owner.close();
    await guest.close();
  }
});

