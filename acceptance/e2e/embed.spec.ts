// Приёмка T7.3 · EMB-01…EMB-04 на обычном стеке (http://). Сценарии — docs/qa/reports/T7.3.md.
// Сайт-образец — контейнер acceptance/api/link_site.py: `linksite` из сети стека, снаружи порт 18099.
// Другой сайт: HOST_B (второй адрес той же машины). HTTPS — embed-https.spec.ts.
import type { Frame, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, openGuest, openOwner, profileOpts, type Opts } from './camera';
import { boxOf, obj, seed, selectionBar, tool } from './scene';

const HOST_B = process.env.QA_OTHER_HOST ?? '172.29.144.1';
const SITE_PORT = 18099;
const INTERNAL_SITE = 'http://linksite:8099';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const opts = (f: Fx) => profileOpts(f);
const hostA = (baseURL?: string) => new URL(baseURL!).hostname;
const siteB = () => `http://${HOST_B}:${SITE_PORT}`;
const siteA = (baseURL?: string) => `http://${hostA(baseURL)}:${SITE_PORT}`;

test.use({ actionTimeout: 15_000 });
test.beforeEach(() => test.setTimeout(120_000));

const ofKind = (page: Page, kind: string) => page.locator(`[data-object-id][data-type="${kind}"]`);
const firstOf = async (page: Page, kind: string) => (await ofKind(page, kind).first().getAttribute('data-object-id'))!;

async function allTool(page: Page, name: string) {
  await tool(page, 'All tools').click();
  await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name, exact: true }).click();
}

async function addEmbed(page: Page, code: string): Promise<string> {
  const before = await ofKind(page, 'iframe').count();
  await allTool(page, 'Embed');
  // Инструмент ставится касанием холста либо диалог открывается сразу; поддержаны оба пути.
  const dialog = page.getByRole('dialog', { name: 'Embed' });
  if (!(await dialog.isVisible())) {
    const c = await boxOf(canvas(page));
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 3);
  }
  await dialog.getByLabel('Iframe code').fill(code);
  await dialog.getByRole('button', { name: 'Add embed' }).click();
  await expect(ofKind(page, 'iframe')).toHaveCount(before + 1);
  return firstOf(page, 'iframe');
}

async function addCard(page: Page, address: string): Promise<string> {
  const before = await ofKind(page, 'linkcard').count();
  await allTool(page, 'Link card');
  const dialog = page.getByRole('dialog', { name: 'Link card' });
  if (!(await dialog.isVisible())) {
    const c = await boxOf(canvas(page));
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 3);
  }
  await dialog.getByLabel('Page address').fill(address);
  await dialog.getByRole('button', { name: 'Add card' }).click();
  await expect(ofKind(page, 'linkcard')).toHaveCount(before + 1, { timeout: 30_000 });
  return firstOf(page, 'linkcard');
}

async function pasteText(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
}

const STICKY = { x: 40, y: 40, width: 160, height: 120, rotation: 0, z: 1, type: 'sticky', fill: '#fde68a', text: 's' };

