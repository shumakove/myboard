// Приёмка T5.5 · поиск по доске и ссылка на объект: CVS-08, SHR-07 (+ UI-01…04 новых элементов).
// Сценарии — docs/qa/reports/T5.5.md. Подписи интерфейса — из handoff T5.5.
// Наблюдение: DOM холста (положение объекта относительно холста), панель поиска, диалог ссылки,
// запросы страницы. Объекты и теги (поле `tags`, без «#») пишутся в документ клиентом Yjs по /api/ws.
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, openGuest, openOwner, profileOpts, type Opts } from './camera';
import { boxOf, centerOf, FRAME, obj, seed, selected, selectionBar, tool, tools, writeDoc, type Obj } from './scene';
import { hsl, hueDist, rgba, signature, transparent } from './ui';

type P = Parameters<typeof profileOpts>[0];
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(120_000));

const searchBtn = (page: Page) => tools(page).getByRole('button', { name: 'Search', exact: true });
const panel = (page: Page) => page.getByRole('search', { name: 'Search board' });
const field = (page: Page) => panel(page).getByLabel('Search text and tags');
const status = (page: Page) => panel(page).getByRole('status');
const results = (page: Page) => panel(page).getByRole('list', { name: 'Search results' }).getByRole('button');
const linkDialog = (page: Page) => page.getByRole('dialog', { name: 'Link to object' });
const NOT_AVAILABLE = 'This link is not available.';

/** Опорный объект у начала координат (виден при начальном виде) и объекты далеко от него. */
const HOME: Obj = { type: 'shape', x: 40, y: 40, width: 120, height: 80 };
const FAR_TEXT: Obj = { type: 'sticky', x: 20_000, y: 14_000, width: 200, height: 200, text: 'Release Plan Q4' };
const FAR_TAG: Obj = { type: 'sticky', x: -18_000, y: 9_000, width: 200, height: 200, text: 'Login fails', tags: ['urgent', 'backend'] };
const FAR_SHAPE: Obj = { type: 'shape', x: 9_000, y: -12_000, width: 300, height: 160, text: 'Budget review', tags: ['finance'] };

async function press(page: Page, l: Locator, isMobile: boolean) {
  if (isMobile) await l.tap();
  else await l.click();
}

/** Объект целиком в видимой части холста (и в окне). */
async function expectInView(page: Page, id: string) {
  await expect(async () => {
    const c = await boxOf(canvas(page));
    const vw = page.viewportSize()!;
    const left = Math.max(c.x, 0);
    const top = Math.max(c.y, 0);
    const right = Math.min(c.x + c.width, vw.width);
    const bottom = Math.min(c.y + c.height, vw.height);
    const o = await boxOf(obj(page, id));
    const m = centerOf(o);
    expect(m.x, `центр объекта ${id} по x внутри холста`).toBeGreaterThan(left);
    expect(m.x).toBeLessThan(right);
    expect(m.y, `центр объекта ${id} по y внутри холста`).toBeGreaterThan(top);
    expect(m.y).toBeLessThan(bottom);
  }).toPass({ timeout: 10_000 });
}

/** Объект вне видимой части холста (нет на экране). */
async function expectOutOfView(page: Page, id: string) {
  const c = await boxOf(canvas(page));
  const b = await obj(page, id).boundingBox();
  if (!b) return;
  const visible = b.x + b.width > c.x && b.x < c.x + c.width && b.y + b.height > c.y && b.y < c.y + c.height;
  expect(visible, `объект ${id} не на экране`).toBe(false);
}

async function openSearch(page: Page, isMobile: boolean) {
  if (!(await panel(page).isVisible())) await press(page, searchBtn(page), isMobile);
  await expect(panel(page)).toBeVisible();
  await expect(field(page)).toBeVisible();
}

async function search(page: Page, q: string, isMobile: boolean) {
  await openSearch(page, isMobile);
  await field(page).fill(q);
}

const guestOf = (browser: Browser, o: Opts, token: string) => openGuest(browser, o, token, 'QA Guest');

