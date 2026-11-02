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
import { canvas, docSeenByLateClient, dragBy, openGuest, openOwner, profileOpts, type Opts } from './camera';
import { allObjects, boxOf, obj, onCanvas, seed, selectionBar, tool, type Obj } from './scene';

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
  test.fail(true, 'BUG-029 (minor): открыт, убрать пометку после исправления');
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
  test.fail(true, 'BUG-030 (minor): открыт, убрать пометку после исправления');
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
  test.fail(true, 'BUG-030 (minor): открыт, убрать пометку после исправления');
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
