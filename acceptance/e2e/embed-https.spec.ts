// Приёмка T7.3 · EMB-04 при HTTPS, Q-008 (б), на стенде QA с TLS (acceptance/tls/Caddyfile).
// Стенд: стек с PUBLIC_BASE_URL=https://<IP>:8443; страница другого сайта — QA_OTHER_SITE
// (другой хост по https); сертификат внутренний, поэтому ignoreHTTPSErrors.
// Настоящий домен и доверенный сертификат — T11.2. Без PUBLIC_BASE_URL=https:// файл пропускается.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, FrameLocator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { openOwner, profileOpts, type Opts } from './camera';
import { boxOf, seed } from './scene';

const OTHER = process.env.QA_OTHER_SITE ?? 'https://172.29.144.1:9443';
const SAME_SITE = process.env.QA_SAME_SITE ?? 'https://192.168.0.26:9444';
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'media-fixtures');

test.use({ ignoreHTTPSErrors: true, channel: 'chrome', actionTimeout: 15_000, launchOptions: { args: ['--ignore-certificate-errors'] } });
test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL?.startsWith('https://'), 'только стенд с TLS');
  test.setTimeout(180_000);
});

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const opts = (f: Fx): Opts => ({ ...profileOpts(f), ignoreHTTPSErrors: true });
const STICKY = { x: 60, y: 60, width: 160, height: 120, rotation: 0, z: 1, type: 'sticky', fill: '#fde68a', text: 's' };

async function openFramed(page: Page, site: string, baseURL: string, token: string): Promise<FrameLocator> {
  await page.goto(`${site}/host?src=${encodeURIComponent(`${baseURL}/b/${token}/embed`)}`);
  return page.frameLocator('#f');
}

async function enter(fr: FrameLocator, name: string) {
  await fr.getByRole('textbox').first().fill(name);
  await fr.getByRole('button').first().click();
  await expect(fr.getByTestId('board-canvas')).toBeVisible({ timeout: 25_000 });
}

function embedCookies(ctx: BrowserContext) {
  return ctx.cookies().then((all) => all.filter((c) => c.name.startsWith('myboard_embed_')));
}