/** Пройти страницу входа по ссылке, если она спрашивает имя. */
async function joinIfAsked(page: Page, name: string, isMobile: boolean) {
  const nameField = page.getByLabel('Your name');
  await expect(nameField.or(canvas(page))).toBeVisible();
  if (await nameField.isVisible()) {
    await nameField.fill(name);
    await press(page, page.getByRole('button', { name: 'Join board', exact: true }), isMobile);
  }
  await expect(canvas(page)).toBeVisible();
}

/** Выделить объект щелчком/касанием. */
async function selectObj(page: Page, id: string, isMobile: boolean) {
  const b = await boxOf(obj(page, id));
  if (isMobile) {
    await page.touchscreen.tap(b.x + 8, b.y + 8);
  } else await page.mouse.click(b.x + 8, b.y + 8);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

/** Ссылка на объект из диалога «Copy link to object» (меню объекта: правый щелчок или More). */
async function objectLinkFromUi(page: Page, id: string, isMobile: boolean, via: 'context' | 'more' = isMobile ? 'more' : 'context') {
  await selectObj(page, id, isMobile);
  if (via === 'context') await obj(page, id).click({ button: 'right', position: { x: 8, y: 8 } });
  else await press(page, selectionBar(page).getByRole('button', { name: 'More', exact: true }), isMobile);
  await press(page, page.getByRole('menuitem', { name: 'Copy link to object' }), isMobile);
  await expect(linkDialog(page)).toBeVisible();
  const f = linkDialog(page).getByLabel('Object link');
  await expect(f).not.toHaveValue('');
  return f.inputValue();
}

// ---------- CVS-08 ----------

test('CVS-08 owner finds a far object by text substring ignoring case and the view moves to it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT, 'qa-other': FAR_SHAPE });
    await expectOutOfView(page, 'qa-far');
    await search(page, 'release PLAN', isMobile);
    await expect(status(page)).toContainText('1 result');
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText('Release Plan Q4');
    await press(page, results(page).first(), isMobile);
    await expectInView(page, 'qa-far');
    await expect(obj(page, 'qa-far')).toHaveAttribute('aria-selected', 'true');
    // подстрока из середины текста
    await search(page, 'view', isMobile);
    await expect(results(page)).toHaveCount(1);
    await press(page, results(page).first(), isMobile);
    await expectInView(page, 'qa-other');
    await expectOutOfView(page, 'qa-far');
  } finally {
    await owner.close();
  }
});

test('CVS-08 object is found by tag (with and without #) and the view moves to it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME, 'qa-tag': FAR_TAG, 'qa-other': FAR_SHAPE });
    // тег не входит в текст объекта: находится только по полю tags
    for (const q of ['urgent', '#urgent', 'URG', '#backend']) {
      await search(page, q, isMobile);
      await expect(results(page), `запрос «${q}»`).toHaveCount(1);
      await press(page, results(page).first(), isMobile);
      await expect(obj(page, 'qa-tag'), `запрос «${q}» ведёт к объекту с тегом`).toHaveAttribute('aria-selected', 'true');
      await expectInView(page, 'qa-tag');
    }
    await search(page, '#finance', isMobile);
    await expect(results(page)).toHaveCount(1);
    await press(page, results(page).first(), isMobile);
    await expectInView(page, 'qa-other');
  } finally {
    await owner.close();
  }
});

test('CVS-08 tags stored as Y.Array inside a Y.Map object are found too', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME });
    // формат тегов из handoff: Y.Array<string> в поле tags объекта
    await writeDoc(page, owner.boardId, (doc) => {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ type: 'sticky', x: 6000 + FRAME.x, y: 6000 + FRAME.y, width: 200, height: 200, text: 'Yjs tagged' })) m.set(k, v);
      m.set('tags', Y.Array.from(['ymapTag']));
      doc.getMap('objects').set('qa-ymap', m);
    });
    await expect(obj(page, 'qa-ymap')).toBeAttached();
    await search(page, '#ymaptag', isMobile);
    await expect(results(page)).toHaveCount(1);
    await press(page, results(page).first(), isMobile);
    await expectInView(page, 'qa-ymap');
  } finally {
    await owner.close();
  }
});

