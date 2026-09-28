// Приёмка T1.4 · открытая вкладка уходит на /login при отзыве сессии (ACC-05).
// Сценарии — docs/qa/reports/T1.4.md. Тест не перезагружает вкладку пользователя и не кликает в ней:
// после ответа администратора он только ждёт адрес /login не дольше 5 с.
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { test, expect } from './fixtures';
import { apiAdminLogin, type CreatedUser } from './admin';
import { apiUserLogin, createBoardUser } from './user';

/** ACC-05: «не позднее чем через 5 секунд». */
const REVOKE_BUDGET_MS = 5_000;
/** Сколько вкладка должна продержаться, когда отзыва нет: окно ACC-05 с запасом. */
const HOLD_MS = 8_000;

test.describe.configure({ timeout: 120_000 });

type ProfileOptions = Pick<
  Parameters<Browser['newContext']>[0] & object,
  'baseURL' | 'viewport' | 'hasTouch' | 'isMobile' | 'userAgent' | 'deviceScaleFactor'
>;

interface Profile {
  browser: Browser;
  options: ProfileOptions;
}

function profile({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}: {
  browser: Browser;
  baseURL: string | undefined;
  viewport: ProfileOptions['viewport'];
  hasTouch: boolean;
  isMobile: boolean;
  userAgent: string | undefined;
  deviceScaleFactor: number | undefined;
}): Profile {
  return { browser, options: { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } };
}

/** Администратор со своей сессией API, вошедший заранее — чтобы отсчёт шёл от ответа на изменение. */
async function adminApi(p: Profile): Promise<{ request: APIRequestContext; close: () => Promise<void> }> {
  const ctx = await p.browser.newContext({ baseURL: p.options.baseURL });
  await apiAdminLogin(ctx.request);
  return { request: ctx.request, close: () => ctx.close() };
}

async function patchUser(admin: APIRequestContext, id: string, data: Record<string, unknown>): Promise<number> {
  const res = await admin.patch(`/api/admin/users/${id}`, { data });
  expect(res.status(), await res.text()).toBe(200);
  return Date.now();
}

/** Открытая вкладка пользователя досок в отдельном контексте профиля (вход — через публичный API). */
async function openUserTab(
  p: Profile,
  user: CreatedUser,
  path = '/',
  storageState?: Awaited<ReturnType<BrowserContext['storageState']>>,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await p.browser.newContext({ ...p.options, storageState });
  if (!storageState) await apiUserLogin(context.request, user);
  const page = await context.newPage();
  await page.goto(path);
  return { context, page };
}

async function expectSignedIn(page: Page, name?: string) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  if (name) await expect(page.getByText(name)).toBeVisible();
}

/** Вкладка сама перешла на /login не позже 5 с от момента `since`. */
async function expectLeftToLogin(page: Page, since: number, info: TestInfo, label = 'tab') {
  const left = Math.max(0, REVOKE_BUDGET_MS - (Date.now() - since));
  await expect(page).toHaveURL(/\/login$/, { timeout: left });
  const elapsed = Date.now() - since;
  info.annotations.push({ type: 'ACC-05', description: `${label}: /login через ${elapsed} мс` });
  expect(elapsed).toBeLessThanOrEqual(REVOKE_BUDGET_MS);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

/** Вкладка остаётся на `path` и в системе всё окно HOLD_MS. */
async function expectStays(page: Page, path: RegExp, ms = HOLD_MS) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    expect(page.url()).toMatch(path);
    await page.waitForTimeout(250);
  }
  await expect(page).toHaveURL(path);
}

function newPassword(): string {
  return `new-${Math.random().toString(36).slice(2)}`;
}