async function select(page: Page, id: string, touch = false) {
  const b = await boxOf(obj(page, id));
  const p = { x: b.x + b.width / 2, y: b.y + b.height - 14 };
  if (touch) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

async function attach(page: Page, id: string, address: string) {
  await select(page, id);
  await selectionBar(page).getByRole('button', { name: 'Link', exact: true }).click();
  await selectionBar(page).getByLabel('Link address').fill(address);
  await selectionBar(page).getByRole('button', { name: 'Attach link', exact: true }).click();
}

// ---------- EMB-01 ----------

test('EMB-01 iframe code from the panel makes an object for both clients; it survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const guest = await openGuest(browser, opts(f), owner.token, 'QA Guest');
  try {
    const src = `${siteB()}/page`;
    const id = await addEmbed(owner.page, `<iframe src="${src}" width="500" height="300"></iframe>`);
    for (const page of [owner.page, guest.page]) {
      await expect(obj(page, id).locator('iframe')).toHaveAttribute('src', src);
      await expect(obj(page, id)).toContainText(HOST_B);
    }
    // Участник по ссылке ставит свой объект тем же путём.
    await guest.page.keyboard.press('Escape');
    await addEmbed(guest.page, `<iframe src="${src}?2"></iframe>`);
    await expect(ofKind(owner.page, 'iframe')).toHaveCount(2);
    await owner.page.reload();
    await expect(obj(owner.page, id).locator('iframe')).toHaveAttribute('src', src);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('EMB-01 iframe code from the clipboard makes the same object; plain text does not', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'буфер — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    await pasteText(owner.page, `<iframe src="${siteB()}/page"></iframe>`);
    await expect(ofKind(owner.page, 'iframe')).toHaveCount(1);
    await expect(ofKind(owner.page, 'iframe').locator('iframe')).toHaveAttribute('src', `${siteB()}/page`);
    await pasteText(owner.page, 'Look: <iframe src="https://example.com"></iframe> text around');
    await pasteText(owner.page, '<iframe src="javascript:window.__pwned=1"></iframe>');
    await pasteText(owner.page, '<script>window.__pwned=2</script>');
    await expect(ofKind(owner.page, 'iframe')).toHaveCount(1);
    expect(await owner.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await owner.close();
  }
});

for (const [title, code] of [
  ['garbage', 'hello'],
  ['script', '<script>window.__pwned=1</script>'],
  ['no src', '<iframe></iframe>'],
  ['two frames', '<iframe src="https://a.example"></iframe><iframe src="https://b.example"></iframe>'],
  ['relative', '<iframe src="/login"></iframe>'],
  ['no scheme', '<iframe src="example.com"></iframe>'],
  ['protocol relative', '<iframe src="//example.com"></iframe>'],
  ['javascript', '<iframe src="javascript:window.__pwned=1"></iframe>'],
  ['JaVa with tab', '<iframe src="JaVa\tScRiPt:window.__pwned=1"></iframe>'],
  ['spaces and javascript', '<iframe src="  javascript:window.__pwned=1"></iframe>'],
  ['data', '<iframe src="data:text/html,<script>parent.__pwned=1</script>"></iframe>'],
  ['blob', '<iframe src="blob:http://x/1"></iframe>'],
  ['file', '<iframe src="file:///etc/passwd"></iframe>'],
  ['about', '<iframe src="about:blank"></iframe>'],
  ['srcdoc only', '<iframe srcdoc="<script>parent.__pwned=1</script>"></iframe>'],
  ['trailing script', '<iframe src="https://a.example"></iframe><script>window.__pwned=1</script>'],
] as const) {
  test(`EMB-01 SEC code refused: ${title}`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    test.skip(isMobile, 'мышь — профиль desktop');
    const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    try {
      await allTool(owner.page, 'Embed');
      const dialog = owner.page.getByRole('dialog', { name: 'Embed' });
      if (!(await dialog.isVisible())) {
        const c = await boxOf(canvas(owner.page));
        await owner.page.mouse.click(c.x + c.width / 2, c.y + c.height / 3);
      }
      await dialog.getByLabel('Iframe code').fill(code);
      await dialog.getByRole('button', { name: 'Add embed' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      expect(await ofKind(owner.page, 'iframe').count()).toBe(0);
      expect(await owner.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    } finally {
      await owner.close();
    }
  });
}

test('EMB-01 SEC extra attributes of the code do not reach the element; sandbox is ours', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const id = await addEmbed(owner.page, `<iframe src="${siteB()}/page" onload="window.__pwned=1" srcdoc="<script>parent.__pwned=2</script>" sandbox="allow-same-origin allow-scripts allow-top-navigation allow-modals" allow="camera; microphone; geolocation" allowfullscreen csp="x" name="evil" referrerpolicy="unsafe-url" style="position:fixed;inset:0;z-index:999" width="300" height="200"></iframe>`);
    const attrs = await obj(owner.page, id).locator('iframe').evaluate((el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value])));
    expect(attrs.src).toBe(`${siteB()}/page`);
    expect(attrs.srcdoc).toBeUndefined();
    expect(attrs.onload).toBeUndefined();
    expect(attrs.name).toBeUndefined();
    expect(attrs.csp).toBeUndefined();
    expect(attrs.style ?? '').not.toContain('fixed');
    expect(attrs.referrerpolicy).toBe('no-referrer');
    expect(attrs.allow ?? '').not.toMatch(/camera|microphone|geolocation/);
    const sandbox = (attrs.sandbox ?? '').split(/\s+/);
    expect(sandbox.length, 'sandbox задан').toBeGreaterThan(0);
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox.filter((v) => /top-navigation|modals|downloads|storage-access|orientation|pointer-lock|presentation/.test(v))).toEqual([]);
    expect(await owner.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await owner.close();
  }
});