test('CVS-08 several matches are all listed and each leads to its object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const items: Record<string, Obj> = {
      'qa-home': HOME,
      'qa-m1': { type: 'sticky', x: 12_000, y: 0, width: 200, height: 200, text: 'Alpha task one' },
      'qa-m2': { type: 'sticky', x: -12_000, y: 0, width: 200, height: 200, text: 'second ALPHA' },
      'qa-m3': { type: 'shape', x: 0, y: 12_000, width: 200, height: 100, text: 'other', tags: ['alphabet'] },
      'qa-no': { type: 'sticky', x: 0, y: -12_000, width: 200, height: 200, text: 'Beta' },
    };
    await seed(page, owner.boardId, items);
    await search(page, 'alpha', isMobile);
    await expect(status(page)).toContainText('3 result');
    await expect(results(page)).toHaveCount(3);
    const visited = new Set<string>();
    for (let i = 0; i < 3; i++) {
      await press(page, results(page).nth(i), isMobile);
      const sel = await selected(page).getAttribute('data-object-id');
      expect(sel).not.toBeNull();
      await expectInView(page, sel!);
      visited.add(sel!);
    }
    expect([...visited].sort()).toEqual(['qa-m1', 'qa-m2', 'qa-m3']);
  } finally {
    await owner.close();
  }
});

test('CVS-08 link participant searches and jumps the same way', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    await seed(owner.page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT, 'qa-tag': FAR_TAG });
    await expect(obj(guest.page, 'qa-tag')).toBeAttached();
    await search(guest.page, 'q4', isMobile);
    await expect(results(guest.page)).toHaveCount(1);
    await press(guest.page, results(guest.page).first(), isMobile);
    await expectInView(guest.page, 'qa-far');
    await search(guest.page, '#urgent', isMobile);
    await expect(results(guest.page)).toHaveCount(1);
    await press(guest.page, results(guest.page).first(), isMobile);
    await expectInView(guest.page, 'qa-tag');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-08 object typed in through the UI is found', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME });
    await tool(page, 'Sticky note').click();
    const c = await boxOf(canvas(page));
    await page.mouse.click(c.x + c.width * 0.6, c.y + c.height * 0.4);
    const editor = page.getByLabel('Object text');
    await expect(editor).toBeVisible();
    await editor.fill('Typed by hand Zebra');
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await search(page, 'zebra', isMobile);
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText('Zebra');
  } finally {
    await owner.close();
  }
});

test('CVS-08 results follow edits of another client without reload (add, then delete)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    await seed(owner.page, owner.boardId, { 'qa-home': HOME });
    await expect(obj(guest.page, 'qa-home')).toBeAttached();
    await search(guest.page, 'live item', isMobile);
    await expect(status(guest.page)).toContainText(/nothing found/i);
    // второй клиент (владелец) добавляет объект
    await seed(owner.page, owner.boardId, { 'qa-live': { type: 'sticky', x: 200, y: 40, width: 120, height: 120, text: 'Live item' } });
    await expect(results(guest.page)).toHaveCount(1);
    await expect(status(guest.page)).toContainText('1 result');
    // и удаляет его
    await selectObj(owner.page, 'qa-live', false);
    await owner.page.keyboard.press('Delete');
    await expect(obj(owner.page, 'qa-live')).toHaveCount(0);
    await expect(results(guest.page)).toHaveCount(0);
    await expect(status(guest.page)).toContainText(/nothing found/i);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-08 no match shows Nothing found and leaves the view; trashed objects are not found', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT });
    await writeDoc(page, owner.boardId, (doc) => {
      doc.getMap('trash').set('qa-gone', { object: { type: 'sticky', x: 0, y: 0, width: 100, height: 100, text: 'Trashed secret' }, deletedAt: Date.now(), deletedBy: 'QA' });
    });
    const before = await boxOf(obj(page, 'qa-home'));
    for (const q of ['no such thing xyz', 'trashed secret', '#nope']) {
      await search(page, q, isMobile);
      await expect(status(page), `запрос «${q}»`).toContainText(/nothing found/i);
      await expect(results(page)).toHaveCount(0);
      if (!isMobile) await field(page).press('Enter');
    }
    const after = await boxOf(obj(page, 'qa-home'));
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), 'вид не двигался').toBeLessThan(2);
  } finally {
    await owner.close();
  }
});

