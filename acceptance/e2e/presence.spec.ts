// Приёмка T4.2 · присутствие и курсоры в браузере (COL-02, COL-03, COL-04, COL-09).
// Сценарии — docs/qa/reports/T4.2.md; подписи интерфейса — из handoff T4.2:
// холст `board-canvas`, курсор `<имя>'s cursor`, панель «People on this board»,
// `Hide cursors`/`Show cursors`, `Follow <имя>`, `Following <имя>`, `Stop following`.
// Камера проверяется по положению чужого курсора: при одинаковом виде курсор ведущего
// у наблюдателя стоит там же, где мышь ведущего на его экране (с постоянным сдвигом).
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { apiUserLogin, createBoardUser } from './user';

type Point = { x: number; y: number };
type Opts = BrowserContextOptions;

const canvas = (page: Page) => page.getByTestId('board-canvas');
const people = (page: Page) => page.getByRole('region', { name: 'People on this board' }).or(
  page.getByLabel('People on this board'),
);
const cursorOf = (page: Page, name: string) => page.getByLabel(`${name}'s cursor`, { exact: true });

async function profileOpts(
  { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }: {
    baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string;
    deviceScaleFactor?: number;
  },
): Promise<Opts> {
  return { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
}

interface Owner { page: Page; name: string; boardId: string; token: string; close: () => Promise<void> }

async function openOwner(browser: Browser, opts: Opts): Promise<Owner> {
  const user = await createBoardUser(browser, opts.baseURL);
  const context = await browser.newContext(opts);
  await apiUserLogin(context.request, user);
  const res = await context.request.post('/api/boards', { data: { title: `QA presence ${Date.now()}` } });
  expect(res.status()).toBe(201);
  const boardId = ((await res.json()) as { id: string }).id;
  const share = await context.request.get(`/api/boards/${boardId}/share`);
  const token = ((await share.json()) as { token: string }).token;
  const page = await context.newPage();
  await page.goto(`/boards/${boardId}`);
  await expect(canvas(page)).toBeVisible();
  return { page, name: user.name, boardId, token, close: () => context.close() };
}

async function openGuest(browser: Browser, opts: Opts, token: string, name: string) {
  const context = await browser.newContext(opts);
  const joined = await context.request.post(`/api/share/${token}/join`, { data: { name } });
  expect(joined.status()).toBe(200);
  const page = await context.newPage();
  await page.goto(`/b/${token}`);
  await expect(canvas(page)).toBeVisible();
  return { page, close: () => context.close() };
}

/** Точка холста по долям его размера (в координатах окна). */
async function at(page: Page, fx: number, fy: number): Promise<Point> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('холст не виден');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

async function hover(page: Page, p: Point) {
  await page.mouse.move(p.x - 3, p.y - 3);
  await page.mouse.move(p.x, p.y, { steps: 3 });
}

async function posOf(page: Page, name: string): Promise<Point> {
  const loc = cursorOf(page, name);
  await expect(loc).toBeVisible();
  const box = await loc.boundingBox();
  const area = await canvas(page).boundingBox();
  if (!box || !area) throw new Error('курсор не виден');
  // относительно холста: прокрутка страницы (телефон) не должна влиять на измерение камеры
  return { x: box.x - area.x, y: box.y - area.y };
}

/** Положение курсора `name` у наблюдателя после того, как ведущий навёл мышь в `p` (ждём, пока оно устоится). */
async function cursorAfterHover(leader: Page, p: Point, watcher: Page, name: string): Promise<Point> {
  await hover(leader, p);
  await expect(cursorOf(watcher, name)).toBeVisible();
  let last = { x: NaN, y: NaN };
  await expect(async () => {
    const now = await posOf(watcher, name);
    const stable = Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5;
    last = now;
    expect(stable).toBe(true);
  }).toPass({ intervals: [250, 250, 250, 500] });
  return last;
}

async function panBy(page: Page, from: Point, d: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 5 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 5 });
  await page.mouse.up();
}