test('EMB-01 SEC page inside the frame cannot reach the board, leave it or show dialogs; no referrer with the token', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const guest = await openGuest(browser, opts(f), owner.token, 'QA Guest');
  const marker = `b${Date.now()}`;
  const dialogs: string[] = [];
  guest.page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  try {
    await addEmbed(owner.page, `<iframe src="${siteB()}/bait?n=${marker}"></iframe>`);
    let reports: { path: string; referer: string | null; cookie: string | null }[] = [];
    await expect
      .poll(async () => {
        const log = (await (await guest.page.request.get(`${siteB()}/log`)).json()) as { path: string; referer: string | null; cookie: string | null }[];
        reports = log.filter((e) => e.path.includes('/report') && e.path.includes(marker));
        return reports.length;
      }, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(2);
    for (const r of reports) {
      const data = JSON.parse(new URL(`http://x${r.path}`).searchParams.get('data')!) as Record<string, unknown>;
      expect(data.parent, 'родитель недоступен').toBe('blocked');
      expect(data.top, 'верхнюю страницу не увести').toBe('blocked');
      expect(data.cookie, 'cookie не читаются').toBe('');
      expect(data.referrer, 'нет адреса с токеном').toBe('');
      expect(data.geo).toBeFalsy();
      expect(data.camera).toBeFalsy();
    }
    expect(dialogs).toEqual([]);
    await expect(canvas(guest.page)).toBeVisible();
    expect(new URL(guest.page.url()).pathname).toBe(`/b/${owner.token}`);
    const page = (await (await guest.page.request.get(`${siteB()}/log`)).json()) as { path: string; referer: string | null; cookie: string | null }[];
    for (const e of page.filter((x) => x.path.startsWith('/bait') && x.path.includes(marker))) {
      expect(e.referer, 'запрос страницы без адреса доски').toBeNull();
      expect(e.cookie, 'cookie доски не уходят').toBeNull();
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('EMB-01 SEC own site inside the frame: closed pages are not shown; the frame has no script access to the board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    for (const path of ['/login', `/boards/${owner.boardId}`, '/admin/users', `/b/${owner.token}`, '/api/session']) {
      const id = await addEmbed(page, `<iframe src="${baseURL}${path}"></iframe>`);
      await page.waitForTimeout(600);
      const frame = page.frames().find((fr) => fr.parentFrame() && fr.url().includes(path));
      if (frame) {
        const text = await frame.evaluate(() => document.body?.innerText ?? '').catch(() => 'недоступно');
        expect(text.includes('Sign in') || text.includes('authenticated'), `${path}: страница показана`).toBe(false);
      }
      await select(page, id);
      await page.keyboard.press('Delete');
      await expect(obj(page, id)).toHaveCount(0);
    }
    // Своя страница, разрешающая фрейм: скрипт фрейма не должен получить DOM доски зрителя.
    const id = await addEmbed(page, `<iframe src="${baseURL}/b/${owner.token}/embed"></iframe>`);
    const child = await expect
      .poll(() => page.frames().filter((fr) => fr.parentFrame() && fr.url().includes('/embed')).length, { timeout: 10_000 })
      .toBeGreaterThan(0)
      .then(() => page.frames().find((fr) => fr.parentFrame() && fr.url().includes('/embed'))!);
    const reach = await child.evaluate(() => {
      try {
        return String(window.parent.document.title);
      } catch {
        return 'blocked';
      }
    });
    expect(reach, 'sandbox со scripts и same-origin на своём адресе снимает защиту').toBe('blocked');
    expect(await obj(page, id).count()).toBe(1);
  } finally {
    await owner.close();
  }
});

test('EMB-01 EMB-02 EMB-03 SEC objects written past the interface do not run for the other client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const guest = await openGuest(browser, opts(f), owner.token, 'QA Guest');
  const dialogs: string[] = [];
  owner.page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  try {
    const base = { width: 200, height: 120, rotation: 0, z: 1 };
    const bad = [
      { src: 'javascript:window.__pwned=1' },
      { src: 'JAVASCRIPT:window.__pwned=2' },
      { src: ' java\nscript:window.__pwned=3' },
      { src: 'data:text/html,<script>parent.__pwned=4</script>' },
      { src: `${siteB()}/page`, srcdoc: '<script>parent.__pwned=5</script>', sandbox: 'allow-same-origin allow-scripts allow-top-navigation', onload: 'window.__pwned=6', allow: 'camera' },
      { src: 123 },
      { src: { href: 'javascript:window.__pwned=7' } },
      {},
    ];
    const items: Record<string, Record<string, unknown>> = {};
    bad.forEach((b, i) => {
      items[`i${i}`] = { ...base, x: 20 + i * 10, y: 20, type: 'iframe', ...b };
    });
    items.c1 = { ...base, x: 40, y: 200, type: 'linkcard', url: 'javascript:window.__pwned=8', text: '<img src=x onerror="window.__pwned=9">', media: 'javascript:window.__pwned=10' };
    items.c2 = { ...base, x: 300, y: 340, type: 'linkcard', url: 'data:text/html,x', text: 'd', media: '../../admin' };
    items.c3 = { ...base, x: 540, y: 340, type: 'linkcard', url: 7, text: 7 };
    items.s1 = { ...STICKY, x: 300, y: 40, link: 'javascript:window.__pwned=11' };
    items.s2 = { ...STICKY, x: 480, y: 40, link: 'vbscript:x' };
    items.s3 = { ...STICKY, x: 660, y: 40, linkObject: 7, link: 8 };
    items.s4 = { ...STICKY, x: 300, y: 200, link: '//evil.example/x' };
    await seed(owner.page, owner.boardId, items as never);
    await owner.page.waitForTimeout(800);
    const page = owner.page;
    await expect(canvas(page)).toBeVisible();
    const iframeSrcs = await page.locator('[data-object-id] iframe').evaluateAll((els) => els.map((e) => e.getAttribute('src') ?? ''));
    for (const s of iframeSrcs) expect(s).toMatch(/^https?:\/\//);
    await expect(obj(page, 'i4').locator('iframe')).not.toHaveAttribute('srcdoc', /.*/);
    const sandbox = await obj(page, 'i4').locator('iframe').getAttribute('sandbox');
    expect(sandbox).not.toContain('top-navigation');
    const hrefs = await page.locator('[data-object-id] a').evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    for (const h of hrefs) expect(h, 'только http(s) и служебные адреса файлов').toMatch(/^(https?:\/\/|\/api\/media\/)/);
    expect(await page.locator('[data-object-id] img[onerror]').count()).toBe(0);
    expect(await obj(page, 'c1').locator('img').count() === 0 || !(await obj(page, 'c1').locator('img').getAttribute('src'))?.startsWith('javascript:')).toBe(true);
    await obj(page, 'c1').click({ position: { x: 40, y: 100 } });
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('EMB-01 CVS-14 CVS-16 CVS-07 the frame does not hijack dragging; Interact is local; delete and undo work', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const guest = await openGuest(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }), owner.token, 'QA Guest');
  const page = owner.page;
  try {
    const id = await addEmbed(page, `<iframe src="${siteB()}/page" width="400" height="300"></iframe>`);
    await page.keyboard.press('Escape');
    const a = await boxOf(obj(page, id));
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 60, a.y + a.height / 2 + 40, { steps: 6 });
    await page.mouse.up();
    const b = await boxOf(obj(page, id));
    expect(Math.round(b.x - a.x)).toBe(60);
    const interact = obj(page, id).getByRole('button', { name: 'Interact', exact: true });
    await interact.click();
    await expect(obj(page, id).getByRole('button', { name: 'Stop interacting', exact: true })).toBeVisible();
    await expect(obj(guest.page, id).getByRole('button', { name: 'Interact', exact: true }), 'у второго клиента своё состояние').toBeVisible();
    const c = await boxOf(canvas(page));
    await page.mouse.click(c.x + 6, c.y + c.height - 6);
    await expect(obj(page, id).getByRole('button', { name: 'Interact', exact: true })).toBeVisible();
    await select(page, id);
    await page.keyboard.press('Delete');
    await expect(obj(guest.page, id)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(obj(guest.page, id)).toHaveCount(1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- EMB-02 ----------

test('EMB-02 card shows title and image of the page for both clients, the address opens with no opener; it survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const guest = await openGuest(browser, opts(f), owner.token, 'QA Guest');
  try {
    const id = await addCard(guest.page, `${INTERNAL_SITE}/page`);
    for (const page of [owner.page, guest.page]) {
      await expect(obj(page, id)).toContainText('QA page title');
      const img = obj(page, id).locator('img');
      await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
      expect(await img.getAttribute('src')).toMatch(/^\/api\/media\//);
      const link = obj(page, id).getByRole('link').first();
      await expect(link).toHaveAttribute('href', `${INTERNAL_SITE}/page`);
      await expect(link).toHaveAttribute('target', '_blank');
      expect((await link.getAttribute('rel')) ?? '').toContain('noopener');
    }
    await owner.page.reload();
    await expect(obj(owner.page, id)).toContainText('QA page title');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('EMB-02 CVS-19 locked card does not move but opens the address', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const page = owner.page;
  try {
    const target = `${siteB()}/page`;
    const id = await addCard(page, target);
    await expect(obj(page, id).getByRole('link')).toHaveAttribute('href', target);
    const lock = selectionBar(page).getByRole('button', { name: 'Lock', exact: true });
    await lock.scrollIntoViewIfNeeded();
    await lock.click();
    await expect(obj(page, id)).toHaveAttribute('data-locked', 'true');
    const before = await boxOf(obj(page, id));
    if (!isMobile) {
      await page.keyboard.press('Escape');
      await page.mouse.move(before.x + 10, before.y + 10);
      await page.mouse.down();
      await page.mouse.move(before.x + 70, before.y + 70, { steps: 5 });
      await page.mouse.up();
      expect((await boxOf(obj(page, id))).x).toBe(before.x);
    }
    const popup = page.waitForEvent('popup');
    const link = obj(page, id).getByRole('link');
    if (isMobile) await link.tap();
    else await link.click();
    const opened = await popup;
    await expect.poll(() => opened.url()).toBe(target);
    expect(await opened.evaluate(() => window.opener)).toBeNull();
    await opened.close();
    await expect(obj(page, id)).toHaveCount(1);
  } finally {
    await owner.close();
  }
});

test('EMB-02 page that gives nothing: a card with the address, no failure; bad address refused', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    for (const address of [`${INTERNAL_SITE}/notitle`, `${INTERNAL_SITE}/status?n=500`, 'http://127.0.0.1:8000/docs', 'http://no-such.invalid/']) {
      const id = await addCard(page, address);
      await expect(obj(page, id).getByRole('link')).toHaveAttribute('href', address);
      expect(await obj(page, id).locator('img').count()).toBe(0);
      await expect(obj(page, id)).not.toContainText('FastAPI');
      await page.keyboard.press('Delete');
      await expect(obj(page, id)).toHaveCount(0);
    }
    for (const bad of ['javascript:window.__pwned=1', 'data:text/html,x', 'file:///etc/passwd', 'ftp://x/']) {
      await allTool(page, 'Link card');
      const dialog = page.getByRole('dialog', { name: 'Link card' });
      if (!(await dialog.isVisible())) {
        const c = await boxOf(canvas(page));
        await page.mouse.click(c.x + c.width / 2, c.y + c.height / 3);
      }
      await dialog.getByLabel('Page address').fill(bad);
      await dialog.getByRole('button', { name: 'Add card' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
    }
    expect(await ofKind(page, 'linkcard').count()).toBe(0);
  } finally {
    await owner.close();
  }
});

test('EMB-02 SEC markup in the page title is shown as text and does not run', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const id = await addCard(owner.page, `${INTERNAL_SITE}/xss`);
    await expect(obj(owner.page, id)).toContainText('onerror');
    expect(await obj(owner.page, id).locator('img, script').count()).toBe(0);
    expect(await owner.page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  } finally {
    await owner.close();
  }
});

test('EMB-02 page with a broken image address still gives a card with its title', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const id = await addCard(owner.page, `${INTERNAL_SITE}/control-img`);
    await expect(obj(owner.page, id)).toContainText('control');
  } finally {
    await owner.close();
  }
});

// ---------- EMB-03 ----------

test('EMB-03 external link on an object: both clients, opens with no opener, removed for both; undo', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const guest = await openGuest(browser, opts(f), owner.token, 'QA Guest');
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { s: STICKY } as never);
    const target = `${siteB()}/page`;
    await attach(page, 's', target);
    for (const p of [page, guest.page]) {
      const badge = obj(p, 's').getByRole('link', { name: 'Open link' });
      await expect(badge).toHaveAttribute('href', target);
      await expect(badge).toHaveAttribute('target', '_blank');
      expect((await badge.getAttribute('rel')) ?? '').toContain('noopener');
    }
    const popup = guest.page.waitForEvent('popup');
    await obj(guest.page, 's').getByRole('link', { name: 'Open link' }).click();
    const opened = await popup;
    expect(await opened.evaluate(() => window.opener)).toBeNull();
    await opened.close();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(obj(page, 's').getByRole('link', { name: 'Open link' })).toBeVisible();
    await select(page, 's');
    await selectionBar(page).getByRole('button', { name: 'Link', exact: true }).click();
    await selectionBar(page).getByRole('button', { name: 'Remove link', exact: true }).click();
    await expect(obj(guest.page, 's').getByRole('link', { name: 'Open link' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(obj(guest.page, 's').getByRole('link', { name: 'Open link' })).toBeVisible();
  } finally {
    await guest.close();
    await owner.close();
  }
});

for (const bad of ['javascript:window.__pwned=1', 'JAVASCRIPT:x', 'data:text/html,x', 'vbscript:x', 'file:///etc/passwd']) {
  test(`EMB-03 SEC link address refused: ${bad}`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    test.skip(isMobile, 'мышь — профиль desktop');
    const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    try {
      await seed(owner.page, owner.boardId, { s: STICKY } as never);
      await attach(owner.page, 's', bad);
      await expect(selectionBar(owner.page).getByRole('alert')).toBeVisible();
      expect(await obj(owner.page, 's').locator('a.object-link, button.object-link').count()).toBe(0);
    } finally {
      await owner.close();
    }
  });
}

test('EMB-03 SHR-07 link to an object of this board moves the view without leaving the page, for owner and participant; deleted target reports', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const guest = await openGuest(browser, opts(f), owner.token, 'QA Guest');
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { s: STICKY, far: { ...STICKY, x: 6000, y: 4000, text: 'far' } } as never);
    await attach(page, 's', `${baseURL}/b/${owner.token}?object=far`);
    const go = (p: Page) => obj(p, 's').getByRole('button', { name: 'Go to linked object' });
    await expect(go(page)).toBeVisible();
    await expect(go(guest.page)).toBeVisible();
    for (const p of [page, guest.page]) {
      const url = p.url();
      await go(p).click();
      const c = await boxOf(canvas(p));
      await expect.poll(async () => {
        const b = await boxOf(obj(p, 'far'));
        return b.x + b.width > c.x && b.x < c.x + c.width && b.y + b.height > c.y && b.y < c.y + c.height;
      }, { message: 'вид перешёл к объекту' }).toBe(true);
      expect(p.url()).toBe(url);
      expect(p.context().pages().length).toBe(1);
    }
    // Объект удалён: сообщение, без падения и перехода.
    const before = guest.page.url();
    await select(page, 'far');
    await page.keyboard.press('Delete');
    await expect(obj(guest.page, 'far')).toHaveCount(0);
    // Возврат к объекту-источнику: значок виден, если объект в кадре.
    await guest.page.reload();
    await expect(canvas(guest.page)).toBeVisible();
    await expect(go(guest.page)).toBeAttached();
    await go(guest.page).evaluate((el) => (el as HTMLElement).click());
    await expect(guest.page.getByText('The linked object is not on this board.')).toBeVisible();
    expect(guest.page.url()).toBe(before);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('EMB-03 picker: Link to object chooses an object of this board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { s: STICKY, t: { ...STICKY, x: 400, text: 'target note' } } as never);
    await select(page, 's');
    await selectionBar(page).getByRole('button', { name: 'Link', exact: true }).click();
    await selectionBar(page).getByRole('button', { name: 'Link to object', exact: true }).click();
    await page.getByRole('dialog').getByText('target note').first().click();
    await expect(obj(page, 's').getByRole('button', { name: 'Go to linked object' })).toBeVisible();
  } finally {
    await owner.close();
  }
});

test('EMB-03 CVS-19 locked object still follows its link but the link cannot be changed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { s: { ...STICKY, locked: true, link: `${siteB()}/page` } } as never);
    await expect(obj(page, 's').getByRole('link', { name: 'Open link' })).toBeVisible();
    const b = await boxOf(obj(page, 's'));
    await page.mouse.click(b.x + b.width / 2, b.y + b.height - 12);
    await expect(selectionBar(page).getByRole('button', { name: 'Link', exact: true })).toHaveCount(0);
    const popup = page.waitForEvent('popup');
    await obj(page, 's').getByRole('link', { name: 'Open link' }).click();
    await (await popup).close();
  } finally {
    await owner.close();
  }
});