test('CVS-08 empty query, regexp characters and Cyrillic', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seed(page, owner.boardId, {
      'qa-home': HOME,
      'qa-re': { type: 'sticky', x: 5000, y: 5000, width: 200, height: 200, text: 'price (a.*b) [x]' },
      'qa-ru': { type: 'sticky', x: -5000, y: 5000, width: 200, height: 200, text: 'План Релиза' },
      'qa-dot': { type: 'sticky', x: -5000, y: -5000, width: 200, height: 200, text: 'abcb' },
    });
    await search(page, '', isMobile);
    await expect(results(page)).toHaveCount(0);
    await search(page, '(a.*b)', isMobile);
    await expect(results(page)).toHaveCount(1);
    await expect(results(page).first()).toContainText('price');
    await search(page, '[x', isMobile);
    await expect(results(page)).toHaveCount(1);
    await search(page, 'a.*b', isMobile); // как регулярное выражение совпало бы и с «abcb»
    await expect(results(page)).toHaveCount(1);
    await search(page, 'план релиза', isMobile);
    await expect(results(page)).toHaveCount(1);
    await press(page, results(page).first(), isMobile);
    await expectInView(page, 'qa-ru');
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('CVS-08 search runs on the client: typing sends no request with the query', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT });
    const urls: string[] = [];
    page.on('request', (r) => urls.push(r.url() + ' ' + (r.postData() ?? '')));
    const sent: string[] = [];
    page.on('websocket', (ws) => ws.on('framesent', ({ payload }) => sent.push(typeof payload === 'string' ? payload : payload.toString('latin1'))));
    await search(page, 'uniqueqatoken', isMobile);
    await expect(status(page)).toContainText(/nothing found/i);
    await search(page, 'release', isMobile);
    await expect(results(page)).toHaveCount(1);
    expect(urls.filter((u) => /uniqueqatoken|release/i.test(u))).toEqual([]);
    expect(sent.filter((s) => s.includes('uniqueqatoken'))).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('CVS-08 CVS-25 typing in the search field neither switches tools nor deletes the selection; Escape closes', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME });
    await selectObj(page, 'qa-home', false);
    const active = async () => tools(page).locator('[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent));
    await openSearch(page, false);
    const before = await active();
    await field(page).click();
    await page.keyboard.type('stlvnx');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Delete');
    await expect(field(page)).toHaveValue('stlvn');
    expect(await active()).toEqual(before);
    await expect(obj(page, 'qa-home')).toBeAttached();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
    await expect(obj(page, 'qa-home')).toBeAttached();
  } finally {
    await owner.close();
  }
});

// ---------- SHR-07 ----------

test('SHR-07 owner copies a link to the object: PUBLIC_BASE_URL/b/{token}?object={id}', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await page.addInitScript(() => {
      const w = window as unknown as { __copied: string[] };
      w.__copied = [];
      document.addEventListener('copy', () => {
        const el = document.activeElement as HTMLInputElement | null;
        let text = window.getSelection()?.toString() ?? '';
        if (!text && el && typeof el.selectionStart === 'number' && el.selectionEnd !== null) text = el.value.substring(el.selectionStart, el.selectionEnd);
        w.__copied.push(text);
      });
      const clip = navigator.clipboard as Clipboard | undefined;
      if (clip?.writeText) {
        const orig = clip.writeText.bind(clip);
        clip.writeText = (t: string) => {
          w.__copied.push(t);
          return orig(t);
        };
      }
    });
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await seed(page, owner.boardId, { 'qa-home': HOME });
    const url = await objectLinkFromUi(page, 'qa-home', isMobile);
    expect(url).toBe(`${baseURL}/b/${owner.token}?object=qa-home`);
    expect(url).not.toMatch(/localhost|127\.0\.0\.1/);
    await press(page, linkDialog(page).getByRole('button', { name: 'Copy link', exact: true }), isMobile);
    await expect(page.getByText('Link copied.')).toBeVisible();
    const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
    expect(copied).toContain(url);
    // второй путь — через More панели Selection (desktop) / контекстное меню недоступно на телефоне
    if (!isMobile) {
      await page.keyboard.press('Escape');
      await expect(linkDialog(page)).toBeHidden();
      expect(await objectLinkFromUi(page, 'qa-home', false, 'more')).toBe(url);
    }
  } finally {
    await owner.close();
  }
});