test('ACC-05 password change by the admin sends the open tab to /login within 5 s without reload or clicks', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const admin = await adminApi(p);
  const tab = await openUserTab(p, user);
  await expectSignedIn(tab.page, user.name);
  // Маркер в окне: если вкладку перезагрузит кто-то, кроме приложения, — видно в аннотации.
  await tab.page.evaluate(() => ((window as unknown as { __qa?: number }).__qa = 1));

  const since = await patchUser(admin.request, user.id, { password: newPassword() });
  await expectLeftToLogin(tab.page, since, info);

  const kept = await tab.page.evaluate(() => (window as unknown as { __qa?: number }).__qa === 1);
  info.annotations.push({ type: 'ACC-05', description: kept ? 'переход без перезагрузки документа (SPA)' : 'переход с загрузкой документа' });
  await admin.close();
  await tab.context.close();
});

test('ACC-05 disabling the account sends the open tab to /login within 5 s', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const admin = await adminApi(p);
  const tab = await openUserTab(p, user);
  await expectSignedIn(tab.page, user.name);

  const since = await patchUser(admin.request, user.id, { disabled: true });
  await expectLeftToLogin(tab.page, since, info);

  // Страница входа стабильна: нет цикла переходов.
  await expectStays(tab.page, /\/login$/, 4_000);

  // ADM-06: после включения вход снова возможен, новая вкладка не выбивается.
  await patchUser(admin.request, user.id, { disabled: false });
  const again = await openUserTab(p, user);
  await expectSignedIn(again.page, user.name);
  await expectStays(again.page, /\/$/);
  await admin.close();
  await tab.context.close();
  await again.context.close();
});

for (const path of ['/boards/42', '/templates']) {
  test(`ACC-05 open user page ${path} also leaves to /login within 5 s after password change`, async ({
    browser,
    baseURL,
    viewport,
    hasTouch,
    isMobile,
    userAgent,
    deviceScaleFactor,
  }, info) => {
    const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    const user = await createBoardUser(browser, baseURL);
    const admin = await adminApi(p);
    const tab = await openUserTab(p, user, path);
    await expect(tab.page).toHaveURL(new RegExp(`${path}$`));
    await tab.page.waitForTimeout(1_000);
    await expect(tab.page).toHaveURL(new RegExp(`${path}$`));

    const since = await patchUser(admin.request, user.id, { password: newPassword() });
    await expectLeftToLogin(tab.page, since, info, path);
    await admin.close();
    await tab.context.close();
  });
}

test('ACC-05 every open tab of the account and a copy of its browser state leave to /login within 5 s', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const admin = await adminApi(p);
  const one = await openUserTab(p, user);
  const two = await openUserTab(p, user);
  await expectSignedIn(one.page, user.name);
  await expectSignedIn(two.page, user.name);
  // Посторонний: браузер с сохранённым состоянием первой вкладки (скопированная cookie).
  const copy = await openUserTab(p, user, '/', await one.context.storageState());
  await expectSignedIn(copy.page, user.name);

  const since = await patchUser(admin.request, user.id, { password: newPassword() });
  await Promise.all([
    expectLeftToLogin(one.page, since, info, 'first tab'),
    expectLeftToLogin(two.page, since, info, 'second tab'),
    expectLeftToLogin(copy.page, since, info, 'copied state'),
  ]);
  await admin.close();
  for (const c of [one, two, copy]) await c.context.close();
});