// ---------- телефон ----------

test('EMB-01 EMB-02 EMB-03 MOB-06 UI-04 phone: tools reachable, controls at least 44 px at 100 %', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(!isMobile, 'телефон — профиль mobile');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  const size44 = async (l: ReturnType<Page['locator']>, name: string) => {
    const b = await boxOf(l);
    expect(Math.min(b.width, b.height), `${name} ${Math.round(b.width)}×${Math.round(b.height)}`).toBeGreaterThanOrEqual(44);
  };
  try {
    await tool(page, 'All tools').tap();
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Embed', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: 'Embed' });
    if (!(await dialog.isVisible())) {
      const c = await boxOf(canvas(page));
      await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 3);
    }
    await dialog.getByLabel('Iframe code').fill(`<iframe src="${siteB()}/page" width="300" height="240"></iframe>`);
    await dialog.getByRole('button', { name: 'Add embed' }).tap();
    await expect(ofKind(page, 'iframe')).toHaveCount(1);
    const id = await firstOf(page, 'iframe');
    await size44(obj(page, id).getByRole('button', { name: 'Interact', exact: true }), 'Interact');
    await size44(obj(page, id).getByRole('link', { name: 'Open', exact: true }), 'Open');
    await obj(page, id).getByRole('button', { name: 'Interact', exact: true }).tap();
    await expect(obj(page, id).getByRole('button', { name: 'Stop interacting', exact: true })).toBeVisible();
    await seed(page, owner.boardId, { s: { ...STICKY, x: 20, y: 400, link: `${siteB()}/page` } } as never);
    await expect(obj(page, 's').getByRole('link', { name: 'Open link' })).toBeAttached();
    await size44(obj(page, 's').getByRole('link', { name: 'Open link' }), 'Open link');
  } finally {
    await owner.close();
  }
});