test('SHR-07 participant copies the link to an object too', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    await seed(owner.page, owner.boardId, { 'qa-home': HOME });
    await expect(obj(guest.page, 'qa-home')).toBeAttached();
    const url = await objectLinkFromUi(guest.page, 'qa-home', isMobile);
    expect(url).toBe(`${baseURL}/b/${owner.token}?object=qa-home`);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('SHR-07 a new person opens the object link, enters a name and lands on the object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const ctx = await browser.newContext(o);
  try {
    await seed(owner.page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT, 'qa-tag': FAR_TAG });
    const url = await objectLinkFromUi(owner.page, 'qa-home', isMobile);
    const farUrl = url.replace('object=qa-home', 'object=qa-far');
    const page = await ctx.newPage();
    await page.goto(farUrl);
    await expect(page.getByLabel('Your name')).toBeVisible();
    await joinIfAsked(page, 'Link visitor', isMobile);
    await expectInView(page, 'qa-far');
    await expectOutOfView(page, 'qa-home');
    // тот же человек (сессия уже есть) открывает ссылку на другой объект — имя не спрашивается
    await page.goto(url.replace('object=qa-home', 'object=qa-tag'));
    await expect(canvas(page)).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
    await expectInView(page, 'qa-tag');
    // сохранённое место камеры (CVS-05) не мешает переходу
    await page.goto(farUrl);
    await expectInView(page, 'qa-far');
  } finally {
    await ctx.close();
    await owner.close();
  }
});

test('SHR-07 participant who already has a session follows the link to the object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    await seed(owner.page, owner.boardId, { 'qa-home': HOME, 'qa-shape': FAR_SHAPE });
    await expect(obj(guest.page, 'qa-shape')).toBeAttached();
    await expectOutOfView(guest.page, 'qa-shape');
    await guest.page.goto(`/b/${owner.token}?object=qa-shape`);
    await expect(canvas(guest.page)).toBeVisible();
    await expectInView(guest.page, 'qa-shape');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('SHR-07 board owner opening the object link lands on the object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT });
    const url = (await objectLinkFromUi(page, 'qa-home', isMobile)).replace('object=qa-home', 'object=qa-far');
    await page.goto(url);
    await joinIfAsked(page, 'Owner', isMobile);
    await expectInView(page, 'qa-far');
  } finally {
    await owner.close();
  }
});

test('SHR-07 SHR-05 SHR-06 revoked or unknown token with ?object= gets the same refusal as any dead link', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  const stranger = await browser.newContext(o);
  try {
    await seed(owner.page, owner.boardId, { 'qa-home': HOME });
    const oldUrl = await objectLinkFromUi(owner.page, 'qa-home', isMobile);
    const reset = await owner.page.request.post(`/api/boards/${owner.boardId}/share/reset`);
    expect(reset.status()).toBe(200);
    const page = await stranger.newPage();
    const ws: string[] = [];
    page.on('websocket', (w) => ws.push(w.url()));
    const texts: string[] = [];
    for (const path of [oldUrl, `/b/${owner.token}`, `/b/${'Q'.repeat(43)}?object=qa-home`, `/b/${'Q'.repeat(43)}`]) {
      await page.goto(path);
      await expect(page.getByText(NOT_AVAILABLE)).toBeVisible();
      await expect(page.getByLabel('Your name')).toHaveCount(0);
      await expect(canvas(page)).toHaveCount(0);
      await expect(page.locator('[data-object-id]')).toHaveCount(0);
      texts.push((await page.locator('body').innerText()).trim());
    }
    expect(new Set(texts).size, 'отказ одинаков').toBe(1);
    expect(ws.filter((u) => u.includes('/api/ws')), 'канал документа не открывается').toEqual([]);
    // участник со старой сессией тоже получает отказ по ссылке на объект
    await guest.page.goto(oldUrl);
    await expect(guest.page.getByText(NOT_AVAILABLE)).toBeVisible();
    await expect(guest.page.locator('[data-object-id]')).toHaveCount(0);
    // новая копия ссылки на объект — с новым токеном
    await owner.page.keyboard.press('Escape').catch(() => undefined);
    await owner.page.reload();
    await expect(obj(owner.page, 'qa-home')).toBeAttached();
    const newUrl = await objectLinkFromUi(owner.page, 'qa-home', isMobile);
    const fresh = ((await (await owner.page.request.get(`/api/boards/${owner.boardId}/share`)).json()) as { token: string }).token;
    expect(newUrl).toBe(`${baseURL}/b/${fresh}?object=qa-home`);
    expect(newUrl).not.toBe(oldUrl);
  } finally {
    await stranger.close();
    await guest.close();
    await owner.close();
  }
});