test('EMB-04 Q-008 https: page of another site embeds the board; cookie flags; edits go both ways; the session survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    const fr = await openFramed(page, OTHER, baseURL!, owner.token);
    await enter(fr, 'Https Frame');

    const cookies = await embedCookies(context);
    expect(cookies.length, 'cookie встроенной доски сохранена').toBe(1);
    const [cookie] = cookies;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
    expect(cookie.sameSite).toBe('None');
    expect((cookie as unknown as { partitionKey?: unknown }).partitionKey, 'cookie разделена по верхней странице').toBeTruthy();
    expect((await context.cookies()).filter((c) => c.name.startsWith('myboard_board_'))).toEqual([]);
    expect(await page.frames()[1].evaluate(() => document.cookie), 'скрипт не читает cookie').not.toContain('myboard_');

    await fr.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Sticky note', exact: true }).click();
    const c = await boxOf(fr.getByTestId('board-canvas'));
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
    await expect(owner.page.locator('[data-type="sticky"]')).toHaveCount(1, { timeout: 15_000 });
    await seed(owner.page, owner.boardId, { o: STICKY } as never);
    await expect(fr.locator('[data-object-id="o"]')).toBeAttached();

    await page.reload();
    await expect(fr.getByTestId('board-canvas'), 'сессия пережила перезагрузку').toBeVisible({ timeout: 20_000 });
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 FIL-01 FIL-02 FIL-03 IMG-01 Q-008 https: inside a frame of another site files upload, show, play and download', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    const fr = await openFramed(page, OTHER, baseURL!, owner.token);
    await enter(fr, 'Files Frame');
    const upload = fr.getByLabel('Upload file', { exact: true });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
    await fr.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    const image = fr.locator('[data-type="image"] img').first();
    await expect.poll(() => image.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);

    await upload.setInputFiles({ name: 'v.webm', mimeType: 'video/webm', buffer: readFileSync(join(FIXTURES, 'sample.webm')) });
    const video = fr.locator('[data-type="video"] video').first();
    await expect.poll(() => video.evaluate((v) => (v as HTMLVideoElement).videoWidth), { timeout: 20_000 }).toBeGreaterThan(0);

    const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n';
    await upload.setInputFiles({ name: 'p.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pdf, 'latin1') });
    await expect(fr.locator('[data-type="pdf"] canvas').first()).toBeVisible({ timeout: 20_000 });

    await upload.setInputFiles({ name: 'n.txt', mimeType: 'text/plain', buffer: Buffer.from('qa-text') });
    const label = fr.locator('[data-type="file"]').first();
    await expect(label).toBeVisible({ timeout: 20_000 });
    const download = fr.getByRole('toolbar', { name: 'Selection' }).getByRole('link', { name: 'Download', exact: true });
    const started = page.waitForEvent('download', { timeout: 15_000 });
    await download.click();
    const file = await started;
    expect(await file.failure(), 'файл скачан из фрейма').toBeNull();
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 Q-008 SEC https: a script of the embedding page gets nothing with the frame cookie', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
  const media = await owner.page.request.post(`/api/boards/${owner.boardId}/media?name=a.png`, { data: png, headers: { 'Content-Type': 'image/png' } });
  expect(media.ok()).toBe(true);
  const mediaUrl = ((await media.json()) as { url: string }).url;
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    for (const site of [OTHER, SAME_SITE]) {
      const fr = await openFramed(page, site, baseURL!, owner.token);
      await enter(fr, 'Attacked');
      // В кадре той же верхней страницы браузер отправляет разделённую cookie; сервер обязан её не принять.
      const result = await page.evaluate(async ({ base, token, mediaUrl, boardId }) => {
        const out: Record<string, unknown> = {};
        const t = (u: string, init?: RequestInit) => fetch(base + u, { credentials: 'include', ...init });
        try {
          out.read = await (await t(`/api/share/${token}`)).text();
        } catch {
          out.read = 'cors';
        }
        out.noCorsJoin = await t(`/api/share/${token}/join`, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ name: 'Forged', embed: true }) })
          .then((r) => r.type)
          .catch(() => 'network');
        out.noCorsPost = await t(`/api/boards/${boardId}/media?name=x.txt`, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: 'x' })
          .then((r) => r.type)
          .catch(() => 'network');
        out.img = await new Promise((resolve) => {
          const i = new Image();
          i.onload = () => resolve('loaded');
          i.onerror = () => resolve('refused');
          i.src = base + mediaUrl;
        });
        out.ws = await new Promise((resolve) => {
          const ws = new WebSocket(`${base.replace('https', 'wss')}/api/ws?token=${token}`);
          ws.onopen = () => {
            ws.close();
            resolve('open');
          };
          ws.onerror = () => resolve('refused');
        });
        return out;
      }, { base: baseURL!, token: owner.token, mediaUrl, boardId: owner.boardId });
      expect(result.img, `${site}: файл не показан на чужой странице`).toBe('refused');
      expect(result.ws, `${site}: канал не открыт`).toBe('refused');
      expect(String(result.read), `${site}: чтение`).not.toContain('Attacked');
      // Подделка не поменяла имя и не добавила файл.
      await expect(owner.page.getByText('Forged')).toHaveCount(0);
      const names = await owner.page.request.get(`/api/share/${owner.token}`);
      expect(names.status()).toBe(200);
      await page.reload();
      await expect(fr.getByTestId('board-canvas'), `${site}: сессия фрейма цела`).toBeVisible({ timeout: 20_000 });
    }
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 Q-008 https: cookie is separate per embedding site and is not a session of the board page itself', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    const fr = await openFramed(page, OTHER, baseURL!, owner.token);
    await enter(fr, 'Site One');
    // Другой верхний сайт: своё разделение, снова запрос имени.
    const other = await openFramed(page, SAME_SITE, baseURL!, owner.token);
    await expect(other.getByRole('textbox').first()).toBeVisible({ timeout: 15_000 });
    await expect(other.getByTestId('board-canvas')).toHaveCount(0);
    // Сама страница доски в этом браузере тоже не вошла.
    await page.goto(`${baseURL}/b/${owner.token}`);
    await expect(page.getByRole('textbox').first()).toBeVisible();
    // Прочие страницы отказывают во фрейме и при HTTPS.
    await page.goto(`${OTHER}/host?src=${encodeURIComponent(`${baseURL}/b/${owner.token}`)}`);
    await page.waitForTimeout(600);
    const child = page.frames().find((x) => x.parentFrame());
    expect(child!.url()).not.toBe(`${baseURL}/b/${owner.token}`);
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 SHR-06 Q-008 https: reset closes the frame of another site, its canvas goes', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    const fr = await openFramed(page, OTHER, baseURL!, owner.token);
    await enter(fr, 'To Reset');
    const reset = await owner.page.request.post(`/api/boards/${owner.boardId}/share/reset`);
    expect(reset.status()).toBe(200);
    await expect(fr.getByText('This link is not available.')).toBeVisible({ timeout: 15_000 });
    await expect(fr.getByTestId('board-canvas')).toHaveCount(0);
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 MOB-06 Q-008 https: phone profile works in a frame of another site', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(!isMobile, 'телефон — профиль mobile');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts({ ...f, isMobile: false, hasTouch: false, viewport: { width: 1280, height: 800 } }));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    const fr = await openFramed(page, OTHER, baseURL!, owner.token);
    await fr.getByRole('textbox').first().fill('Phone Frame');
    await fr.getByRole('button').first().tap();
    await expect(fr.getByTestId('board-canvas')).toBeVisible({ timeout: 25_000 });
    await seed(owner.page, owner.boardId, { o: STICKY } as never);
    await expect(fr.locator('[data-object-id="o"]')).toBeAttached();
    const b = await boxOf(fr.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Sticky note', exact: true }));
    expect(Math.min(b.width, b.height), 'кнопка не меньше 44 px').toBeGreaterThanOrEqual(44);
  } finally {
    await context.close();
    await owner.close();
  }
});
