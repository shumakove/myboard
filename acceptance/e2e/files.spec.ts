// Приёмка T7.2 · файлы, PDF, видео, аудио: FIL-01…05; попутно IMG-06, CVS-20, SHR-04, MOB-01, ARCH.
// Сценарии — docs/qa/reports/T7.2.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T7.2.
// Встроенный Chromium из Playwright не содержит H.264 и AAC, а FIL-03/FIL-04 требуют mp4, m4v, mov, m4a,
// поэтому весь файл идёт в установленном Chrome (channel: 'chrome').
// Наблюдение: DOM холста, свойства <video>/<audio>, пиксели canvas страницы PDF, документ доски глазами
// позднего клиента по /api/ws, второй клиент, кадры канала. Код из apps/ не импортируется.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Download, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, dragBy, minimap, openGuest, openOwner, profileOpts, Touch, type Opts } from './camera';
import { allObjects, boxOf, handle, obj, onCanvas, seed, selectionBar, tool, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
type Raw = Record<string, Record<string, unknown>>;
type FilePayload = { name: string; mimeType: string; buffer: Buffer };

test.use({ channel: 'chrome', actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(180_000));

const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'media-fixtures');
const fixture = (file: string, mimeType: string, name = file): FilePayload => ({ name, mimeType, buffer: readFileSync(join(FIXTURES, file)) });

const VIDEOS: [string, string][] = [
  ['sample.mp4', 'video/mp4'],
  ['sample.m4v', 'video/x-m4v'],
  ['sample.mov', 'video/quicktime'],
  ['sample.webm', 'video/webm'],
];
const AUDIOS: [string, string][] = [
  ['tone.mp3', 'audio/mpeg'],
  ['tone.m4a', 'audio/mp4'],
  ['tone.wav', 'audio/wav'],
  ['tone.webm', 'audio/webm'],
];

// ---------- PDF: страницы разного цвета, у каждой свой текст ----------

const PAGE_COLORS: [number, number, number][] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

function pdfOf(colors: [number, number, number][]): Buffer {
  const pages = colors.length;
  const objects: string[] = [];
  const kids = colors.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`;
  colors.forEach(([r, g, b], i) => {
    const content = `${r} ${g} ${b} rg 0 0 300 400 re f`;
    objects[2 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents ${4 + i * 2} 0 R /Resources << >> >>`;
    objects[3 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const pdf3 = (name = 'book.pdf'): FilePayload => ({ name, mimeType: 'application/pdf', buffer: pdfOf(PAGE_COLORS) });

/** Цвет центра страницы на canvas объекта PDF; канал доминирует, если он заметно ярче других. */
async function pageColor(page: Page, id: string): Promise<'red' | 'green' | 'blue' | 'blank'> {
  return obj(page, id).locator('canvas').first().evaluate((c) => {
    const el = c as HTMLCanvasElement;
    if (!el.width || !el.height) return 'blank' as const;
    const [r, g, b] = el.getContext('2d')!.getImageData(el.width >> 1, el.height >> 1, 1, 1).data;
    if (r > 200 && g < 80 && b < 80) return 'red' as const;
    if (g > 200 && r < 80 && b < 80) return 'green' as const;
    if (b > 200 && r < 80 && g < 80) return 'blue' as const;
    return 'blank' as const;
  });
}

const expectPageColor = (page: Page, id: string, color: 'red' | 'green' | 'blue') =>
  expect.poll(() => pageColor(page, id), { timeout: 20_000 }).toBe(color);

// ---------- интерфейс (подписи из handoff T7.2) ----------

const ofKind = (page: Page, kind: string) => page.locator(`[data-object-id][data-type="${kind}"]`);
const barBtn = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const idsOf = async (l: Locator) => (await l.evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();

async function rawObjects(page: Page, boardId: string) {
  return (await docSeenByLateClient(page, `board=${boardId}`)).getMap('objects').toJSON() as Raw;
}
async function untilRaw(page: Page, boardId: string, check: (o: Raw) => void, timeout = 15_000): Promise<Raw> {
  let last: Raw = {};
  await expect(async () => {
    last = await rawObjects(page, boardId);
    check(last);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}

/** Загрузка через input «Upload file» (handoff: тот же путь, что и выбор файла инструментом File). */
async function upload(page: Page, file: FilePayload | string, kind: string): Promise<string> {
  const before = new Set(await idsOf(ofKind(page, kind)));
  await page.getByLabel('Upload file', { exact: true }).setInputFiles(file);
  let found = '';
  await expect
    .poll(
      async () => {
        found = (await idsOf(ofKind(page, kind))).find((x) => !before.has(x)) ?? '';
        return found;
      },
      { timeout: 25_000 },
    )
    .not.toBe('');
  return found;
}

/** Выделить объект щелчком по его краю (центр занят плеером у видео и аудио). */
async function selectObj(page: Page, id: string, isMobile = false) {
  await page.keyboard.press('Escape').catch(() => {});
  const b = await boxOf(obj(page, id));
  const p = { x: b.x + b.width / 2, y: b.y + Math.min(14, b.height / 4) };
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

const fileNameField = (page: Page) => selectionBar(page).getByLabel('File name', { exact: true });
const mediaEl = (page: Page, id: string) => obj(page, id).locator('video, audio').first();
const player = (page: Page, id: string) => obj(page, id).locator('.media-player');
const control = (page: Page, id: string, name: string) => obj(page, id).getByRole('button', { name, exact: true });
const slider = (page: Page, id: string, name: string) => obj(page, id).getByLabel(name, { exact: true });
const speed = (page: Page, id: string) => obj(page, id).locator('xpath=.//label[normalize-space(text())="Speed"]//select').first();

const media = <T>(page: Page, id: string, read: (m: HTMLMediaElement) => T) =>
  mediaEl(page, id).evaluate(read as (e: SVGElement | HTMLElement) => T);
const currentTime = (page: Page, id: string) => media(page, id, (m) => m.currentTime);
const isPaused = (page: Page, id: string) => media(page, id, (m) => m.paused);

async function expectAdvancing(page: Page, id: string) {
  const start = await currentTime(page, id);
  await expect.poll(() => currentTime(page, id), { timeout: 15_000 }).toBeGreaterThan(start + 0.15);
}

async function startPlaying(page: Page, id: string, isMobile = false) {
  const button = control(page, id, 'Play');
  if (isMobile) await button.tap();
  else await button.click();
  await expect(player(page, id)).toHaveAttribute('data-playing', 'true');
  await expectAdvancing(page, id);
}

async function setSlider(page: Page, id: string, name: string, value: number) {
  await slider(page, id, name).fill(String(value));
}

async function owner2(browser: Browser, f: Fx, guestName = 'QA Guest') {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, guestName);
  return {
    o,
    owner,
    guest,
    close: async () => {
      await guest.close();
      await owner.close();
    },
  };
}

// ---------- FIL-01 ----------

for (const [name, mimeType] of [
  ['notes.txt', 'text/plain'],
  ['report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['archive.zip', 'application/zip'],
  ['noextension', ''],
] as const) {
  test(`FIL-01 ${name} is uploaded and shown as a file label to a second client and after reload`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    try {
      const id = await upload(s.owner.page, { name, mimeType, buffer: Buffer.from('hello from qa') }, 'file');
      for (const page of [s.owner.page, s.guest.page]) await expect(obj(page, id)).toContainText(name, { timeout: 15_000 });
      const doc = await untilRaw(s.owner.page, s.owner.boardId, (o) => expect(o[id]?.name).toBe(name));
      expect(doc[id].type).toBe('file');
      expect(JSON.stringify(doc)).not.toContain('data:');
      await s.owner.page.reload();
      await expect(obj(s.owner.page, id)).toContainText(name, { timeout: 15_000 });
    } finally {
      await s.close();
    }
  });
}

test('FIL-01 tool File opens file choice and creates a label', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await tool(page, 'All tools').click();
    const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'File', exact: true }).click();
    await (await chooser).setFiles({ name: 'chosen.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await expect(ofKind(page, 'file')).toHaveCount(1, { timeout: 20_000 });
    await expect(ofKind(page, 'file')).toContainText('chosen.txt');
  } finally {
    await owner.close();
  }
});

test('FIL-01 rename is seen by the second client and after reload; download keeps bytes and uses the new name', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = s.owner.page;
  try {
    const bytes = Buffer.from('content of the renamed file');
    const id = await upload(page, { name: 'old-name.txt', mimeType: 'text/plain', buffer: bytes }, 'file');
    await selectObj(page, id);
    await fileNameField(page).fill('Новое имя.txt');
    await page.keyboard.press('Enter');
    await expect(obj(page, id)).toContainText('Новое имя.txt');
    await expect(obj(s.guest.page, id)).toContainText('Новое имя.txt', { timeout: 15_000 });
    await untilRaw(page, s.owner.boardId, (o) => expect(o[id]?.name).toBe('Новое имя.txt'));

    await page.reload();
    await expect(obj(page, id)).toContainText('Новое имя.txt', { timeout: 15_000 });
    await selectObj(page, id);
    const [dl] = await Promise.all([page.waitForEvent('download'), selectionBar(page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect((dl as Download).suggestedFilename()).toBe('Новое имя.txt');
    expect(readFileSync(await (dl as Download).path())).toEqual(bytes);
    // холст не уходит со страницы
    await expect(canvas(page)).toBeVisible();
  } finally {
    await s.close();
  }
});

test('FIL-01 empty and blank name do not replace the file name', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, { name: 'keep.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, 'file');
    await selectObj(page, id);
    for (const blank of ['', '   ']) {
      await fileNameField(page).fill(blank);
      await fileNameField(page).blur();
      await page.waitForTimeout(600);
      const doc = await rawObjects(page, owner.boardId);
      expect(String(doc[id].name).trim(), `имя после ввода «${blank}»`).toBe('keep.txt');
      await expect(obj(page, id)).toContainText('keep.txt');
    }
    await selectObj(page, id);
    const [dl] = await Promise.all([page.waitForEvent('download'), selectionBar(page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe('keep.txt');
  } finally {
    await owner.close();
  }
});

test('FIL-01 long name and special characters keep the label inside its object and download works', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const long = `${'very-long-name-'.repeat(12)}.txt`;
    const id = await upload(page, { name: long, mimeType: 'text/plain', buffer: Buffer.from('x') }, 'file');
    const frame = await boxOf(obj(page, id));
    const overflow = await obj(page, id).evaluate((e) => {
      const r = e.getBoundingClientRect();
      return [...e.querySelectorAll('*')].some((c) => {
        const q = c.getBoundingClientRect();
        return getComputedStyle(c).overflow === 'visible' && q.width > 0 && q.right > r.right + 2 && (c as HTMLElement).clientWidth > 0 && !c.closest('[data-handle]');
      });
    });
    expect(overflow, 'длинное имя вышло за рамку ярлыка').toBe(false);
    expect(frame.width).toBeLessThan(700);

    await selectObj(page, id);
    await fileNameField(page).fill('a "quoted" name; ../x.txt');
    await fileNameField(page).blur();
    const [dl] = await Promise.all([page.waitForEvent('download'), selectionBar(page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect(readFileSync(await dl.path()).toString()).toBe('x');
    expect(dl.suggestedFilename()).not.toContain('..');
  } finally {
    await owner.close();
  }
});

test('FIL-01 SHR-04 participant uploads, renames and downloads; owner sees the label and the new name', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = s.guest.page;
  try {
    const id = await upload(page, { name: 'guest.txt', mimeType: 'text/plain', buffer: Buffer.from('guest bytes') }, 'file');
    await expect(obj(s.owner.page, id)).toContainText('guest.txt', { timeout: 15_000 });
    await selectObj(page, id);
    await fileNameField(page).fill('guest-renamed.txt');
    await fileNameField(page).blur();
    await expect(obj(s.owner.page, id)).toContainText('guest-renamed.txt', { timeout: 15_000 });
    const [dl] = await Promise.all([page.waitForEvent('download'), selectionBar(page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe('guest-renamed.txt');
    expect(readFileSync(await dl.path()).toString()).toBe('guest bytes');
  } finally {
    await s.close();
  }
});

test('FIL-01 owner downloads a file uploaded by another client after the object was renamed by them', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const id = await upload(s.owner.page, { name: 'o.txt', mimeType: 'text/plain', buffer: Buffer.from('owner bytes') }, 'file');
    await expect(obj(s.guest.page, id)).toBeVisible({ timeout: 15_000 });
    await selectObj(s.guest.page, id);
    const [dl] = await Promise.all([s.guest.page.waitForEvent('download'), selectionBar(s.guest.page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect(readFileSync(await dl.path()).toString()).toBe('owner bytes');
  } finally {
    await s.close();
  }
});

async function overLimit(page: Page, path: string) {
  writeFileSync(path, Buffer.alloc(52428800 + 1));
  await page.getByLabel('Upload file', { exact: true }).setInputFiles(path);
}

test('FIL-01 file over the limit is refused: an error is shown and no label appears', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, info) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await overLimit(page, info.outputPath('too-big.bin'));
    await expect(page.getByText(/upload failed|too large/i).first()).toBeVisible({ timeout: 30_000 });
    expect(await ofKind(page, 'file').count()).toBe(0);
    expect(Object.values(await rawObjects(page, owner.boardId)).filter((o) => o.type === 'file')).toHaveLength(0);
  } finally {
    await owner.close();
  }
});

test('FIL-01 BUG-029 over-limit message names the size, not the connection', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, info) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    await overLimit(owner.page, info.outputPath('too-big.bin'));
    await expect(owner.page.getByText('The file is too large to upload.')).toBeVisible({ timeout: 30_000 });
  } finally {
    await owner.close();
  }
});

for (const [name, mimeType, file, kind] of [
  ['SAMPLE.MP4', '', 'sample.mp4', 'video'],
  ['sample.m4v', '', 'sample.m4v', 'video'],
  ['sample.mov', '', 'sample.mov', 'video'],
  ['tone.M4A', 'audio/x-m4a', 'tone.m4a', 'audio'],
  ['tone.mp3', 'audio/mp3', 'tone.mp3', 'audio'],
  ['tone.wav', 'audio/x-wav', 'tone.wav', 'audio'],
] as const) {
  test(`FIL-03 FIL-04 ${name} declared as [${mimeType}] becomes a ${kind} and plays`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    try {
      const id = await upload(owner.page, fixture(file, mimeType, name), kind);
      await startPlaying(owner.page, id);
    } finally {
      await owner.close();
    }
  });
}

test('FIL-01 several files chosen at once each become their own object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await page.getByLabel('Upload file', { exact: true }).setInputFiles([
      { name: 'one.txt', mimeType: 'text/plain', buffer: Buffer.from('1') },
      pdf3(),
      fixture('sample.webm', 'video/webm'),
      fixture('tone.wav', 'audio/wav'),
    ]);
    for (const kind of ['file', 'pdf', 'video', 'audio']) await expect(ofKind(page, kind)).toHaveCount(1, { timeout: 25_000 });
    // объекты не лежат друг на друге полностью
    const boxes = await Promise.all(['file', 'pdf', 'video', 'audio'].map((k) => boxOf(ofKind(page, k))));
    expect(new Set(boxes.map((b) => `${Math.round(b.x)}:${Math.round(b.y)}`)).size).toBe(4);
  } finally {
    await owner.close();
  }
});

test('FIL-01 markup in a file name is shown as text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const name = '<img src=x onerror="document.title=1">.txt';
    const id = await upload(page, { name, mimeType: 'text/plain', buffer: Buffer.from('x') }, 'file');
    await expect(obj(page, id)).toContainText(name);
    await expect(obj(page, id).locator('img')).toHaveCount(0);
    expect(await page.title()).not.toBe('1');
  } finally {
    await owner.close();
  }
});