test('SHR-07 missing, trashed, empty or hostile object id: board opens with a message, nothing breaks', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = guest.page;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await seed(owner.page, owner.boardId, { 'qa-home': HOME });
    await writeDoc(owner.page, owner.boardId, (doc) => {
      doc.getMap('trash').set('qa-gone', { object: { type: 'sticky', x: 9000, y: 9000, width: 100, height: 100, text: 'gone' }, deletedAt: Date.now(), deletedBy: 'QA' });
    });
    const message = page.getByRole('status').filter({ hasText: /not on this board|not found/i });
    for (const id of ['nope', 'qa-gone', encodeURIComponent('<img src=x onerror="window.__xss=1">'), encodeURIComponent('a"b%00')]) {
      await page.goto(`/b/${owner.token}?object=${id}`);
      await expect(canvas(page)).toBeVisible();
      await expect(obj(page, 'qa-home')).toBeAttached();
      await expect(message, `сообщение для ?object=${id}`).toBeVisible();
      await expectInView(page, 'qa-home'); // вид не прыгнул «в никуда»
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    }
    // сообщение закрывается
    await press(page, page.getByRole('button', { name: 'Dismiss' }), isMobile);
    await expect(message).toBeHidden();
    // пустой ?object= — обычное открытие без сообщения
    await page.goto(`/b/${owner.token}?object=`);
    await expect(obj(page, 'qa-home')).toBeAttached();
    await page.waitForTimeout(1500);
    await expect(message).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('SHR-07 ARCH /b/{token}?object={id} forbids framing like other pages', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const res = await owner.page.request.get(`/b/${owner.token}?object=qa-home`);
    expect(res.status()).toBe(200);
    const h = res.headers();
    const xfo = (h['x-frame-options'] ?? '').toUpperCase();
    const csp = h['content-security-policy'] ?? '';
    expect(xfo === 'DENY' || xfo === 'SAMEORIGIN' || /frame-ancestors\s+'none'/.test(csp), JSON.stringify(h)).toBe(true);
  } finally {
    await owner.close();
  }
});

// ---------- UI-01…04 для новых элементов ----------

/** Цвета текста и рамок внутри элемента: чистый серый R = G = B либо насыщенный тон акцента. */
async function expectNeutralOrAccent(page: Page, root: Locator, accent: string, what: string) {
  const styles = await root.evaluate((r) =>
    [r, ...Array.from(r.querySelectorAll('*'))].flatMap((e) => {
      const rect = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (rect.width < 1 || rect.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') return [];
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return [];
      const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0) || e.tagName === 'INPUT';
      const bw = Math.max(...['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs.getPropertyValue(`border-${s.toLowerCase()}-width`))));
      const out: { label: string; c: string }[] = [];
      const label = (e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()).slice(0, 30);
      if (own) out.push({ label: `текст ${label}`, c: cs.color });
      if (bw > 0) out.push({ label: `рамка ${label}`, c: cs.borderTopColor });
      return out;
    }),
  );
  const ah = hsl(accent).h;
  for (const s of styles) {
    const v = rgba(s.c);
    const ok = !v || transparent(s.c) || (v[0] === v[1] && v[1] === v[2]) || (hsl(s.c).s > 0.25 && hueDist(hsl(s.c).h, ah) <= 12);
    expect.soft(ok, `${what}: ${s.label} ${s.c} — чистый серый или акцент`).toBe(true);
  }
}

/** Плавающая панель: белая подложка со скруглением и тенью. */
async function expectFloatingPanel(root: Locator, what: string) {
  const st = await root.evaluate((e) => {
    let n: Element | null = e;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow };
      n = n.parentElement;
    }
    return null;
  });
  expect(st, `${what}: подложка`).not.toBeNull();
  expect.soft(st!.bg, `${what}: белая подложка`).toBe('rgb(255, 255, 255)');
  expect.soft(st!.radius, `${what}: скругление`).toBeGreaterThan(0);
  expect.soft(st!.shadow, `${what}: тень`).not.toBe('none');
}