// ---------- EMB-04 на http:// ----------

async function framed(page: Page, site: string, baseURL: string, token: string): Promise<{ frame: () => Frame }> {
  await page.goto(`${site}/host?src=${encodeURIComponent(`${baseURL}/b/${token}/embed`)}`);
  await expect(page.locator('#f')).toBeVisible();
  return { frame: () => page.frames().find((fr) => fr.url().includes('/embed'))! };
}

async function joinInFrame(page: Page, name: string) {
  const f = page.frameLocator('#f');
  await f.getByRole('textbox').first().fill(name);
  await f.getByRole('button').first().click();
  return f;
}

test('EMB-04 Q-008 http: a page of the same host embeds the board; a name is asked; edits go both ways; files work', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    await framed(page, siteA(baseURL), baseURL!, owner.token);
    const fr = page.frameLocator('#f');
    await expect(fr.getByRole('heading')).toBeVisible();
    await expect(fr.getByTestId('board-canvas'), 'без имени холста нет').toHaveCount(0);
    await joinInFrame(page, 'In Frame');
    await expect(fr.getByTestId('board-canvas')).toBeVisible({ timeout: 20_000 });

    // Правка из фрейма видна второму клиенту и наоборот.
    await fr.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Sticky note', exact: true }).click();
    const c = await boxOf(fr.getByTestId('board-canvas'));
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
    await expect(ofKind(owner.page, 'sticky')).toHaveCount(1, { timeout: 15_000 });
    await seed(owner.page, owner.boardId, { fromOwner: { ...STICKY, x: 60, y: 60, text: 'from owner' } } as never);
    await expect(fr.locator('[data-object-id="fromOwner"]')).toBeAttached();

    // Файл из фрейма: загрузка и показ.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
    await fr.getByLabel('Upload image', { exact: true }).setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
    await expect(ofKind(owner.page, 'image')).toHaveCount(1, { timeout: 20_000 });
    const image = fr.locator('[data-type="image"] img').first();
    await expect.poll(() => image.evaluate((i) => (i as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);

    // Скачивание файла из фрейма.
    await fr.getByLabel('Upload file', { exact: true }).setInputFiles({ name: 'n.txt', mimeType: 'text/plain', buffer: Buffer.from('qa-text') });
    const started = page.waitForEvent('download', { timeout: 15_000 });
    await fr.getByRole('toolbar', { name: 'Selection' }).getByRole('link', { name: 'Download', exact: true }).click();
    expect(await (await started).failure(), 'файл скачан из фрейма').toBeNull();

    // Присутствие: второй клиент видит участника фрейма.
    await expect(owner.page.getByText('In Frame').first()).toBeVisible();

    // Прочие страницы и действия владельца недоступны изнутри.
    await expect(fr.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
    await expect(fr.getByRole('link', { name: /All boards/ })).toHaveCount(0);

    // Сброс ссылки закрывает встроенную доску.
    const reset = await owner.page.request.post(`/api/boards/${owner.boardId}/share/reset`);
    expect(reset.status()).toBe(200);
    await expect(fr.getByText('This link is not available.')).toBeVisible({ timeout: 15_000 });
    await expect(fr.getByTestId('board-canvas')).toHaveCount(0);
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 Q-008 http: a page of another host gets the explanation and a link to the board, not a broken canvas', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    await framed(page, siteB(), baseURL!, owner.token);
    await joinInFrame(page, 'Other Host');
    const fr = page.frameLocator('#f');
    await expect(fr.getByText('This browser does not keep your session in an embedded board.')).toBeVisible({ timeout: 15_000 });
    await expect(fr.getByTestId('board-canvas')).toHaveCount(0);
    const link = fr.getByRole('link', { name: 'Open the board in a new tab' });
    await expect(link).toHaveAttribute('target', '_blank');
    expect(new URL((await link.getAttribute('href'))!, baseURL).pathname).toBe(`/b/${owner.token}`);
    await expect(owner.page.getByText('Other Host')).toHaveCount(0);
    const popup = page.waitForEvent('popup');
    await link.click();
    const opened = await popup;
    await expect(opened.getByRole('textbox').first()).toBeVisible();
    await opened.close();
  } finally {
    await context.close();
    await owner.close();
  }
});

test('EMB-04 SHR-05 unknown and revoked token in the frame: one refusal', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const f = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const owner = await openOwner(browser, opts(f));
  const context = await browser.newContext(opts(f));
  const page = await context.newPage();
  try {
    const old = owner.token;
    await owner.page.request.post(`/api/boards/${owner.boardId}/share/reset`);
    const seen: string[] = [];
    for (const t of [old, 'q'.repeat(43)]) {
      await framed(page, siteA(baseURL), baseURL!, t);
      const fr = page.frameLocator('#f');
      await expect(fr.getByText('This link is not available.')).toBeVisible({ timeout: 15_000 });
      seen.push(await fr.locator('#root').innerText());
    }
    expect(seen[0]).toBe(seen[1]);
  } finally {
    await context.close();
    await owner.close();
  }
});

test('ARCH-FRAME closed pages are not shown in a frame by a real browser, for a signed-in owner too', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  test.skip(isMobile, 'мышь — профиль desktop');
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    for (const path of ['/', '/login', `/boards/${owner.boardId}`, '/templates', '/admin/users', `/b/${owner.token}`, `/t/${owner.token}`]) {
      await page.goto(`${siteA(baseURL)}/host?src=${encodeURIComponent(`${baseURL}${path}`)}`);
      await page.waitForTimeout(400);
      const child = page.frames().find((fr) => fr.parentFrame());
      expect(child, path).toBeTruthy();
      expect(child!.url(), `${path}: показана во фрейме`).not.toBe(`${baseURL}${path}`);
    }
    await page.goto(`${siteA(baseURL)}/host?src=${encodeURIComponent(`${baseURL}/b/${owner.token}/embed`)}`);
    await expect(page.frameLocator('#f').locator('#root')).not.toBeEmpty();
  } finally {
    await owner.close();
  }
});