test('FIL-01 FIL-02 FIL-03 CVS-19 locked objects: no rename, but download, page turning and playback work', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const f = await upload(page, { name: 'locked.txt', mimeType: 'text/plain', buffer: Buffer.from('locked bytes') }, 'file');
    await selectObj(page, f);
    await barBtn(page, 'Lock').click();
    await expect(fileNameField(page)).toHaveCount(0);
    const [dl] = await Promise.all([page.waitForEvent('download'), selectionBar(page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect(readFileSync(await dl.path()).toString()).toBe('locked bytes');
    await page.keyboard.press('Escape');

    const p = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, p, 'red');
    await selectObj(page, p);
    await barBtn(page, 'Lock').click();
    await page.keyboard.press('Escape');
    await obj(page, p).getByRole('button', { name: 'Next page' }).click();
    await expectPageColor(page, p, 'green');

    const v = await upload(page, fixture('sample.webm', 'video/webm'), 'video');
    await selectObj(page, v);
    await barBtn(page, 'Lock').click();
    await page.keyboard.press('Escape');
    await startPlaying(page, v);
  } finally {
    await owner.close();
  }
});

test('FIL-01 FIL-02 undo removes the upload and the extracted pages; rename is undone', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const f = await upload(page, { name: 'first.txt', mimeType: 'text/plain', buffer: Buffer.from('x') }, 'file');
    await selectObj(page, f);
    await fileNameField(page).fill('second.txt');
    await fileNameField(page).blur();
    await expect(obj(page, f)).toContainText('second.txt');
    await page.waitForTimeout(700);
    await tool(page, 'Undo').click();
    await expect(obj(page, f)).toContainText('first.txt', { timeout: 5_000 });

    const p = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, p, 'red');
    await selectObj(page, p);
    await barBtn(page, 'Extract pages').click();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    await dialog.getByLabel('Page 1', { exact: true }).check();
    await dialog.getByLabel('Page 2', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Extract', exact: true }).click();
    await expect(ofKind(page, 'pdf')).toHaveCount(3, { timeout: 15_000 });
    await page.waitForTimeout(700);
    await tool(page, 'Undo').click();
    await expect(ofKind(page, 'pdf')).toHaveCount(1, { timeout: 5_000 });
  } finally {
    await owner.close();
  }
});

test('FIL-01 label: delete and undo, duplicate, copy to another board — the file still downloads', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const page = owner.page;
  let guest: Awaited<ReturnType<typeof openGuest>> | null = null;
  try {
    const id = await upload(page, { name: 'copyme.txt', mimeType: 'text/plain', buffer: Buffer.from('copy bytes') }, 'file');
    await selectObj(page, id);
    await page.keyboard.press('Delete');
    await expect(obj(page, id)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(obj(page, id)).toBeVisible({ timeout: 10_000 });

    await selectObj(page, id);
    await page.keyboard.press('ControlOrMeta+C');
    const board2 = await owner.newBoard();
    await page.goto(`/boards/${board2}`);
    await expect(canvas(page)).toBeVisible();
    const P = await onCanvas(page, 0.5, 0.5);
    await page.mouse.click(P.x, P.y);
    await page.keyboard.press('ControlOrMeta+V');
    await expect(ofKind(page, 'file')).toHaveCount(1, { timeout: 15_000 });
    const copy = (await idsOf(ofKind(page, 'file')))[0];
    await expect(obj(page, copy)).toContainText('copyme.txt');

    const share = await page.request.get(`/api/boards/${board2}/share`);
    guest = await openGuest(browser, o, ((await share.json()) as { token: string }).token, 'QA Guest B');
    await expect(obj(guest.page, copy)).toBeVisible({ timeout: 15_000 });
    await selectObj(guest.page, copy);
    const [dl] = await Promise.all([guest.page.waitForEvent('download'), selectionBar(guest.page).getByRole('link', { name: 'Download', exact: true }).click()]);
    expect(readFileSync(await dl.path()).toString()).toBe('copy bytes');
  } finally {
    await guest?.close();
    await owner.close();
  }
});

test('FIL-01 MOB-01 phone: label is selected by tap, renamed and offers Download', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, { name: 'phone.txt', mimeType: 'text/plain', buffer: Buffer.from('p') }, 'file');
    await selectObj(page, id, true);
    await expect(fileNameField(page)).toBeVisible();
    await fileNameField(page).fill('phone2.txt');
    await fileNameField(page).blur();
    await expect(obj(page, id)).toContainText('phone2.txt');
    await expect(selectionBar(page).getByRole('link', { name: 'Download', exact: true })).toBeVisible();
    const link = await selectionBar(page).getByRole('link', { name: 'Download', exact: true }).boundingBox();
    expect(link!.x + link!.width).toBeLessThanOrEqual(viewport!.width + 1);
  } finally {
    await owner.close();
  }
});

// ---------- FIL-02 ----------

test('FIL-02 PDF opens page by page: next and previous change the page; boundaries stop at first and last', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    const o = obj(page, id);
    await expect(o).toContainText('Page 1 of 3', { timeout: 20_000 });
    await expectPageColor(page, id, 'red');
    await expect(o.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    await o.getByRole('button', { name: 'Next page' }).click();
    await expect(o).toContainText('Page 2 of 3');
    await expectPageColor(page, id, 'green');
    await o.getByRole('button', { name: 'Next page' }).click();
    await expect(o).toContainText('Page 3 of 3');
    await expectPageColor(page, id, 'blue');
    await expect(o.getByRole('button', { name: 'Next page' })).toBeDisabled();
    await o.getByRole('button', { name: 'Previous page' }).click();
    await expect(o).toContainText('Page 2 of 3');
    await expectPageColor(page, id, 'green');
    const doc = await rawObjects(page, owner.boardId);
    expect(doc[id].type).toBe('pdf');
    expect(doc[id].pages).toBe(3);
    expect(JSON.stringify(doc)).not.toContain('data:');
  } finally {
    await owner.close();
  }
});

test('FIL-02 one-page PDF has nowhere to go', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, { name: 'one.pdf', mimeType: 'application/pdf', buffer: pdfOf([[0, 1, 0]]) }, 'pdf');
    await expectPageColor(page, id, 'green');
    const o = obj(page, id);
    await expect(o).toContainText('Page 1 of 1');
    for (const name of ['Previous page', 'Next page']) {
      const b = o.getByRole('button', { name });
      if (await b.count()) await expect(b).toBeDisabled();
    }
  } finally {
    await owner.close();
  }
});

test('FIL-02 selected pages become separate objects: seen by the second client and after reload, source kept', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = s.owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    await selectObj(page, id);
    await barBtn(page, 'Extract pages').click();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    await expect(dialog.getByLabel(/^Page \d+$/)).toHaveCount(3);
    await dialog.getByLabel('Page 1', { exact: true }).check();
    await dialog.getByLabel('Page 3', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Extract', exact: true }).click();

    await expect(ofKind(page, 'pdf')).toHaveCount(3, { timeout: 15_000 });
    const doc = await untilRaw(page, s.owner.boardId, (o) => expect(Object.values(o).filter((v) => v.type === 'pdf')).toHaveLength(3));
    const extracted = Object.entries(doc).filter(([k, v]) => v.type === 'pdf' && k !== id);
    expect(extracted.map(([, v]) => v.page).sort()).toEqual([1, 3]);
    const byPage = Object.fromEntries(extracted.map(([k, v]) => [String(v.page), k]));
    for (const p of [page, s.guest.page]) {
      await expectPageColor(p, byPage['1'], 'red');
      await expectPageColor(p, byPage['3'], 'blue');
    }
    expect(doc[id]).toBeTruthy();

    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expectPageColor(page, byPage['3'], 'blue');
    await expectPageColor(page, byPage['1'], 'red');
    await expectPageColor(page, id, 'red');
  } finally {
    await s.close();
  }
});

test('FIL-02 extracted page lives on its own: moves separately and stays after the source is deleted', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    await selectObj(page, id);
    await barBtn(page, 'Extract pages').click();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    await dialog.getByLabel('Page 2', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Extract', exact: true }).click();
    await expect(ofKind(page, 'pdf')).toHaveCount(2, { timeout: 15_000 });
    const pageId = (await idsOf(ofKind(page, 'pdf'))).find((x) => x !== id)!;
    await expectPageColor(page, pageId, 'green');
    // извлечённая страница не листается: это одна страница
    await expect(obj(page, pageId).getByRole('button', { name: 'Next page' })).toHaveCount(0);

    const srcBefore = await boxOf(obj(page, id));
    await page.keyboard.press('Escape');
    const pb = await boxOf(obj(page, pageId));
    await dragBy(page, { x: pb.x + pb.width / 2, y: pb.y + pb.height / 2 }, { x: 40, y: 60 });
    await expect.poll(async () => (await boxOf(obj(page, pageId))).y).toBeGreaterThan(pb.y + 30);
    const srcAfter = await boxOf(obj(page, id));
    expect(Math.abs(srcAfter.x - srcBefore.x)).toBeLessThan(2);

    await selectObj(page, id);
    await page.keyboard.press('Delete');
    await expect(obj(page, id)).toHaveCount(0);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expectPageColor(page, pageId, 'green');
  } finally {
    await owner.close();
  }
});

test('FIL-02 extraction with nothing selected creates nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    await selectObj(page, id);
    await barBtn(page, 'Extract pages').click();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    const go = dialog.getByRole('button', { name: 'Extract', exact: true });
    if (await go.isEnabled()) await go.click();
    await page.waitForTimeout(500);
    expect(await ofKind(page, 'pdf').count()).toBe(1);
  } finally {
    await owner.close();
  }
});