test('UI-01 UI-03 search panel, object link dialog and the not-found message follow the common style', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  try {
    const page = owner.page;
    const accent = (await signature(page, page.getByRole('button', { name: 'Share', exact: true })))['background-color'];
    await seed(page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT, 'qa-tag': FAR_TAG });
    await search(page, 'o', isMobile);
    await expect(results(page).first()).toBeVisible();
    await expectFloatingPanel(panel(page), 'панель поиска');
    await expectNeutralOrAccent(page, panel(page), accent, 'панель поиска');
    // состояние фокуса с клавиатуры у поля и у результата
    if (!isMobile) {
      const outline = async (l: Locator) => l.evaluate((e) => { const cs = getComputedStyle(e); return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`; });
      await field(page).focus();
      await page.keyboard.press('Tab');
      const focused = page.locator(':focus');
      const fo = await outline(focused);
      expect.soft(/none\|0px\|none/.test(fo), `видимый фокус с клавиатуры: ${fo}`).toBe(false);
      await field(page).focus();
      await page.keyboard.press('Escape');
      await expect(panel(page)).toBeHidden();
    } else {
      await press(page, panel(page).getByRole('button', { name: 'Close', exact: true }), isMobile);
      await expect(panel(page)).toBeHidden();
    }
    await objectLinkFromUi(page, 'qa-home', isMobile);
    await expectNeutralOrAccent(page, linkDialog(page), accent, 'диалог Link to object');
    await expectFloatingPanel(linkDialog(page), 'диалог Link to object');
    const copyBg = (await signature(page, linkDialog(page).getByRole('button', { name: 'Copy link', exact: true })))['background-color'];
    expect.soft(copyBg, 'основная кнопка диалога — акцент').toBe(accent);
    if (!isMobile) {
      await page.keyboard.press('Escape');
      await expect(linkDialog(page)).toBeHidden();
    } else {
      await press(page, linkDialog(page).getByRole('button', { name: 'Close', exact: true }), isMobile);
      await expect(linkDialog(page)).toBeHidden();
    }
    await page.goto(`/b/${owner.token}?object=nope`);
    await joinIfAsked(page, 'Owner', isMobile);
    const msg = page.getByRole('status').filter({ hasText: /not on this board|not found/i });
    await expect(msg).toBeVisible();
    await expectNeutralOrAccent(page, msg, accent, 'сообщение «объект не найден»');
  } finally {
    await owner.close();
  }
});

test('UI-04 on a phone search and object link are reachable, targets are at least 44x44, no horizontal scroll', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = guest.page;
    await seed(owner.page, owner.boardId, { 'qa-home': HOME, 'qa-far': FAR_TEXT, 'qa-tag': FAR_TAG });
    await expect(obj(page, 'qa-tag')).toBeAttached();
    await search(page, 'o', true);
    await expect(results(page).first()).toBeVisible();
    const targets = [searchBtn(page), field(page), ...(await results(page).all()), panel(page).getByRole('button', { name: 'Close', exact: true })];
    for (const t of targets) {
      const b = await boxOf(t);
      expect.soft(Math.round(b.width) >= 44 && Math.round(b.height) >= 44, `цель ${await t.getAttribute('aria-label') ?? await t.textContent()}: ${b.width}×${b.height}`).toBe(true);
    }
    const pb = await boxOf(panel(page));
    expect.soft(pb.x).toBeGreaterThanOrEqual(0);
    expect.soft(pb.x + pb.width).toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await press(page, panel(page).getByRole('button', { name: 'Close', exact: true }), true);
    await objectLinkFromUi(page, 'qa-home', true);
    for (const name of ['Copy link', 'Close']) {
      const b = await boxOf(linkDialog(page).getByRole('button', { name, exact: true }));
      expect.soft(Math.round(b.width) >= 44 && Math.round(b.height) >= 44, `${name}: ${b.width}×${b.height}`).toBe(true);
    }
    const mi = await boxOf(linkDialog(page));
    expect.soft(mi.x + mi.width).toBeLessThanOrEqual(viewport!.width + 0.5);
  } finally {
    await guest.close();
    await owner.close();
  }
});