for (const [label, change] of [
  ['name', { name: `Renamed ${Math.random().toString(36).slice(2, 6)}` }],
  ['email', { email: `qa-e2e-moved-${Math.random().toString(36).slice(2, 10)}@example.com` }],
  [
    'name and email',
    {
      name: `Renamed ${Math.random().toString(36).slice(2, 6)}`,
      email: `qa-e2e-moved-${Math.random().toString(36).slice(2, 10)}@example.com`,
    },
  ],
] as const) {
  test(`ACC-05 changing only ${label} keeps the open tab signed in`, async ({
    browser,
    baseURL,
    viewport,
    hasTouch,
    isMobile,
    userAgent,
    deviceScaleFactor,
  }) => {
    const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    const user = await createBoardUser(browser, baseURL);
    const admin = await adminApi(p);
    const tab = await openUserTab(p, user);
    await expectSignedIn(tab.page, user.name);

    // Уникальная почта для каждого профиля прогона.
    const data: Record<string, string> = { ...change };
    if (data.email) data.email = data.email.replace('@', `-${Math.random().toString(36).slice(2, 6)}@`);
    await patchUser(admin.request, user.id, data);
    await expectStays(tab.page, /\/$/);
    await expect(tab.page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    const session = await tab.context.request.get('/api/session');
    expect((await session.json()).authenticated).toBe(true);
    await admin.close();
    await tab.context.close();
  });
}

test('ACC-05 revoking one account does not sign out another user nor the admin panel', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const a = await createBoardUser(browser, baseURL);
  const b = await createBoardUser(browser, baseURL);
  const admin = await adminApi(p);
  const tabA = await openUserTab(p, a);
  const tabB = await openUserTab(p, b);
  await expectSignedIn(tabA.page, a.name);
  await expectSignedIn(tabB.page, b.name);

  const adminCtx = await browser.newContext(p.options);
  await apiAdminLogin(adminCtx.request);
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin/users');
  await expect(adminPage.getByRole('row', { name: a.email })).toBeVisible();

  const since = await patchUser(admin.request, a.id, { password: newPassword() });
  await expectLeftToLogin(tabA.page, since, info, 'A');
  await patchUser(admin.request, a.id, { disabled: true });
  await Promise.all([expectStays(tabB.page, /\/$/), expectStays(adminPage, /\/admin\/users$/)]);
  await expectSignedIn(tabB.page, b.name);
  await expect(adminPage.getByRole('row', { name: a.email })).toBeVisible();
  await admin.close();
  for (const c of [tabA.context, tabB.context, adminCtx]) await c.close();
});

test('ACC-05 new password or Disable saved in /admin/users sends the user tab to /login within 5 s', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const adminCtx = await browser.newContext(p.options);
  await apiAdminLogin(adminCtx.request);
  const adminPage = await adminCtx.newPage();
  await adminPage.goto('/admin/users');

  // Смена пароля через Edit → New password → Save.
  let tab = await openUserTab(p, user);
  await expectSignedIn(tab.page, user.name);
  await adminPage.getByRole('row', { name: user.email }).getByRole('button', { name: 'Edit' }).click();
  const row = adminPage.getByRole('row', { name: user.email });
  const password = newPassword();
  await row.getByLabel('New password').fill(password);
  const saved = adminPage.waitForResponse((r) => r.url().includes(`/api/admin/users/${user.id}`) && r.request().method() === 'PATCH');
  await row.getByRole('button', { name: 'Save' }).click();
  expect((await saved).status()).toBe(200);
  await expectLeftToLogin(tab.page, Date.now(), info, 'Save password');
  await tab.context.close();

  // Отключение кнопкой Disable.
  user.password = password;
  tab = await openUserTab(p, user);
  await expectSignedIn(tab.page, user.name);
  const disabled = adminPage.waitForResponse((r) => r.url().includes(`/api/admin/users/${user.id}`) && r.request().method() === 'PATCH');
  await adminPage.getByRole('row', { name: user.email }).getByRole('button', { name: 'Disable' }).click();
  expect((await disabled).status()).toBe(200);
  await expectLeftToLogin(tab.page, Date.now(), info, 'Disable');

  await expectStays(adminPage, /\/admin\/users$/, 3_000);
  await expect(adminPage.getByRole('row', { name: user.email })).toContainText('Disabled');
  await tab.context.close();
  await adminCtx.close();
});