test('FIL-02 SHR-04 participant turns pages and extracts one; owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = s.guest.page;
  try {
    const id = await upload(s.owner.page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    await obj(page, id).getByRole('button', { name: 'Next page' }).click();
    await expectPageColor(page, id, 'green');
    await selectObj(page, id);
    await barBtn(page, 'Extract pages').click();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    await dialog.getByLabel('Page 3', { exact: true }).check();
    await dialog.getByRole('button', { name: 'Extract', exact: true }).click();
    await expect(ofKind(s.owner.page, 'pdf')).toHaveCount(2, { timeout: 15_000 });
    const pageId = (await idsOf(ofKind(s.owner.page, 'pdf'))).find((x) => x !== id)!;
    await expectPageColor(s.owner.page, pageId, 'blue');
  } finally {
    await s.close();
  }
});

test('FIL-02 file declared as PDF that is not a PDF is refused with a message; the board keeps working', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await page.getByLabel('Upload file', { exact: true }).setInputFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is not a pdf') });
    await expect(page.getByText('This PDF could not be opened.')).toBeVisible({ timeout: 20_000 });
    expect(await ofKind(page, 'pdf').count()).toBe(0);
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
  } finally {
    await owner.close();
  }
});

/** Уменьшить вид кнопкой панели вида, пока объект с панелью не окажется в холсте и не под миникартой. */
async function zoomOutUntilReachable(page: Page, target: Locator) {
  const minus = page.getByRole('toolbar', { name: 'View' }).getByRole('button').first();
  for (let i = 0; i < 8; i++) {
    const hit = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return !!top && (top === el || el.contains(top));
    });
    if (hit) return;
    await minus.tap();
    await page.waitForTimeout(250);
  }
}

test('FIL-02 MOB-01 phone: PDF turns pages by tap once the view shows the button', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    const next = obj(page, id).getByRole('button', { name: 'Next page' });
    await zoomOutUntilReachable(page, next);
    await next.tap();
    await expectPageColor(page, id, 'green');
  } finally {
    await owner.close();
  }
});

test('FIL-02 MOB-01 BUG-030 phone: a new PDF has its page buttons free right after upload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    await obj(page, id).getByRole('button', { name: 'Next page' }).tap({ timeout: 5_000 });
    await expectPageColor(page, id, 'green');
  } finally {
    await owner.close();
  }
});

test('FIL-02 UI-04 phone: extract pages works by tap', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, pdf3(), 'pdf');
    await expectPageColor(page, id, 'red');
    await barBtn(page, 'Extract pages').tap();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    await dialog.getByLabel('Page 2', { exact: true }).tap();
    await dialog.getByRole('button', { name: 'Extract', exact: true }).tap();
    await expect(ofKind(page, 'pdf')).toHaveCount(2, { timeout: 15_000 });
  } finally {
    await owner.close();
  }
});

test('FIL-02 40-page PDF: the dialog stays usable, the last page is extracted', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const colors = Array.from({ length: 40 }, (_, i) => (i === 39 ? [0, 0, 1] : [1, 0, 0]) as [number, number, number]);
    const id = await upload(page, { name: 'long.pdf', mimeType: 'application/pdf', buffer: pdfOf(colors) }, 'pdf');
    await expectPageColor(page, id, 'red');
    await expect(obj(page, id)).toContainText('Page 1 of 40');
    await selectObj(page, id, isMobile);
    await barBtn(page, 'Extract pages').click();
    const dialog = page.getByRole('dialog', { name: 'Extract pages' });
    const last = dialog.getByLabel('Page 40', { exact: true });
    await last.scrollIntoViewIfNeeded();
    await last.check();
    const go = dialog.getByRole('button', { name: 'Extract', exact: true });
    await go.scrollIntoViewIfNeeded();
    const b = await boxOf(go);
    expect(b.y + b.height, 'кнопка Extract в пределах окна').toBeLessThanOrEqual(viewport!.height);
    await go.click();
    await expect(ofKind(page, 'pdf')).toHaveCount(2, { timeout: 15_000 });
    const pageId = (await idsOf(ofKind(page, 'pdf'))).find((x) => x !== id)!;
    await expectPageColor(page, pageId, 'blue');
  } finally {
    await owner.close();
  }
});

// ---------- FIL-03 ----------

for (const [file, mimeType] of VIDEOS) {
  test(`FIL-03 ${file} plays: time advances and the frame has a size`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    const page = owner.page;
    try {
      const id = await upload(page, fixture(file, mimeType), 'video');
      await startPlaying(page, id);
      expect(await media(page, id, (m) => (m as HTMLVideoElement).videoWidth)).toBe(160);
      const frame = () =>
        media(page, id, (m) => {
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 90;
          const g = c.getContext('2d')!;
          g.drawImage(m as HTMLVideoElement, 0, 0, 160, 90);
          return c.toDataURL();
        });
      const first = await frame();
      await expect.poll(frame, { timeout: 10_000, message: 'кадр меняется во время воспроизведения' }).not.toBe(first);
      const doc = await rawObjects(page, owner.boardId);
      expect(doc[id].type).toBe('video');
      expect(String(doc[id].media)).toMatch(/^[0-9a-f-]{36}$/);
      expect(JSON.stringify(doc)).not.toContain('data:');
    } finally {
      await owner.close();
    }
  });
}

test('FIL-03 pause, seek, volume, speed and full screen each change the player', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, fixture('sample.mp4', 'video/mp4'), 'video');
    await startPlaying(page, id);
    await control(page, id, 'Pause').click();
    await expect(player(page, id)).toHaveAttribute('data-playing', 'false');
    const frozen = await currentTime(page, id);
    await page.waitForTimeout(500);
    expect(await currentTime(page, id)).toBe(frozen);

    await setSlider(page, id, 'Seek', 4);
    await expect.poll(() => currentTime(page, id)).toBeGreaterThan(3.5);
    await setSlider(page, id, 'Seek', 1);
    await expect.poll(() => currentTime(page, id)).toBeLessThan(1.5);

    await setSlider(page, id, 'Volume', 0.25);
    await expect.poll(() => media(page, id, (m) => m.volume)).toBeCloseTo(0.25, 2);

    await speed(page, id).selectOption({ label: '2×' });
    await expect.poll(() => media(page, id, (m) => m.playbackRate)).toBe(2);
    await control(page, id, 'Play').click();
    const t0 = await currentTime(page, id);
    await page.waitForTimeout(1000);
    expect((await currentTime(page, id)) - t0, 'при скорости 2× за секунду проходит больше секунды').toBeGreaterThan(1.2);

    await control(page, id, 'Full screen').click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    const insideFs = await page.evaluate((oid) => !!document.fullscreenElement?.closest(`[data-object-id="${oid}"]`) || !!document.fullscreenElement?.querySelector('video'), id);
    expect(insideFs, 'на полный экран вышел плеер').toBe(true);
    const fs = await page.evaluate(() => {
      const r = document.fullscreenElement!.querySelector('video')!.getBoundingClientRect();
      return { w: r.width, h: r.height, iw: innerWidth, ih: innerHeight };
    });
    expect(Math.max(fs.w / fs.iw, fs.h / fs.ih), 'видео занимает экран').toBeGreaterThan(0.9);
    await control(page, id, 'Exit full screen').click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  } finally {
    await owner.close();
  }
});

test('FIL-03 player controls do not move or edit the object; the object itself can be moved and deleted while playing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, fixture('sample.webm', 'video/webm'), 'video');
    await page.keyboard.press('Escape');
    await expect.poll(() => control(page, id, 'Play').count()).toBe(1);
    const before = (await rawObjects(page, owner.boardId))[id];
    await startPlaying(page, id);
    const seek = await boxOf(slider(page, id, 'Seek'));
    await dragBy(page, { x: seek.x + 2, y: seek.y + seek.height / 2 }, { x: seek.width / 2, y: 0 });
    await page.waitForTimeout(400);
    const after = (await rawObjects(page, owner.boardId))[id];
    expect({ x: after.x, y: after.y }).toEqual({ x: before.x, y: before.y });
    await expect(player(page, id)).toHaveAttribute('data-playing', 'true');

    await selectObj(page, id);
    await page.keyboard.press('Delete');
    await expect(obj(page, id)).toHaveCount(0);
    await expect(page.locator('video')).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

test('FIL-03 SHR-04 participant plays and seeks a video uploaded by the owner', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = s.guest.page;
  try {
    const id = await upload(s.owner.page, fixture('sample.m4v', 'video/x-m4v'), 'video');
    await expect(obj(page, id)).toBeVisible({ timeout: 15_000 });
    await startPlaying(page, id);
    await setSlider(page, id, 'Seek', 4);
    await expect.poll(() => currentTime(page, id)).toBeGreaterThan(3.5);
  } finally {
    await s.close();
  }
});

test('FIL-03 damaged video shows a message and leaves the board alive; avi becomes a file label', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, { name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not a video at all') }, 'video');
    await expect(obj(page, id)).toContainText(/can't be played/i, { timeout: 20_000 });
    await expect(canvas(page)).toBeVisible();

    const avi = await upload(page, { name: 'clip.avi', mimeType: 'video/x-msvideo', buffer: Buffer.from('RIFF....AVI ') }, 'file');
    await expect(obj(page, avi)).toContainText('clip.avi');
  } finally {
    await owner.close();
  }
});

test('FIL-03 MOB-01 phone: video starts by tap; all controls can be reached after zooming the view out', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, fixture('sample.mp4', 'video/mp4'), 'video');
    await page.waitForTimeout(300);
    await zoomOutUntilReachable(page, control(page, id, 'Play'));
    await startPlaying(page, id, true);
    await control(page, id, 'Pause').tap();
    await expect(player(page, id)).toHaveAttribute('data-playing', 'false');
    await zoomOutUntilReachable(page, control(page, id, 'Full screen'));
    await control(page, id, 'Full screen').tap();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    await control(page, id, 'Exit full screen').tap();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    for (const name of ['Seek', 'Volume']) await expect(slider(page, id, name)).toBeVisible();
    await expect(speed(page, id)).toBeVisible();
  } finally {
    await owner.close();
  }
});

test('FIL-03 MOB-01 BUG-030 phone: a new video fits the screen width with its controls', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, fixture('sample.mp4', 'video/mp4'), 'video');
    const o = await boxOf(obj(page, id));
    expect(o.x).toBeGreaterThanOrEqual(0);
    expect(o.x + o.width).toBeLessThanOrEqual(viewport!.width + 1);
  } finally {
    await owner.close();
  }
});