function near(a: Point, b: Point, tol = 6) {
  expect(Math.abs(a.x - b.x), `x: ${a.x} vs ${b.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y), `y: ${a.y} vs ${b.y}`).toBeLessThanOrEqual(tol);
}

function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y };
}

// ---------- COL-09 ----------

test('COL-09 people on the board: second client appears without reload and disappears after leaving', async ({
  browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  const opts = await profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    await expect(people(owner.page)).toContainText('On this board (1)');
    await expect(people(owner.page)).toContainText(`${owner.name} (you)`);
    const guest = await openGuest(browser, opts, owner.token, 'Kate Guest');
    await expect(people(owner.page)).toContainText('On this board (2)');
    await expect(people(owner.page)).toContainText('Kate Guest');
    await expect(people(guest.page)).toContainText('On this board (2)');
    await expect(people(guest.page)).toContainText(owner.name);
    await expect(people(guest.page)).toContainText('Kate Guest (you)');
    await guest.close();
    await expect(people(owner.page)).toContainText('On this board (1)', { timeout: 5000 });
    await expect(people(owner.page)).not.toContainText('Kate Guest');
  } finally {
    await owner.close();
  }
});

test('COL-09 two participants with the same name are two entries; markup in a name is plain text', async ({
  browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  const opts = await profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  const dialogs: string[] = [];
  owner.page.on('dialog', async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  try {
    const a = await openGuest(browser, opts, owner.token, 'Twin');
    const b = await openGuest(browser, opts, owner.token, 'Twin');
    const html = await openGuest(browser, opts, owner.token, '<img src=x onerror=alert(1)>');
    await expect(people(owner.page)).toContainText('On this board (4)');
    await expect(people(owner.page).getByText('Twin', { exact: true })).toHaveCount(2);
    await expect(people(owner.page)).toContainText('<img src=x onerror=alert(1)>');
    await hover(html.page, await at(html.page, 0.5, 0.5));
    await expect(cursorOf(owner.page, '<img src=x onerror=alert(1)>')).toBeVisible();
    await expect(cursorOf(owner.page, '<img src=x onerror=alert(1)>')).toContainText('<img src=x onerror=alert(1)>');
    expect(await owner.page.locator('img[src="x"]').count()).toBe(0);
    expect(dialogs).toEqual([]);
    await Promise.all([a.close(), b.close(), html.close()]);
  } finally {
    await owner.close();
  }
});

// ---------- COL-02 ----------

test('COL-02 cursors and names of others are shown and follow pointer movement; own cursor is not drawn', async ({
  browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  const opts = await profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Kate Guest');
    await expect(people(owner.page)).toContainText('On this board (2)');
    // курсор владельца у участника, подпись — имя учётки
    const c1 = await cursorAfterHover(owner.page, await at(owner.page, 0.3, 0.3), guest.page, owner.name);
    await expect(cursorOf(guest.page, owner.name)).toContainText(owner.name);
    const p1 = await at(owner.page, 0.3, 0.3);
    const p2 = await at(owner.page, 0.6, 0.7);
    const c2 = await cursorAfterHover(owner.page, p2, guest.page, owner.name);
    near(sub(c2, c1), sub(p2, p1));
    // курсор участника у владельца с введённым именем
    await hover(guest.page, await at(guest.page, 0.5, 0.4));
    await expect(cursorOf(owner.page, 'Kate Guest')).toBeVisible();
    await expect(cursorOf(owner.page, 'Kate Guest')).toContainText('Kate Guest');
    // свой курсор не рисуется
    await expect(cursorOf(owner.page, owner.name)).toHaveCount(0);
    await expect(cursorOf(guest.page, 'Kate Guest')).toHaveCount(0);
    // ушедший участник пропадает вместе с курсором
    await guest.close();
    await expect(cursorOf(owner.page, 'Kate Guest')).toHaveCount(0, { timeout: 5000 });
  } finally {
    await owner.close();
  }
});

test('COL-02 cursor of a participant on a phone is seen by the owner on desktop', async ({ browser, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'смешанная пара desktop + mobile — один раз, в профиле mobile');
  const desk = { baseURL, viewport: { width: 1440, height: 900 } };
  const phone = { ...testInfo.project.use, baseURL } as Opts;
  const owner = await openOwner(browser, desk);
  try {
    const guest = await openGuest(browser, phone, owner.token, 'Phone Guest');
    await expect(people(owner.page)).toContainText('On this board (2)');
    const p = await at(guest.page, 0.5, 0.5);
    await guest.page.touchscreen.tap(p.x, p.y);
    const cdp = await guest.page.context().newCDPSession(guest.page);
    const t = (type: string, q?: Point) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: q ? [{ x: q.x, y: q.y, id: 1 }] : [] } as never);
    await t('touchStart', p);
    for (let i = 1; i <= 5; i++) await t('touchMove', { x: p.x + 6 * i, y: p.y + 4 * i });
    await expect(cursorOf(owner.page, 'Phone Guest')).toBeVisible();
    await t('touchEnd');
    await guest.close();
  } finally {
    await owner.close();
  }
});

// ---------- COL-03 ----------

test('COL-03 hide cursors hides others cursors (also new ones) only locally; show brings them back', async ({
  browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  const opts = await profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Kate Guest');
    await hover(guest.page, await at(guest.page, 0.4, 0.4));
    await expect(cursorOf(owner.page, 'Kate Guest')).toBeVisible();
    await owner.page.getByRole('button', { name: 'Hide cursors' }).click();
    await expect(cursorOf(owner.page, 'Kate Guest')).toBeHidden();
    await hover(guest.page, await at(guest.page, 0.6, 0.6));
    // новый участник, пока курсоры скрыты
    const late = await openGuest(browser, opts, owner.token, 'Late Guest');
    await hover(late.page, await at(late.page, 0.5, 0.5));
    await expect(people(owner.page)).toContainText('On this board (3)');
    await owner.page.waitForTimeout(800);
    await expect(cursorOf(owner.page, 'Kate Guest')).toBeHidden();
    await expect(cursorOf(owner.page, 'Late Guest')).toBeHidden();
    // скрытие у владельца не влияет на других: участник видит курсоры
    await hover(owner.page, await at(owner.page, 0.5, 0.5));
    await expect(cursorOf(guest.page, owner.name)).toBeVisible();
    await expect(cursorOf(guest.page, 'Late Guest')).toBeVisible();
    // показать снова
    await owner.page.getByRole('button', { name: 'Show cursors' }).click();
    await hover(late.page, await at(late.page, 0.45, 0.45));
    await expect(cursorOf(owner.page, 'Kate Guest')).toBeVisible();
    await expect(cursorOf(owner.page, 'Late Guest')).toBeVisible();
    await Promise.all([guest.close(), late.close()]);
  } finally {
    await owner.close();
  }
});

// ---------- COL-04 ----------

test('COL-04 follower view repeats pan and zoom of the followed participant until stopped', async ({
  browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  const opts = await profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Follower');
    await expect(people(guest.page)).toContainText('On this board (2)');
    const P = await at(owner.page, 0.5, 0.5);
    const c0 = await cursorAfterHover(owner.page, P, guest.page, owner.name);

    await guest.page.getByRole('button', { name: `Follow ${owner.name}` }).click();
    await expect(guest.page.getByText(`Following ${owner.name}`)).toBeVisible();
    await expect(people(owner.page)).toContainText('following');

    // сдвиг вида ведущего: вид наблюдателя повторяет — курсор на том же месте экрана
    const D = { x: 120, y: -70 };
    await panBy(owner.page, await at(owner.page, 0.3, 0.6), D);
    near(await cursorAfterHover(owner.page, P, guest.page, owner.name), c0);

    // масштаб колесом: расстояния на экране наблюдателя — как у ведущего
    await hover(owner.page, P);
    await owner.page.mouse.wheel(0, -400);
    await owner.page.waitForTimeout(300);
    const cP = await cursorAfterHover(owner.page, P, guest.page, owner.name);
    near(cP, c0);
    const Q = await at(owner.page, 0.7, 0.65);
    const cQ = await cursorAfterHover(owner.page, Q, guest.page, owner.name);
    near(sub(cQ, cP), sub(Q, P));

    // выключение: дальнейшие перемещения ведущего вид наблюдателя не двигают
    await guest.page.getByRole('button', { name: 'Stop following' }).click();
    await expect(guest.page.getByText(`Following ${owner.name}`)).toBeHidden();
    const before = await cursorAfterHover(owner.page, P, guest.page, owner.name);
    const D2 = { x: -90, y: 60 };
    await panBy(owner.page, await at(owner.page, 0.6, 0.4), D2);
    const after = await cursorAfterHover(owner.page, P, guest.page, owner.name);
    // ведущий сдвинул вид, мышь на том же месте экрана → у наблюдателя курсор сместился на −D2 (с учётом масштаба)
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
    expect(Math.sign(after.x - before.x)).toBe(-Math.sign(D2.x));
    expect(Math.sign(after.y - before.y)).toBe(-Math.sign(D2.y));
    await guest.close();
  } finally {
    await owner.close();
  }
});

test('COL-04 owner follows a participant; own pan and leaving of the followed stop following', async ({
  browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor,
}) => {
  const opts = await profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Leader Guest');
    await expect(people(owner.page)).toContainText('On this board (2)');
    const P = await at(guest.page, 0.5, 0.5);
    const c0 = await cursorAfterHover(guest.page, P, owner.page, 'Leader Guest');

    await owner.page.getByRole('button', { name: 'Follow Leader Guest' }).click();
    await expect(owner.page.getByText('Following Leader Guest')).toBeVisible();
    await panBy(guest.page, await at(guest.page, 0.3, 0.3), { x: 100, y: 80 });
    near(await cursorAfterHover(guest.page, P, owner.page, 'Leader Guest'), c0);

    // своё перемещение вида выключает слежение
    await panBy(owner.page, await at(owner.page, 0.4, 0.4), { x: 50, y: 0 });
    await expect(owner.page.getByText('Following Leader Guest')).toBeHidden();
    const b1 = await cursorAfterHover(guest.page, P, owner.page, 'Leader Guest');
    await panBy(guest.page, await at(guest.page, 0.3, 0.3), { x: 100, y: 0 });
    const b2 = await cursorAfterHover(guest.page, P, owner.page, 'Leader Guest');
    expect(b2.x - b1.x).toBeLessThan(-60);

    // снова следим; ведомый уходит — слежение прекращается, интерфейс работает
    await owner.page.getByRole('button', { name: 'Follow Leader Guest' }).click();
    await expect(owner.page.getByText('Following Leader Guest')).toBeVisible();
    await guest.close();
    await expect(owner.page.getByText('Following Leader Guest')).toBeHidden({ timeout: 5000 });
    await expect(people(owner.page)).toContainText('On this board (1)');
    await panBy(owner.page, await at(owner.page, 0.4, 0.4), { x: 30, y: 30 });
    await expect(canvas(owner.page)).toBeVisible();
    // себя выбрать для слежения нельзя
    await expect(owner.page.getByRole('button', { name: `Follow ${owner.name}` })).toHaveCount(0);
  } finally {
    await owner.close();
  }
});