test('ACC-05 tab hidden during revocation leaves to /login within 5 s once it is shown again', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const admin = await adminApi(p);
  const tab = await openUserTab(p, user);
  await expectSignedIn(tab.page, user.name);

  // Эмуляция ухода вкладки в фон.
  await tab.page.evaluate(() => {
    const w = window as unknown as { __qaVisible: boolean };
    w.__qaVisible = false;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (w.__qaVisible ? 'visible' : 'hidden') });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !w.__qaVisible });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  await patchUser(admin.request, user.id, { password: newPassword() });
  await tab.page.waitForTimeout(6_000);
  info.annotations.push({ type: 'ACC-05', description: `скрытая вкладка через 6 с: ${new URL(tab.page.url()).pathname}` });

  const shown = Date.now();
  await tab.page.evaluate(() => {
    (window as unknown as { __qaVisible: boolean }).__qaVisible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  await expectLeftToLogin(tab.page, shown, info, 'shown again');
  await admin.close();
  await tab.context.close();
});

test('ACC-05 a 401 answer from the user API sends the tab to /login within 5 s', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const tab = await openUserTab(p, user);
  await expectSignedIn(tab.page, user.name);
  // Сервер отвечает 401 на запросы API пользователя (сессия отозвана), в браузере — подмена ответа.
  await tab.page.route(/\/api\/(?!admin\/)(?!login$).*/, (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Not authenticated"}' }),
  );
  const since = Date.now();
  await expectLeftToLogin(tab.page, since, info, '401');
  await tab.context.close();
});

for (const [label, fault] of [
  ['server error 503', 'error'],
  ['network failure', 'abort'],
] as const) {
  test(`ACC-05 ${label} while checking the session does not sign the user out`, async ({
    browser,
    baseURL,
    viewport,
    hasTouch,
    isMobile,
    userAgent,
    deviceScaleFactor,
  }) => {
    const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    const user = await createBoardUser(browser, baseURL);
    const tab = await openUserTab(p, user);
    await expectSignedIn(tab.page, user.name);
    let hits = 0;
    await tab.page.route(/\/api\/session$/, (route) => {
      hits++;
      return fault === 'abort'
        ? route.abort('internetdisconnected')
        : route.fulfill({ status: 503, contentType: 'text/plain', body: 'unavailable' });
    });
    await expectStays(tab.page, /\/$/);
    expect(hits, 'вкладка проверяла сессию в окне').toBeGreaterThan(0);
    await tab.page.unroute(/\/api\/session$/);
    await expectStays(tab.page, /\/$/, 3_000);
    await expect(tab.page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await tab.context.close();
  });
}

test('ACC-05 after leaving to /login the new password signs in and the tab stays; background checks go only to the page origin', async ({
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}, info) => {
  const p = profile({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const user = await createBoardUser(browser, baseURL);
  const admin = await adminApi(p);
  const tab = await openUserTab(p, user);
  const origins = new Set<string>();
  const sessionChecks: number[] = [];
  tab.page.on('request', (r) => {
    origins.add(new URL(r.url()).origin);
    if (new URL(r.url()).pathname === '/api/session') sessionChecks.push(Date.now());
  });
  await expectSignedIn(tab.page, user.name);
  // Живая сессия без отзыва: вкладку фоновые проверки не выбивают (ARCH-T14-01 — только свой origin).
  await expectStays(tab.page, /\/$/);

  const password = newPassword();
  const since = await patchUser(admin.request, user.id, { password });
  await expectLeftToLogin(tab.page, since, info);
  await expectStays(tab.page, /\/login$/, 3_000);

  // Вход новым паролем в той же вкладке — тот же сценарий, что у пользователя.
  await tab.page.getByLabel('Email').fill(user.email);
  await tab.page.getByLabel('Password').fill(password);
  await tab.page.getByRole('button', { name: 'Sign in' }).click();
  await expectSignedIn(tab.page, user.name);
  await expectStays(tab.page, /\/$/);

  const expected = new URL(baseURL ?? '').origin;
  expect([...origins]).toEqual([expected]);
  expect(sessionChecks.length, 'вкладка проверяла сессию в фоне').toBeGreaterThan(0);
  await admin.close();
  await tab.context.close();
});