test('FIL-03 FIL-04 UI-04 phone: player and page buttons are at least 44 px at 100% zoom', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const v = await upload(page, fixture('sample.webm', 'video/webm'), 'video');
    const targets: [string, Locator][] = [
      ['Play', control(page, v, 'Play')],
      ['Seek', slider(page, v, 'Seek')],
      ['Volume', slider(page, v, 'Volume')],
      ['Speed', speed(page, v)],
      ['Full screen', control(page, v, 'Full screen')],
    ];
    const small: string[] = [];
    for (const [name, l] of targets) {
      const b = await boxOf(l);
      if (b.height < 43.5 || b.width < 43.5) small.push(`${name} ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    expect(small, 'элементы меньше 44 px').toEqual([]);
  } finally {
    await owner.close();
  }
});

// ---------- FIL-04 ----------

for (const [file, mimeType] of AUDIOS) {
  test(`FIL-04 ${file} plays: time advances`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    const page = owner.page;
    try {
      const id = await upload(page, fixture(file, mimeType), 'audio');
      await startPlaying(page, id);
      expect((await rawObjects(page, owner.boardId))[id].type).toBe('audio');
    } finally {
      await owner.close();
    }
  });
}

test('FIL-04 audio-only webm declared as video/webm stays audio', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, fixture('tone.webm', 'video/webm'), 'audio');
    await startPlaying(page, id);
  } finally {
    await owner.close();
  }
});

test('FIL-04 pause and seek change the audio; participant plays the owner audio', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = s.owner.page;
  try {
    const id = await upload(page, fixture('tone.mp3', 'audio/mpeg'), 'audio');
    await startPlaying(page, id);
    await control(page, id, 'Pause').click();
    await expect(player(page, id)).toHaveAttribute('data-playing', 'false');
    const frozen = await currentTime(page, id);
    await page.waitForTimeout(500);
    expect(await currentTime(page, id)).toBe(frozen);
    await setSlider(page, id, 'Seek', 4);
    await expect.poll(() => currentTime(page, id)).toBeGreaterThan(3.5);

    await expect(obj(s.guest.page, id)).toBeVisible({ timeout: 15_000 });
    await startPlaying(s.guest.page, id);
  } finally {
    await s.close();
  }
});

test('FIL-04 MOB-01 phone: audio starts by tap', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const id = await upload(page, fixture('tone.wav', 'audio/wav'), 'audio');
    await page.waitForTimeout(300);
    await startPlaying(page, id, true);
  } finally {
    await owner.close();
  }
});

// ---------- FIL-05 ----------

for (const [file, mimeType, kind] of [
  ['sample.webm', 'video/webm', 'video'],
  ['tone.wav', 'audio/wav', 'audio'],
] as const) {
  test(`FIL-05 ${kind}: start and pause at A do not touch B; B plays on its own and does not touch A`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    const a = s.owner.page;
    const b = s.guest.page;
    try {
      const id = await upload(a, fixture(file, mimeType), kind);
      await expect(obj(b, id)).toBeVisible({ timeout: 15_000 });
      await expect(mediaEl(b, id)).toBeAttached({ timeout: 15_000 });
      await startPlaying(a, id);
      await a.waitForTimeout(800);
      expect(await isPaused(b, id)).toBe(true);
      expect(await currentTime(b, id)).toBe(0);
      await expect(player(b, id)).toHaveAttribute('data-playing', 'false');

      await startPlaying(b, id);
      await control(a, id, 'Pause').click();
      await expect(player(a, id)).toHaveAttribute('data-playing', 'false');
      await a.waitForTimeout(300);
      expect(await isPaused(b, id), 'пауза у A остановила B').toBe(false);
      await control(b, id, 'Pause').click();
      const ta = await currentTime(a, id);
      await a.waitForTimeout(300);
      expect(await currentTime(a, id)).toBe(ta);
    } finally {
      await s.close();
    }
  });
}

test('FIL-05 ARCH seek, volume and speed at A stay local; nothing reaches the document or the channel', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const a = s.owner.page;
  const b = s.guest.page;
  try {
    const id = await upload(a, fixture('sample.webm', 'video/webm'), 'video');
    await expect(mediaEl(b, id)).toBeAttached({ timeout: 15_000 });
    await a.keyboard.press('Escape');
    const docBefore = await untilRaw(a, s.owner.boardId, (o) => expect(o[id]).toBeTruthy());
    await a.waitForTimeout(800);
    const wireA = s.owner.wire.syncSent;
    const statesBefore = s.owner.wire.sent.length;

    await startPlaying(a, id);
    await setSlider(a, id, 'Seek', 3);
    await setSlider(a, id, 'Volume', 0.2);
    await speed(a, id).selectOption({ label: '1.5×' });
    await control(a, id, 'Pause').click();
    await a.waitForTimeout(800);

    expect(s.owner.wire.syncSent, 'управление плеером записало правку в документ').toBe(wireA);
    const leaked = JSON.stringify(s.owner.wire.sent.slice(statesBefore));
    for (const word of ['playing', 'currentTime', 'volume', 'playbackRate']) expect(leaked).not.toContain(word);
    expect((await rawObjects(a, s.owner.boardId))[id]).toEqual(docBefore[id]);

    expect(await currentTime(b, id)).toBe(0);
    expect(await media(b, id, (m) => m.volume)).toBe(1);
    expect(await media(b, id, (m) => m.playbackRate)).toBe(1);
  } finally {
    await s.close();
  }
});

test('FIL-05 a client that joins while A is playing and a client that reloads are paused at zero', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const s = await owner2(browser, f);
  const a = s.owner.page;
  let late: Awaited<ReturnType<typeof openGuest>> | null = null;
  try {
    const id = await upload(a, fixture('sample.webm', 'video/webm'), 'video');
    await startPlaying(a, id);
    late = await openGuest(browser, s.o, s.owner.token, 'QA Late');
    await expect(mediaEl(late.page, id)).toBeAttached({ timeout: 15_000 });
    await late.page.waitForTimeout(800);
    expect(await isPaused(late.page, id)).toBe(true);
    expect(await currentTime(late.page, id)).toBe(0);

    await a.reload();
    await expect(mediaEl(a, id)).toBeAttached({ timeout: 15_000 });
    await a.waitForTimeout(500);
    expect(await isPaused(a, id)).toBe(true);
  } finally {
    await late?.close();
    await s.close();
  }
});

// GIF 64×64: два кадра (как в images.spec.ts).
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

async function uploadGif(page: Page): Promise<string> {
  const images = page.locator('[data-object-id][data-type="image"]');
  await page.keyboard.press('Escape');
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'All tools').click();
  await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Image', exact: true }).click();
  await (await chooser).setFiles({ name: 'anim.gif', mimeType: 'image/gif', buffer: animatedGif() });
  await expect(images).toHaveCount(1, { timeout: 20_000 });
  return (await idsOf(images))[0];
}

test('FIL-05 IMG-06 with many objects hover starts the GIF only for the one who hovers', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const a = s.owner.page;
  const b = s.guest.page;
  try {
    const id = await uploadGif(a);
    const items: Record<string, Obj> = {};
    for (let i = 0; i < 60; i++) items[`qa-m${i}`] = { type: 'shape', x: (i % 12) * 30, y: 380 + Math.floor(i / 12) * 30, width: 20, height: 20 };
    await seed(a, s.owner.boardId, items);
    await a.keyboard.press('Escape');
    await a.mouse.move(2, 2);
    await b.mouse.move(2, 2);
    await expect(obj(a, id).locator('.image-view')).toHaveAttribute('data-playing', 'false');
    await expect(obj(b, id).locator('.image-view')).toHaveAttribute('data-playing', 'false', { timeout: 15_000 });

    const box = await boxOf(obj(a, id));
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(obj(a, id).locator('.image-view')).toHaveAttribute('data-playing', 'true');
    await a.waitForTimeout(800);
    await expect(obj(b, id).locator('.image-view')).toHaveAttribute('data-playing', 'false');
  } finally {
    await s.close();
  }
});

// Фиксирует наблюдаемое поведение для вопроса Q-007, а не вердикт: при ответе (б) тест меняется.
test('FIL-05 IMG-06 Q-007 with few objects the GIF plays for every client without anyone starting it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const s = await owner2(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const a = s.owner.page;
  const b = s.guest.page;
  try {
    const id = await uploadGif(a);
    await a.keyboard.press('Escape');
    await a.mouse.move(2, 2);
    await b.mouse.move(2, 2);
    await expect(obj(a, id).locator('.image-view')).toHaveAttribute('data-playing', 'true');
    await expect(obj(b, id).locator('.image-view')).toHaveAttribute('data-playing', 'true', { timeout: 15_000 });
  } finally {
    await s.close();
  }
});

// ---------- ARCH ----------

test('ARCH FIL-01…04 objects refer to the file by id; the client uses /api/media of its own origin and never localhost', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  try {
    const f = await upload(page, { name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }, 'file');
    const p = await upload(page, pdf3(), 'pdf');
    const v = await upload(page, fixture('sample.webm', 'video/webm'), 'video');
    const a = await upload(page, fixture('tone.wav', 'audio/wav'), 'audio');
    await expectPageColor(page, p, 'red');
    await startPlaying(page, v);
    await startPlaying(page, a);
    const doc = await rawObjects(page, owner.boardId);
    for (const id of [f, p, v, a]) {
      expect(String(doc[id].media)).toMatch(/^[0-9a-f-]{36}$/);
      expect(doc[id].name).toBeTruthy();
    }
    expect(JSON.stringify(doc)).not.toContain('data:');
    const mediaUrls = urls.filter((u) => u.includes('/api/media/'));
    expect(mediaUrls.length).toBeGreaterThanOrEqual(3);
    const origin = new URL(page.url()).origin;
    for (const u of mediaUrls) expect(new URL(u).origin).toBe(origin);
    expect(urls.filter((u) => /localhost|127\.0\.0\.1/.test(u))).toEqual([]);
    expect(urls.filter((u) => /^https?:/.test(u) && new URL(u).origin !== origin), 'файлы и воркер PDF — только своего происхождения').toEqual([]);
    await expect(allObjects(page)).toHaveCount(4);
  } finally {
    await owner.close();
  }
});

// ---------- Перепроверка BUG-029: текст ошибки при файле больше лимита ----------

const TOO_LARGE = 'The file is too large to upload.';
const NO_CONNECTION = 'The upload failed. Check the connection.';

test('FIL-01 BUG-029 participant by link: over-limit message names the size; no object in the document', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, info) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  try {
    await overLimit(guest.page, info.outputPath('too-big.bin'));
    await expect(guest.page.getByText(TOO_LARGE)).toBeVisible({ timeout: 30_000 });
    await expect(guest.page.getByText(NO_CONNECTION)).toHaveCount(0);
    expect(Object.values(await rawObjects(owner.page, owner.boardId)).filter((x) => x.type === 'file')).toHaveLength(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('FIL-01 BUG-029 a file far over the limit (150 MB): the size message, and the server keeps answering', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, info) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const path = info.outputPath('far-too-big.bin');
    writeFileSync(path, Buffer.alloc(150 * 1024 * 1024));
    await owner.page.getByLabel('Upload file', { exact: true }).setInputFiles(path);
    await expect(owner.page.getByText(TOO_LARGE)).toBeVisible({ timeout: 90_000 });
    await expect(owner.page.getByText(NO_CONNECTION)).toHaveCount(0);
    expect((await owner.page.request.get('/api/session')).status()).toBe(200);
    expect(await ofKind(owner.page, 'file').count()).toBe(0);
  } finally {
    await owner.close();
  }
});

test('FIL-01 BUG-029 boundary: a file of exactly the limit becomes a shortcut, no error', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, info) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const path = info.outputPath('exact.bin');
    writeFileSync(path, Buffer.alloc(52428800));
    await owner.page.getByLabel('Upload file', { exact: true }).setInputFiles(path);
    await expect(ofKind(owner.page, 'file')).toHaveCount(1, { timeout: 60_000 });
    await expect(owner.page.getByText(TOO_LARGE)).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

test('FIL-01 BUG-029 negative: a real break in the connection still says so, not the size', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    await owner.page.route('**/api/boards/*/media**', (r) => r.abort('connectionreset'));
    await owner.page.getByLabel('Upload file', { exact: true }).setInputFiles({ name: 'small.bin', mimeType: 'application/octet-stream', buffer: Buffer.from('payload') });
    await expect(owner.page.getByText(NO_CONNECTION)).toBeVisible({ timeout: 15_000 });
    await expect(owner.page.getByText(TOO_LARGE)).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

/** Настоящий PNG с хвостом нулей: браузер его показывает, размер — больше лимита. */
function hugePng(): Buffer {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==',
    'base64',
  );
  return Buffer.concat([png, Buffer.alloc(52428800 + 1 - png.length)]);
}

test('IMG-01 BUG-029 image over the limit through Upload image: the size message, no object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, info) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const path = info.outputPath('huge.png');
    writeFileSync(path, hugePng());
    await owner.page.getByLabel('Upload image', { exact: true }).setInputFiles(path);
    await expect(owner.page.getByText(TOO_LARGE)).toBeVisible({ timeout: 60_000 });
    await expect(owner.page.getByText(NO_CONNECTION)).toHaveCount(0);
    await expect(ofKind(owner.page, 'image')).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

test('IMG-01 BUG-029 image over the limit pasted from the clipboard: the size message, no object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const p = await onCanvas(page, 0.5, 0.5);
    await page.mouse.move(p.x, p.y);
    await page.evaluate((size) => {
      const png = Uint8Array.from(
        atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg=='),
        (c) => c.charCodeAt(0),
      );
      const bytes = new Uint8Array(size);
      bytes.set(png);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'clip.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, 52428800 + 1);
    await expect(page.getByText(TOO_LARGE)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(NO_CONNECTION)).toHaveCount(0);
    await expect(ofKind(page, 'image')).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

// ---------- Перепроверка BUG-030: новый объект на телефоне ----------

const MIN_TARGET = 43.5;

/** Элемент целиком на экране, не перекрыт (миникартой, панелью, краем) и не меньше 44×44. */
async function expectFree(page: Page, name: string, target: Locator) {
  const vp = page.viewportSize()!;
  await expect(target, name).toBeVisible();
  const r = await target.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const points = [
      [b.x + b.width / 2, b.y + b.height / 2],
      [b.x + 2, b.y + 2],
      [b.x + b.width - 2, b.y + b.height - 2],
    ];
    const blockers = points
      .map(([x, y], i) => [i, document.elementFromPoint(x, y)] as const)
      .filter(([, top]) => !top || !(top === el || el.contains(top) || top.contains(el)))
      .map(([i, top]) => `${i === 0 ? 'центр' : 'угол'}:${top ? top.getAttribute('class') ?? top.tagName : 'null'}`)
      // Маркер размера выделенного объекта заходит на угол кнопки у любого объекта и на компьютере тоже.
      .filter((b) => !(b.startsWith('угол:') && b.includes('selection-handle')));
    return { x: b.x, y: b.y, w: b.width, h: b.height, blockers };
  });
  const where = `${name}: ${JSON.stringify(r)} в окне ${vp.width}x${vp.height}`;
  expect(r.x, where).toBeGreaterThanOrEqual(0);
  expect(r.y, where).toBeGreaterThanOrEqual(0);
  expect(r.x + r.w, where).toBeLessThanOrEqual(vp.width + 0.5);
  expect(r.y + r.h, where).toBeLessThanOrEqual(vp.height + 0.5);
  expect(r.blockers, where).toEqual([]);
  expect(r.w, where).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(r.h, where).toBeGreaterThanOrEqual(MIN_TARGET);
}

const expectVideoFree = async (page: Page, id: string) => {
  await expectFree(page, 'Play', control(page, id, 'Play'));
  await expectFree(page, 'Seek', slider(page, id, 'Seek'));
  await expectFree(page, 'Volume', slider(page, id, 'Volume'));
  await expectFree(page, 'Speed', speed(page, id));
  await expectFree(page, 'Full screen', control(page, id, 'Full screen'));
};
const expectPdfFree = async (page: Page, id: string) => {
  await expectFree(page, 'Previous page', control(page, id, 'Previous page'));
  await expectFree(page, 'Next page', control(page, id, 'Next page'));
  await expect(obj(page, id)).toContainText('Page 1 of 3');
  const label = obj(page, id).getByText('Page 1 of 3');
  const b = await boxOf(label);
  const vp = page.viewportSize()!;
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height + 0.5);
  const overlapped = await label.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !top || !(top === el || el.contains(top));
  });
  expect(overlapped, 'надпись страницы не закрыта').toBe(false);
};

const PHONES: [string, { width: number; height: number }][] = [
  ['Pixel 7 portrait', { width: 412, height: 839 }],
  ['360 px', { width: 360, height: 640 }],
  ['320 px', { width: 320, height: 568 }],
  ['landscape', { width: 839, height: 412 }],
];

const openPhone = (browser: Browser, f: Fx, size: { width: number; height: number }) => openOwner(browser, profileOpts({ ...f, viewport: size }));

for (const [title, size] of PHONES) {
  test(`FIL-02 MOB-06 UI-04 BUG-030 ${title}: a new PDF has its page buttons on screen, free, at least 44 px, working by tap`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const pdf = await uploadViaTool(page, pdf3(), 'pdf');
      await expectPageColor(page, pdf, 'red');
      await expectPdfFree(page, pdf);
      await control(page, pdf, 'Next page').tap({ timeout: 5_000 });
      await expectPageColor(page, pdf, 'green');
      const shown = await boxOf(obj(page, pdf).locator('canvas').first());
      expect(shown.height, 'страница остаётся различимой').toBeGreaterThanOrEqual(80);
    } finally {
      await owner.close();
    }
  });

  test(`FIL-02 MOB-06 BUG-031 ${title}: PDF pages still turn by tap after zooming the view out`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const pdf = await uploadViaTool(page, pdf3(), 'pdf');
      await expectPageColor(page, pdf, 'red');
      const next = control(page, pdf, 'Next page');
      await zoomOutUntilReachable(page, next);
      await next.tap({ timeout: 5_000 });
      await expectPageColor(page, pdf, 'green');
    } finally {
      await owner.close();
    }
  });

  test(`FIL-03 MOB-06 BUG-031 ${title}: video controls can still be tapped after zooming the view out`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const video = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      const play = control(page, video, 'Play');
      await zoomOutUntilReachable(page, play);
      await play.tap({ timeout: 5_000 });
      await expect(player(page, video)).toHaveAttribute('data-playing', 'true');
      // Маркер размера выделенного объекта не уменьшается с масштабом и закрывает кнопку в углу: снять выделение.
      await page.keyboard.press('Escape');
      const full = control(page, video, 'Full screen');
      await zoomOutUntilReachable(page, full);
      await full.tap({ timeout: 5_000 });
      await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    } finally {
      await owner.close();
    }
  });

  test(`FIL-03 MOB-06 UI-04 BUG-030 ${title}: a new video has every control on screen, free, at least 44 px, working by tap`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const video = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      await expectVideoFree(page, video);
      await startPlaying(page, video, true);
      await control(page, video, 'Pause').tap({ timeout: 5_000 });
      await expect(player(page, video)).toHaveAttribute('data-playing', 'false');
      const frame = await boxOf(obj(page, video).locator('video').first());
      expect(frame.height, 'кадр остаётся различимым').toBeGreaterThanOrEqual(80);
    } finally {
      await owner.close();
    }
  });

  test(`FIL-04 MOB-06 UI-04 BUG-030 ${title}: a new audio has its controls on screen, free, at least 44 px, working by tap`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const audio = await uploadViaTool(page, fixture('tone.mp3', 'audio/mpeg'), 'audio');
      await expectFree(page, 'Play', control(page, audio, 'Play'));
      await expectFree(page, 'Seek', slider(page, audio, 'Seek'));
      await startPlaying(page, audio, true);
    } finally {
      await owner.close();
    }
  });
}

/** Настоящий путь пользователя: All tools → File, объект встаёт в центре текущего вида. */
async function uploadViaTool(page: Page, file: FilePayload, kind: string): Promise<string> {
  const before = new Set(await idsOf(ofKind(page, kind)));
  const chooser = page.waitForEvent('filechooser', { timeout: 10_000 });
  await tool(page, 'All tools').click();
  await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'File', exact: true }).click();
  await (await chooser).setFiles(file);
  let found = '';
  await expect
    .poll(
      async () => {
        found = (await idsOf(ofKind(page, kind))).find((x) => !before.has(x)) ?? '';
        return found;
      },
      { timeout: 25_000 },
    )
    .not.toBe('');
  return found;
}

/** Убрать объект, чтобы следующий встал на его место в центре вида. */
async function selectAndDelete(page: Page, id: string) {
  await selectObj(page, id, true);
  await barBtn(page, 'Delete').tap();
  await expect(obj(page, id)).toHaveCount(0);
}

test('FIL-02 FIL-03 MOB-06 BUG-030 phone: wide PDF page and a second object right after the first stay usable', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const wide = Buffer.from(pdfOf(PAGE_COLORS).toString('latin1').replaceAll('/MediaBox [0 0 300 400]', '/MediaBox [0 0 900 300]'), 'latin1');
    const pdf = await uploadViaTool(page, { name: 'wide.pdf', mimeType: 'application/pdf', buffer: wide }, 'pdf');
    await expect(obj(page, pdf)).toContainText('Page 1 of 3');
    await expectPdfFree(page, pdf);
    const second = await uploadViaTool(page, fixture('sample.webm', 'video/webm'), 'video');
    await expectVideoFree(page, second);
  } finally {
    await owner.close();
  }
});

test('FIL-03 MOB-06 BUG-030 phone: a new video after the view was moved is still on screen with free controls', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const touch = await Touch.of(page);
    const a = await onCanvas(page, 0.5, 0.3);
    const b = { x: a.x + 80, y: a.y };
    await touch.gesture([a, b], [{ x: a.x - 120, y: a.y + 180 }, { x: b.x - 120, y: b.y + 180 }]);
    const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
    await expectVideoFree(page, id);
  } finally {
    await owner.close();
  }
});

test('FIL-02 FIL-03 BUG-030 observation phone: at a zoom below and above 100 % a new video', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const bar = page.getByRole('toolbar', { name: 'View' }).getByRole('button');
    const report = async (label: string) => {
      const id = await upload(page, fixture('sample.mp4', 'video/mp4'), 'video');
      const o = await boxOf(obj(page, id));
      const play = await boxOf(control(page, id, 'Play'));
      const full = await boxOf(control(page, id, 'Full screen'));
      const line = `${label}: объект x=${Math.round(o.x)} w=${Math.round(o.width)}; Play x=${Math.round(play.x)} ${Math.round(play.width)}x${Math.round(play.height)}; Full screen x=${Math.round(full.x)} ${Math.round(full.width)}x${Math.round(full.height)}; окно ${page.viewportSize()!.width}`;
      console.log(`наблюдение BUG-030 ${line}`);
      test.info().annotations.push({ type: 'наблюдение BUG-030', description: line });
      return id;
    };
    await selectAndDelete(page, await report('100 %'));
    await bar.first().tap();
    await bar.first().tap();
    await page.waitForTimeout(300);
    await selectAndDelete(page, await report('ниже 100 %'));
    const labels = await bar.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''));
    const plus = labels.findIndex((l) => /zoom in/i.test(l));
    for (let i = 0; i < 5; i++) await bar.nth(plus).tap();
    await page.waitForTimeout(300);
    await report('выше 100 %');
  } finally {
    await owner.close();
  }
});

test('FIL-02 FIL-03 BUG-030 phone and desktop: an object placed on the phone is usable for the other client; both see one size', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const desk = await openGuest(browser, { baseURL, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } as Opts, owner.token, 'QA Desk');
  try {
    const video = await uploadViaTool(owner.page, fixture('sample.mp4', 'video/mp4'), 'video');
    const raw = await untilRaw(owner.page, owner.boardId, (o) => expect(o[video]).toBeTruthy());
    await expect(obj(desk.page, video)).toBeVisible();
    await expect(obj(desk.page, video).getByRole('button', { name: 'Play', exact: true })).toBeVisible();
    const inside = await obj(desk.page, video).evaluate((box) => {
      const b = box.getBoundingClientRect();
      return [...box.querySelectorAll('button, select, input')].every((c) => {
        const r = c.getBoundingClientRect();
        return r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
      });
    });
    expect(inside, 'все элементы плеера внутри рамки у второго клиента').toBe(true);
    await obj(desk.page, video).getByRole('button', { name: 'Play', exact: true }).click();
    await expect(player(desk.page, video)).toHaveAttribute('data-playing', 'true');
    await obj(desk.page, video).getByRole('button', { name: 'Pause', exact: true }).click();
    const pdf = await uploadViaTool(owner.page, pdf3(), 'pdf');
    await expect(obj(desk.page, pdf)).toBeVisible();
    await obj(desk.page, pdf).getByRole('button', { name: 'Next page', exact: true }).click();
    await expectPageColor(desk.page, pdf, 'green');
    // BUG-032: прежний предел «не шире 412» шёл от исправления BUG-030, а не от требования: ни одно требование
    // не задаёт размер в документе. Проверяется то, что следует из названия: компьютер показывает размер документа.
    const seen = await boxOf(obj(desk.page, video));
    expect(Math.abs(seen.width - Number(raw[video].width)), 'компьютер показывает размер из документа').toBeLessThanOrEqual(2);
  } finally {
    await desk.close();
    await owner.close();
  }
});

test('FIL-02 FIL-03 FIL-04 BUG-030 desktop: sizes of new objects did not change', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const pdf = await upload(page, pdf3(), 'pdf');
    const video = await upload(page, fixture('sample.mp4', 'video/mp4'), 'video');
    const audio = await upload(page, fixture('tone.mp3', 'audio/mpeg'), 'audio');
    const raw = await untilRaw(page, owner.boardId, (o) => expect(o[audio]).toBeTruthy());
    // Страница 300×400 меньше предела 480 и не растягивается, панель страниц — 56.
    expect(raw[pdf].width).toBe(300);
    expect(raw[pdf].height).toBe(456);
    const natural = await obj(page, video).locator('video').first().evaluate((v) => new Promise<[number, number]>((res) => {
      const el = v as HTMLVideoElement;
      if (el.videoWidth) res([el.videoWidth, el.videoHeight]);
      else el.onloadedmetadata = () => res([el.videoWidth, el.videoHeight]);
    }));
    expect(Number(raw[video].width)).toBeGreaterThanOrEqual(420);
    expect(Number(raw[video].height)).toBeCloseTo((Number(raw[video].width) * natural[1]) / natural[0] + 112, 0);
    console.log(`наблюдение BUG-030 desktop: audio ${raw[audio].width}x${raw[audio].height}; video ${raw[video].width}x${raw[video].height}`);
  } finally {
    await owner.close();
  }
});

// ---------- Перепроверка BUG-031: низкий и узкий телефон, панель выделения, размер и положение ----------

type Rect = { x: number; y: number; width: number; height: number };

/** Прямоугольник кадра, который реально показан: у video и canvas вписанный, с полями по object-fit. */
async function pictureBox(l: Locator) {
  return l.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const v = el as HTMLVideoElement & HTMLCanvasElement;
    const nw = v.videoWidth || v.width || b.width;
    const nh = v.videoHeight || v.height || b.height;
    const k = Math.min(b.width / nw, b.height / nh);
    const w = nw * k;
    const h = nh * k;
    return { x: b.x + (b.width - w) / 2, y: b.y + (b.height - h) / 2, width: w, height: h, boxW: b.width, boxH: b.height };
  });
}

const intersection = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Снять выделение касанием пустого места холста: левый нижний угол ниже объекта. */
async function deselectByTap(page: Page, id: string) {
  const c = await boxOf(canvas(page));
  const o = await boxOf(obj(page, id));
  const y = Math.min(c.y + c.height - 6, Math.max(o.y + o.height + 16, c.y + c.height - 30));
  await page.touchscreen.tap(c.x + 8, y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'false');
  await expect(selectionBar(page)).toHaveCount(0);
}

/** Сетка точек по прямоугольнику: всё, что видно, принадлежит объекту (ничто не закрывает кадр). */
async function coveredPoints(page: Page, box: Rect, id: string) {
  return page.evaluate(({ b, oid }) => {
    const out: string[] = [];
    for (const fx of [0.05, 0.5, 0.95]) {
      for (const fy of [0.03, 0.5, 0.97]) {
        const x = b.x + b.width * fx;
        const y = b.y + b.height * fy;
        const top = document.elementFromPoint(x, y);
        if (!top?.closest(`[data-object-id="${oid}"]`)) out.push(`${fx},${fy}:${top?.getAttribute('class') ?? top?.tagName}`);
      }
    }
    return out;
  }, { b: box, oid: id });
}

const log031 = (line: string) => {
  console.log(`наблюдение BUG-031 ${line}`);
  test.info().annotations.push({ type: 'наблюдение BUG-031', description: line });
};

for (const [title, size] of PHONES) {
  test(`FIL-03 MOB-06 BUG-031 ${title}: selection bar over a new video; after deselecting nothing covers the frame`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      const frame = obj(page, id).locator('video').first();
      await expect.poll(() => frame.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
      const c = await boxOf(canvas(page));
      const o = await boxOf(obj(page, id));
      const bar = await boxOf(selectionBar(page));
      const pic = await pictureBox(frame);
      const share = intersection(bar, pic) / (pic.width * pic.height);
      log031(`${title} видео: холст ${c.width}x${c.height}, объект ${Math.round(o.width)}x${Math.round(o.height)} y=${Math.round(o.y - c.y)}, рамка кадра ${Math.round(pic.boxW)}x${Math.round(pic.boxH)}, кадр ${Math.round(pic.width)}x${Math.round(pic.height)}, панель выделения h=${Math.round(bar.height)}, закрыто ${Math.round(share * 100)} % кадра`);
      await page.screenshot({ path: test.info().outputPath(`selected-${title}.png`) });

      // Панель выделения в одну строку и в пределах экрана.
      expect(bar.height, 'панель выделения — одна строка').toBeLessThanOrEqual(64);
      // Запуск при выделенном объекте; выделение снимается, кадр открывается целиком.
      await control(page, id, 'Play').tap();
      await expect(player(page, id)).toHaveAttribute('data-playing', 'true');
      await deselectByTap(page, id);
      await expect(player(page, id), 'снятие выделения не останавливает ролик').toHaveAttribute('data-playing', 'true');
      const shown = await pictureBox(frame);
      await page.screenshot({ path: test.info().outputPath(`deselected-${title}.png`) });
      expect(shown.y, 'верх кадра в холсте').toBeGreaterThanOrEqual(c.y - 0.5);
      expect(shown.y + shown.height, 'низ кадра в холсте').toBeLessThanOrEqual(c.y + c.height + 0.5);
      expect(shown.x, 'кадр в окне').toBeGreaterThanOrEqual(-0.5);
      expect(shown.x + shown.width, 'кадр в окне').toBeLessThanOrEqual(size.width + 0.5);
      expect(await coveredPoints(page, shown, id), 'кадр без выделения ничем не закрыт').toEqual([]);
      expect(shown.height, 'кадр различим').toBeGreaterThanOrEqual(80);
      expect(shown.width, 'пропорции кадра сохранены').toBeGreaterThan(shown.height);
      // Подписи скрыты только с экрана: значение Speed читается, поля остаются доступны по имени.
      const speedStyle = await speed(page, id).evaluate((el) => ({ size: parseFloat(getComputedStyle(el).fontSize), w: el.getBoundingClientRect().width, text: (el as HTMLSelectElement).selectedOptions[0]?.text }));
      log031(`${title} Speed: ${JSON.stringify(speedStyle)}`);
      expect(speedStyle.size, 'значение Speed читается').toBeGreaterThanOrEqual(11);
      await expect(slider(page, id, 'Volume')).toBeVisible();
      await control(page, id, 'Pause').tap();
      await expect(player(page, id)).toHaveAttribute('data-playing', 'false');
    } finally {
      await owner.close();
    }
  });

  test(`FIL-02 MOB-06 BUG-031 ${title}: a new PDF page is uncovered after deselecting and Extract pages works from the one-row bar`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, pdf3(), 'pdf');
      await expectPageColor(page, id, 'red');
      const sheet = obj(page, id).locator('canvas').first();
      const c = await boxOf(canvas(page));
      const o = await boxOf(obj(page, id));
      const bar = await boxOf(selectionBar(page));
      const pic = await pictureBox(sheet);
      log031(`${title} PDF: холст ${c.width}x${c.height}, объект ${Math.round(o.width)}x${Math.round(o.height)} y=${Math.round(o.y - c.y)}, страница ${Math.round(pic.width)}x${Math.round(pic.height)}, закрыто панелью ${Math.round((intersection(bar, pic) / (pic.width * pic.height)) * 100)} %`);
      await page.screenshot({ path: test.info().outputPath(`pdf-selected-${title}.png`) });
      expect(bar.height).toBeLessThanOrEqual(64);
      expect(Math.abs(pic.width / pic.height - 0.75), 'пропорции страницы сохранены').toBeLessThan(0.02);

      // Кнопка Extract pages достижима на панели в одну строку; диалог и подтверждение на экране.
      const extract = barBtn(page, 'Extract pages');
      await extract.scrollIntoViewIfNeeded();
      await expectFree(page, 'Extract pages', extract);
      await extract.tap();
      const dialog = page.getByRole('dialog', { name: 'Extract pages' });
      await dialog.getByLabel('Page 2', { exact: true }).check();
      const confirm = dialog.getByRole('button', { name: 'Extract', exact: true });
      await confirm.scrollIntoViewIfNeeded();
      await confirm.tap();
      await expect(ofKind(page, 'pdf')).toHaveCount(2, { timeout: 15_000 });
      const other = (await idsOf(ofKind(page, 'pdf'))).find((x) => x !== id)!;
      await expectPageColor(page, other, 'green');

      await page.keyboard.press('Escape').catch(() => {});
      await deselectByTap(page, id);
      const shown = await pictureBox(sheet);
      expect(shown.y).toBeGreaterThanOrEqual(c.y - 0.5);
      expect(await coveredPoints(page, shown, id), 'страница без выделения ничем не закрыта').toEqual([]);
      expect(shown.height, 'страница различима').toBeGreaterThanOrEqual(80);
      await page.screenshot({ path: test.info().outputPath(`pdf-deselected-${title}.png`) });
    } finally {
      await owner.close();
    }
  });

  test(`FIL-01 MOB-06 UI-04 BUG-031 ${title}: a new file label is on screen, can be renamed and downloaded from the bar`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('qa') }, 'file');
      const c = await boxOf(canvas(page));
      const o = await boxOf(obj(page, id));
      expect(o.y).toBeGreaterThanOrEqual(c.y);
      expect(o.y + o.height).toBeLessThanOrEqual(c.y + c.height);
      expect(o.x).toBeGreaterThanOrEqual(0);
      expect(o.x + o.width).toBeLessThanOrEqual(size.width);
      await page.screenshot({ path: test.info().outputPath(`file-${title}.png`) });
      const name = fileNameField(page);
      await name.scrollIntoViewIfNeeded();
      await name.fill('renamed.txt');
      await expect(obj(page, id)).toContainText('renamed.txt');
      const link = selectionBar(page).getByRole('link', { name: 'Download', exact: true });
      await link.scrollIntoViewIfNeeded();
      const b = await boxOf(link);
      expect(b.x).toBeGreaterThanOrEqual(-0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(size.width + 0.5);
      expect(Math.min(b.width, b.height), 'Download не меньше 44 px').toBeGreaterThanOrEqual(MIN_TARGET);
      await expect(link).toHaveAttribute('href', /download=renamed\.txt/);
    } finally {
      await owner.close();
    }
  });
}

const LOW_PHONES = PHONES.filter(([, s]) => s.height <= 568);

for (const [title, size] of LOW_PHONES) {
  test(`FIL-03 CVS-14 MOB-06 BUG-031 ${title}: a small new video grows by its corner on the phone and on the desktop client`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const desk = await openGuest(browser, { baseURL, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } as Opts, owner.token, 'QA Desk');
    try {
      const id = await uploadViaTool(owner.page, fixture('sample.mp4', 'video/mp4'), 'video');
      await expect(obj(desk.page, id)).toBeVisible();
      const raw = await untilRaw(owner.page, owner.boardId, (o) => expect(o[id]).toBeTruthy());
      const frameDesk = obj(desk.page, id).locator('video').first();
      await expect.poll(() => frameDesk.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
      const before = await pictureBox(frameDesk);
      log031(`${title} видео в документе ${raw[id].width}x${raw[id].height}; у клиента 1440×900 кадр ${Math.round(before.width)}x${Math.round(before.height)} в рамке ${Math.round(before.boxW)}x${Math.round(before.boxH)}`);
      await desk.page.screenshot({ path: test.info().outputPath(`desktop-${title}.png`) });

      // Компьютер: выделить и растянуть за правый нижний угол, кадр растёт.
      await selectObj(desk.page, id);
      await expect(handle(desk.page, 'se')).toBeVisible();
      const se = await boxOf(handle(desk.page, 'se'));
      await dragBy(desk.page, { x: se.x + se.width / 2, y: se.y + se.height / 2 }, { x: 240, y: 240 });
      const grown = await pictureBox(frameDesk);
      log031(`${title} после растяжения на компьютере: кадр ${Math.round(grown.width)}x${Math.round(grown.height)}`);
      expect(grown.height, 'кадр вырос').toBeGreaterThan(before.height + 50);
      await obj(desk.page, id).getByRole('button', { name: 'Play', exact: true }).click();
      await expect(player(desk.page, id)).toHaveAttribute('data-playing', 'true');
      await obj(desk.page, id).getByRole('button', { name: 'Pause', exact: true }).click();

      // Телефон: тот же жест пальцем на новом объекте.
      const second = await uploadViaTool(owner.page, fixture('sample.webm', 'video/webm'), 'video');
      const frame = obj(owner.page, second).locator('video').first();
      await expect.poll(() => frame.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
      const small = await boxOf(obj(owner.page, second));
      const h = await boxOf(handle(owner.page, 'se'));
      const touch = await Touch.of(owner.page);
      const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
      await touch.gesture([from], [{ x: from.x - 4, y: Math.min(from.y + 90, size.height - 4) }], 12);
      await expect.poll(async () => (await boxOf(obj(owner.page, second))).height, { message: 'объект вырос касанием' }).toBeGreaterThan(small.height + 20);
    } finally {
      await desk.close();
      await owner.close();
    }
  });
}

async function deleteByMouse(page: Page, id: string) {
  await selectObj(page, id);
  await barBtn(page, 'Delete').click();
  await expect(obj(page, id)).toHaveCount(0);
}

const WINDOWS = [
  ['1440x900', { width: 1440, height: 900 }],
  ['1024x768', { width: 1024, height: 768 }],
  ['1280x600', { width: 1280, height: 600 }],
] as const;

for (const [title, size] of WINDOWS) {
  test(`FIL-01 FIL-02 FIL-03 FIL-04 BUG-031 desktop ${title}: new objects stay in the view centre, the page is not scrolled`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const owner = await openOwner(browser, profileOpts({ baseURL, viewport: size, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    const page = owner.page;
    try {
      const files: [FilePayload, string][] = [
        [pdf3(), 'pdf'],
        [fixture('sample.mp4', 'video/mp4'), 'video'],
        [fixture('tone.mp3', 'audio/mpeg'), 'audio'],
        [{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('a') }, 'file'],
      ];
      for (const [file, kind] of files) {
        const id = await uploadViaTool(page, file, kind);
        const c = await boxOf(canvas(page));
        const o = await boxOf(obj(page, id));
        const dx = o.x + o.width / 2 - (c.x + c.width / 2);
        const dy = o.y + o.height / 2 - (c.y + c.height / 2);
        log031(`desktop ${title} ${kind}: ${Math.round(o.width)}x${Math.round(o.height)}, от центра ${Math.round(dx)},${Math.round(dy)}, холст ${c.width}x${c.height}`);
        // Страница на 1024×768 выше окна на 1 px: большей прокрутки быть не должно.
        expect(await page.evaluate(() => Math.max(window.scrollX, window.scrollY)), 'страница не прокручена').toBeLessThanOrEqual(1);
        expect(o.y, 'верх в холсте').toBeGreaterThanOrEqual(c.y);
        expect(o.y + o.height, 'низ в холсте').toBeLessThanOrEqual(c.y + c.height);
        expect(Math.abs(dx), `${kind} по центру`).toBeLessThanOrEqual(1);
        // Объект, который дотянулся бы до миникарты, только поднимается над ней (BUG-031).
        const map = await boxOf(minimap(page));
        if (Math.abs(dy) > 1) {
          expect(dy, `${kind} только выше центра`).toBeLessThan(0);
          expect(o.y + o.height, `${kind} над миникартой`).toBeLessThanOrEqual(map.y + 0.5);
        }
        await deleteByMouse(page, id);
      }
    } finally {
      await owner.close();
    }
  });
}

const LOW_BARS = [
  ['low desktop window', { width: 1024, height: 450 }, false],
  ['landscape phone', { width: 839, height: 412 }, true],
] as const;

for (const [title, size, touch] of LOW_BARS) {
  test(`CVS-14 MOB-06 UI-04 BUG-031 ${title}: every action of the one-row selection bar can be reached`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    test.skip(touch !== isMobile, 'размер соответствует одному профилю');
    const owner = await openOwner(browser, profileOpts({ baseURL, viewport: size, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    const page = owner.page;
    try {
      const shared = { y: 120, width: 120, height: 80, rotation: 0, z: 1 };
      await seed(page, owner.boardId, {
        s1: { ...shared, x: 90, type: 'sticky', fill: '#fde68a', text: 'a' },
        s2: { ...shared, x: 280, z: 2, type: 'shape', shape: 'rect', text: '' },
      });
      for (const id of ['s1', 's2']) {
        await expect(obj(page, id)).toBeVisible();
        await canvas(page).scrollIntoViewIfNeeded();
        const b = await boxOf(obj(page, id));
        const p = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        if (touch) await page.touchscreen.tap(p.x, p.y);
        else await page.mouse.click(p.x, p.y);
        await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
        const bar = selectionBar(page);
        const box = await boxOf(bar);
        await page.screenshot({ path: test.info().outputPath(`bar-${id}.png`) });
        expect(box.height, 'панель — одна строка').toBeLessThanOrEqual(64);
        expect(box.x, 'панель в окне').toBeGreaterThanOrEqual(-0.5);
        expect(box.x + box.width, 'панель в окне').toBeLessThanOrEqual(size.width + 0.5);
        const buttons = bar.getByRole('button');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(2);
        const unreachable: string[] = [];
        for (let i = 0; i < count; i++) {
          const btn = buttons.nth(i);
          if (!(await btn.isVisible())) continue;
          await btn.scrollIntoViewIfNeeded();
          const r = await btn.evaluate((el) => {
            const q = el.getBoundingClientRect();
            const top = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2);
            return { label: el.getAttribute('aria-label') ?? el.textContent, x: q.x, right: q.right, ok: !!top && (top === el || el.contains(top)) };
          });
          if (!r.ok || r.x < -0.5 || r.right > size.width + 0.5) unreachable.push(String(r.label));
        }
        expect(unreachable, `недостижимы действия ${id}`).toEqual([]);
        // Снять выделение перед следующим объектом.
        await deselectEmpty(page, touch);
      }
    } finally {
      await owner.close();
    }
  });
}

async function deselectEmpty(page: Page, touch: boolean) {
  const c = await boxOf(canvas(page));
  const p = { x: c.x + 8, y: c.y + c.height - 8 };
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await expect(selectionBar(page)).toHaveCount(0);
}

test('FIL-02 FIL-03 MOB-06 BUG-031 landscape: a second object after the first and a moved view keep the controls free', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const size = { width: 839, height: 412 };
  const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
  const page = owner.page;
  try {
    const first = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
    await expectVideoFree(page, first);
    await barBtn(page, 'Delete').tap();
    await expect(obj(page, first)).toHaveCount(0);
    const second = await uploadViaTool(page, pdf3(), 'pdf');
    await expectPageColor(page, second, 'red');
    await expectPdfFree(page, second);
    await barBtn(page, 'Delete').tap();
    await expect(obj(page, second)).toHaveCount(0);
    const c = await boxOf(canvas(page));
    const touch = await Touch.of(page);
    await touch.gesture([{ x: c.x + 60, y: c.y + c.height - 40 }], [{ x: c.x + 260, y: c.y + c.height - 120 }]);
    const moved = await uploadViaTool(page, fixture('sample.webm', 'video/webm'), 'video');
    await expectVideoFree(page, moved);
  } finally {
    await owner.close();
  }
});

for (const [title, size] of LOW_PHONES) {
  test(`FIL-02 CVS-02 CVS-14 MOB-06 BUG-031 ${title}: a small new PDF page can be enlarged by the corner and by zoom and stays sharp`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, pdf3(), 'pdf');
      await expectPageColor(page, id, 'red');
      const sheet = obj(page, id).locator('canvas').first();
      const small = await pictureBox(sheet);

      // Угол: страница растёт на самом объекте.
      const h = await boxOf(handle(page, 'se'));
      const touch = await Touch.of(page);
      // На 320 px объект шире холста: маркер виден наполовину, палец ставится на видимую часть.
      const edge = await boxOf(canvas(page));
      const from = { x: Math.min(h.x + h.width / 2, edge.x + edge.width - 2), y: h.y + h.height / 2 };
      await touch.gesture([from], [{ x: from.x - 2, y: Math.min(from.y + 90, size.height - 4) }], 12);
      await expect.poll(async () => (await pictureBox(sheet)).height, { message: 'страница выросла' }).toBeGreaterThan(small.height + 40);

      // Масштаб вида: страница крупнее, битовой карты хватает на резкий показ.
      const before = await pictureBox(sheet);
      await page.getByRole('button', { name: /zoom in/i }).first().tap();
      await page.getByRole('button', { name: /zoom in/i }).first().tap();
      await expect.poll(async () => (await pictureBox(sheet)).height).toBeGreaterThan(before.height * 1.1);
      const bitmap = await sheet.evaluate((c) => (c as HTMLCanvasElement).height);
      const shown = await pictureBox(sheet);
      log031(`${title} PDF: страница ${Math.round(small.width)}x${Math.round(small.height)} → ${Math.round(shown.width)}x${Math.round(shown.height)}, canvas ${bitmap} px`);
      expect(bitmap, 'битовая карта не меньше показанного').toBeGreaterThanOrEqual(shown.height);
    } finally {
      await owner.close();
    }
  });
}

// ---------- Перепроверка BUG-032: случайное касание, панель выделения, размер в документе ----------

const log032 = (line: string) => {
  console.log(`наблюдение BUG-032 ${line}`);
  test.info().annotations.push({ type: 'наблюдение BUG-032', description: line });
};

type BarHit = { x: number; y: number; label: string };

/** Точки сетки по видимой части объекта, где палец попадёт в панель выделения, а не в объект. */
async function barOverObject(page: Page, id: string): Promise<{ total: number; hits: BarHit[] }> {
  return page.evaluate((oid) => {
    const box = document.querySelector(`[data-object-id="${oid}"]`)!.getBoundingClientRect();
    const view = document.querySelector('[data-testid="board-canvas"]')!.getBoundingClientRect();
    const bar = document.querySelector('[role="toolbar"][aria-label="Selection"]');
    const left = Math.max(box.left, view.left, 0);
    const right = Math.min(box.right, view.right, innerWidth);
    const top = Math.max(box.top, view.top, 0);
    const bottom = Math.min(box.bottom, view.bottom, innerHeight);
    const hits: BarHit[] = [];
    let total = 0;
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 12; j++) {
        const x = left + ((right - left) * i) / 16;
        const y = top + ((bottom - top) * j) / 12;
        total++;
        const el = document.elementFromPoint(x, y);
        if (el && bar?.contains(el)) {
          const control = el.closest('button, a, select, input');
          hits.push({ x, y, label: control?.getAttribute('aria-label') ?? control?.textContent ?? '(панель)' });
        }
      }
    }
    return { total, hits };
  }, id);
}

/** Геометрия и блокировка объекта в документе: всё, что не должно меняться от случайного касания. */
const keyOf = (o: Record<string, unknown>) => JSON.stringify([o.x, o.y, o.width, o.height, o.locked ?? false]);

/** Касания по сетке всей видимой части: объект не удалён, не заблокирован, не скопирован и не сдвинут. */
async function sweepTaps(page: Page, id: string, boardId: string, kind: string) {
  const before = await rawObjects(page, boardId);
  const count = Object.keys(before).length;
  const box = await boxOf(obj(page, id));
  const view = await boxOf(canvas(page));
  const left = Math.max(box.x, view.x, 0);
  const right = Math.min(box.x + box.width, view.x + view.width, page.viewportSize()!.width);
  const top = Math.max(box.y, view.y, 0);
  const bottom = Math.min(box.y + box.height, view.y + view.height, page.viewportSize()!.height);
  const lost: string[] = [];
  for (const fy of [0.02, 0.1, 0.25, 0.5, 0.75, 0.98]) {
    for (const fx of [0.05, 0.25, 0.5, 0.75, 0.95]) {
      if ((await obj(page, id).getAttribute('aria-selected')) !== 'true') await selectObj(page, id, true);
      const x = left + (right - left) * fx;
      const y = top + (bottom - top) * fy;
      await page.touchscreen.tap(x, y);
      await page.waitForTimeout(40);
      // Касание могло попасть в `Full screen` плеера: это его действие, для следующего касания выйти.
      await page.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : undefined));
      await page.keyboard.press('Escape').catch(() => {});
      if ((await obj(page, id).count()) === 0) {
        lost.push(`${Math.round(x)},${Math.round(y)}: объект удалён`);
        break;
      }
      if ((await obj(page, id).getAttribute('data-locked')) === 'true') {
        lost.push(`${Math.round(x)},${Math.round(y)}: объект заблокирован`);
        break;
      }
    }
    if (lost.length) break;
  }
  expect(lost, `${kind}: случайное касание`).toEqual([]);
  const after = await rawObjects(page, boardId);
  expect(Object.keys(after).length, 'объектов столько же').toBe(count);
  expect(keyOf(after[id]), 'положение, размер и блокировка в документе прежние').toBe(keyOf(before[id]));
}

for (const [title, size] of PHONES) {
  test(`FIL-03 MOB-06 BUG-032 ${title}: selection bar does not cover a new video, a tap anywhere on it neither deletes nor locks it`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      const frame = obj(page, id).locator('video').first();
      await expect.poll(() => frame.evaluate((v) => (v as HTMLVideoElement).videoWidth)).toBeGreaterThan(0);
      const c = await boxOf(canvas(page));
      const o = await boxOf(obj(page, id));
      const bar = await boxOf(selectionBar(page));
      const map = await boxOf(minimap(page));
      const pic = await pictureBox(frame);
      const share = intersection(bar, pic) / (pic.width * pic.height);
      const over = await barOverObject(page, id);
      log032(`${title} видео: холст ${c.width}x${c.height}, объект ${Math.round(o.width)}x${Math.round(o.height)} y=${Math.round(o.y - c.y)}, кадр ${Math.round(pic.width)}x${Math.round(pic.height)}, панель y=${Math.round(bar.y - c.y)} h=${Math.round(bar.height)} w=${Math.round(bar.width)}, миникарта y=${Math.round(map.y - c.y)}, панель над миникартой ${Math.round(intersection(bar, map))} px2, закрыто кадра ${Math.round(share * 100)} %, панель над объектом ${over.hits.length}/${over.total}: ${[...new Set(over.hits.map((h) => h.label))].join(', ')}`);
      await page.screenshot({ path: test.info().outputPath(`video-${title}.png`) });
      expect(share, 'панель не закрывает кадр').toBe(0);
      expect(over.hits.map((h) => h.label), 'под пальцем на объекте нет кнопок панели').toEqual([]);
      await sweepTaps(page, id, owner.boardId, 'видео');
      // Те же действия доступны прямым нажатием.
      await selectObj(page, id, true);
      const del = barBtn(page, 'Delete');
      await del.scrollIntoViewIfNeeded();
      expect(Math.min((await boxOf(del)).width, (await boxOf(del)).height), 'Delete не меньше 44 px').toBeGreaterThanOrEqual(MIN_TARGET);
      await del.tap();
      await expect(obj(page, id)).toHaveCount(0);
    } finally {
      await owner.close();
    }
  });

  test(`FIL-02 MOB-06 BUG-032 ${title}: selection bar does not cover a new PDF, the page is legible, a tap anywhere neither deletes nor locks it`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, pdf3(), 'pdf');
      await expectPageColor(page, id, 'red');
      const sheet = obj(page, id).locator('canvas').first();
      const c = await boxOf(canvas(page));
      const o = await boxOf(obj(page, id));
      const bar = await boxOf(selectionBar(page));
      const pic = await pictureBox(sheet);
      const share = intersection(bar, pic) / (pic.width * pic.height);
      const over = await barOverObject(page, id);
      log032(`${title} PDF: холст ${c.width}x${c.height}, объект ${Math.round(o.width)}x${Math.round(o.height)}, страница ${Math.round(pic.width)}x${Math.round(pic.height)}, панель y=${Math.round(bar.y - c.y)}, закрыто ${Math.round(share * 100)} %, панель над объектом ${over.hits.length}/${over.total}: ${[...new Set(over.hits.map((h) => h.label))].join(', ')}`);
      await page.screenshot({ path: test.info().outputPath(`pdf-${title}.png`) });
      expect(share, 'панель не закрывает страницу').toBe(0);
      expect(over.hits.map((h) => h.label), 'под пальцем на объекте нет кнопок панели').toEqual([]);
      expect(pic.height, 'страница больше прежних 60×80').toBeGreaterThan(80);
      await sweepTaps(page, id, owner.boardId, 'PDF');
    } finally {
      await owner.close();
    }
  });

  test(`FIL-02 FIL-03 MOB-06 BUG-032 ${title} observation: after reload the same video is at document size; what the bar covers and which controls are reachable`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      await untilRaw(page, owner.boardId, (o) => expect(o[id]).toBeTruthy());
      await page.reload();
      await expect(obj(page, id)).toBeVisible({ timeout: 20_000 });
      await selectObj(page, id, true);
      const c = await boxOf(canvas(page));
      const o = await boxOf(obj(page, id));
      const over = await barOverObject(page, id);
      const state = await page.evaluate((oid) => {
        const box = document.querySelector(`[data-object-id="${oid}"]`)!;
        const out: Record<string, string> = {};
        for (const el of box.querySelectorAll('button, input, select')) {
          const r = el.getBoundingClientRect();
          const name = el.getAttribute('aria-label') ?? el.textContent ?? '?';
          const cx = r.x + r.width / 2;
          const cy = r.y + r.height / 2;
          const top = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
          out[name] = !top ? 'за экраном' : el === top || el.contains(top) ? 'свободна' : `закрыта ${top.closest('[role=toolbar]')?.getAttribute('aria-label') ?? top.closest('[data-testid]')?.getAttribute('data-testid') ?? top.className}`;
        }
        return out;
      }, id);
      log032(`${title} после перезагрузки: холст ${c.width}x${c.height}, объект ${Math.round(o.width)}x${Math.round(o.height)} x=${Math.round(o.x)} y=${Math.round(o.y - c.y)}; панель над объектом ${over.hits.length}/${over.total}: ${[...new Set(over.hits.map((h) => h.label))].join(', ')}; кнопки ${JSON.stringify(state)}`);
      await page.screenshot({ path: test.info().outputPath(`reloaded-${title}.png`) });
      // Второй телефон того же размера видит то же самое, что загрузивший после перезагрузки.
      const phone2 = await openGuest(browser, profileOpts({ baseURL, viewport: size, hasTouch, isMobile, userAgent, deviceScaleFactor }), owner.token, 'QA Phone 2');
      try {
        await expect(obj(phone2.page, id)).toBeVisible({ timeout: 20_000 });
        const b2 = await boxOf(obj(phone2.page, id));
        log032(`${title} второй телефон: объект ${Math.round(b2.width)}x${Math.round(b2.height)}`);
      } finally {
        await phone2.close();
      }
      // MOB-06: действия остаются доступны после уменьшения вида.
      await page.keyboard.press('Escape').catch(() => {});
      const play = control(page, id, 'Play');
      await zoomOutUntilReachable(page, play);
      await play.tap({ timeout: 5_000 });
      await expect(player(page, id)).toHaveAttribute('data-playing', 'true');
    } finally {
      await owner.close();
    }
  });
}

for (const [title, size] of LOW_PHONES) {
  test(`FIL-03 MOB-06 BUG-032 ${title}: after reload a tap anywhere on the selected video neither deletes nor locks it`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      await untilRaw(page, owner.boardId, (o) => expect(o[id]).toBeTruthy());
      await page.reload();
      await expect(obj(page, id)).toBeVisible({ timeout: 20_000 });
      await sweepTaps(page, id, owner.boardId, 'видео после перезагрузки');
    } finally {
      await owner.close();
    }
  });

  test(`FIL-03 MOB-06 BUG-032 ${title}: a new video moved down the canvas: a tap on it neither deletes nor locks it`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      const o = await boxOf(obj(page, id));
      const touch = await Touch.of(page);
      const from = { x: o.x + o.width / 2, y: o.y + 8 };
      await touch.gesture([from], [{ x: from.x, y: from.y + 70 }], 10);
      await expect.poll(async () => (await boxOf(obj(page, id))).y, { message: 'объект сдвинут' }).toBeGreaterThan(o.y + 30);
      const over = await barOverObject(page, id);
      log032(`${title} сдвинутое видео: панель над объектом ${over.hits.length}/${over.total}: ${[...new Set(over.hits.map((h) => h.label))].join(', ')}`);
      await page.screenshot({ path: test.info().outputPath(`moved-${title}.png`) });
      await sweepTaps(page, id, owner.boardId, 'сдвинутое видео');
    } finally {
      await owner.close();
    }
  });

  test(`MOB-06 BUG-032 ${title} observation: a large sticky under the bar`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const page = owner.page;
    try {
      const shared = { x: 20, y: 20, width: 460, height: 340, rotation: 0, z: 1 };
      await seed(page, owner.boardId, {
        big1: { ...shared, type: 'sticky', fill: '#fde68a', text: 'a' },
      });
      await expect(obj(page, 'big1')).toBeVisible();
      await selectObj(page, 'big1', true);
      const over = await barOverObject(page, 'big1');
      log032(`${title} большой стикер: панель над объектом ${over.hits.length}/${over.total}: ${[...new Set(over.hits.map((h) => h.label))].join(', ')}`);
      await page.screenshot({ path: test.info().outputPath(`sticky-${title}.png`) });
    } finally {
      await owner.close();
    }
  });

  test(`FIL-02 FIL-03 FIL-04 COL-01 BUG-032 ${title}: document size does not depend on the uploader's window; desktop sees the same size as a desktop upload`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const deskOpts = { baseURL, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } as Opts;
    const desk = await openGuest(browser, deskOpts, owner.token, 'QA Desk');
    const ownDesk = await openOwner(browser, deskOpts);
    try {
      for (const [file, kind] of [[fixture('sample.mp4', 'video/mp4'), 'video'], [pdf3(), 'pdf'], [fixture('tone.mp3', 'audio/mpeg'), 'audio']] as [FilePayload, string][]) {
        const id = await uploadViaTool(owner.page, file, kind);
        const ref = await upload(ownDesk.page, file, kind);
        const raw = await untilRaw(owner.page, owner.boardId, (o) => expect(o[id]).toBeTruthy());
        const rawRef = await untilRaw(ownDesk.page, ownDesk.boardId, (o) => expect(o[ref]).toBeTruthy());
        expect([raw[id].width, raw[id].height], `${kind}: размер в документе как при загрузке с компьютера`).toEqual([rawRef[ref].width, rawRef[ref].height]);
        await expect(obj(desk.page, id)).toBeVisible();
        const seen = await boxOf(obj(desk.page, id));
        const shownPhone = await boxOf(obj(owner.page, id));
        log032(`${title} ${kind}: документ ${raw[id].width}x${raw[id].height}, у компьютера ${Math.round(seen.width)}x${Math.round(seen.height)}, у загрузившего ${Math.round(shownPhone.width)}x${Math.round(shownPhone.height)}`);
        expect(Math.abs(seen.width - Number(raw[id].width)), 'компьютер показывает размер из документа').toBeLessThanOrEqual(2);
        expect(Math.abs(seen.height - Number(raw[id].height)), 'высота по документу').toBeLessThanOrEqual(2);
        await barBtn(owner.page, 'Delete').tap();
        await expect(obj(desk.page, id)).toHaveCount(0);
      }
    } finally {
      await ownDesk.close();
      await desk.close();
      await owner.close();
    }
  });

  test(`FIL-03 CVS-14 CVS-16 COL-01 BUG-032 ${title}: moving, stretching, undo, copy and reload of a fitted video stay consistent for both clients`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    mobileOnly(isMobile);
    const owner = await openPhone(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, size);
    const desk = await openGuest(browser, { baseURL, viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } as Opts, owner.token, 'QA Desk');
    const page = owner.page;
    try {
      const id = await uploadViaTool(page, fixture('sample.mp4', 'video/mp4'), 'video');
      const raw0 = await untilRaw(page, owner.boardId, (o) => expect(o[id]).toBeTruthy());
      const shown = await boxOf(obj(page, id));
      const touch = await Touch.of(page);

      // Растяжение на телефоне: что видит компьютер.
      const h = await boxOf(handle(page, 'se'));
      const edge = await boxOf(canvas(page));
      const start = { x: Math.min(h.x + h.width / 2, edge.x + edge.width - 2), y: h.y + h.height / 2 };
      await touch.gesture([start], [{ x: start.x - 2, y: Math.min(start.y + 40, size.height - 4) }], 12);
      const raw2 = await untilRaw(page, owner.boardId, (o) => expect(o[id].height).not.toBe(raw0[id].height));
      const afterPhone = await boxOf(obj(page, id));
      log032(`${title} растяжение на телефоне: показано было ${Math.round(shown.width)}x${Math.round(shown.height)}, стало ${Math.round(afterPhone.width)}x${Math.round(afterPhone.height)}; документ был ${raw0[id].width}x${raw0[id].height}, стал ${raw2[id].width}x${raw2[id].height}`);
      expect(Math.abs(afterPhone.height - Number(raw2[id].height)), 'после растяжения телефон показывает размер из документа').toBeLessThanOrEqual(2);
      expect.soft(Number(raw2[id].height), 'жест увеличения не уменьшает объект у других участников').toBeGreaterThanOrEqual(Number(raw0[id].height));
      expect.soft(Number(raw2[id].width), 'жест увеличения не уменьшает объект у других участников').toBeGreaterThanOrEqual(Number(raw0[id].width));
      await expect.poll(async () => Math.round((await boxOf(obj(desk.page, id))).height)).toBe(Math.round(Number(raw2[id].height)));
      await page.screenshot({ path: test.info().outputPath(`stretched-${title}.png`) });

      // Отмена возвращает прежний размер документа.
      await page.getByRole('button', { name: 'Undo', exact: true }).tap();
      const raw3 = await untilRaw(page, owner.boardId, (o) => expect(o[id].height).toBe(raw0[id].height));
      expect(raw3[id].width).toBe(raw0[id].width);
      await expect.poll(async () => Math.round((await boxOf(obj(page, id))).height), { message: 'после отмены показ по виду вернулся' }).toBe(Math.round(shown.height));


      // Перемещение: в документе меняются только координаты.
      const again = await boxOf(obj(page, id));
      const from = { x: again.x + again.width / 2, y: again.y + 8 };
      await touch.gesture([from], [{ x: from.x, y: from.y + 30 }], 10);
      const raw1 = await untilRaw(page, owner.boardId, (o) => expect(o[id].y).not.toBe(raw0[id].y));
      expect([raw1[id].width, raw1[id].height], 'перемещение не меняет размер в документе').toEqual([raw0[id].width, raw0[id].height]);
      await expect.poll(async () => Math.round((await boxOf(obj(desk.page, id))).width)).toBe(Number(raw0[id].width));


      // Копия получает размер из документа.
      await desk.page.bringToFront();
      await selectObj(desk.page, id);
      await desk.page.keyboard.press('Control+d');
      const raw4 = await untilRaw(page, owner.boardId, (o) => expect(Object.keys(o).length).toBe(2));
      const copy = Object.keys(raw4).find((k) => k !== id)!;
      expect([raw4[copy].width, raw4[copy].height], 'копия размером из документа').toEqual([raw0[id].width, raw0[id].height]);

      // Перезагрузка: телефон показывает размер из документа, координаты те же.
      await page.reload();
      await expect(obj(page, id)).toBeVisible({ timeout: 20_000 });
      const raw5 = await rawObjects(page, owner.boardId);
      expect([raw5[id].x, raw5[id].y]).toEqual([raw1[id].x, raw1[id].y]);
    } finally {
      await desk.close();
      await owner.close();
    }
  });
}
