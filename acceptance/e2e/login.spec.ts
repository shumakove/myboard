// Приёмка T1.2 · вход пользователя досок в браузере (ACC-01…03, перенос ADM-04…06, ARCH-ACC-*).
// Сценарии — docs/qa/reports/T1.2.md; подписи формы — из handoff T1.2.
// Неудачных входов здесь мало: лимит попыток общий для всех клиентов стенда.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { CreatedUser } from './admin';
import { SESSION_COOKIE, adminPatchUser, createBoardUser } from './user';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectSignedIn(page: Page, user: CreatedUser) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(user.name)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function expectOnLogin(page: Page) {
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

test('ACC-01 user signs in on /login with credentials set by admin and lands on /', async ({
  page,
  browser,
  baseURL,
}) => {
  const user = await createBoardUser(browser, baseURL);
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user);
});

test('ACC-01 ACC-03 anonymous visitor on / is sent to /login', async ({ page }) => {
  await page.goto('/');
  await expectOnLogin(page);
});

test('ACC-02 unknown email, wrong password and disabled account show the same message', async ({
  page,
  browser,
  baseURL,
}) => {
  const active = await createBoardUser(browser, baseURL);
  const disabled = await createBoardUser(browser, baseURL);
  await adminPatchUser(browser, baseURL, disabled.id, { disabled: true });
  const attempts: Array<[string, string]> = [
    [`qa-nobody-${Math.random().toString(36).slice(2, 10)}@example.com`, 'whatever-1'],
    [active.email, `${active.password}-wrong`],
    [disabled.email, disabled.password],
  ];
  const messages: string[] = [];
  for (const [email, password] of attempts) {
    await signIn(page, email, password);
    const alert = page.getByRole('alert');
    await expect(alert).toBeVisible();
    messages.push((await alert.innerText()).trim());
    await expectOnLogin(page);
  }
  expect(new Set(messages).size, messages.join(' | ')).toBe(1);
  expect(messages[0]).not.toMatch(/disabled|not found|unknown|exist/i);
  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === SESSION_COOKIE && c.value)).toBe(false);
});

test('ACC-03 user stays signed in after the browser is closed and reopened', async ({
  page,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
}) => {
  const user = await createBoardUser(browser, baseURL);
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user);
  const state = await page.context().storageState();
  const cookie = state.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie, 'нет cookie сессии').toBeTruthy();
  // Постоянная cookie: не сессионная (-1) и живёт не меньше года.
  expect(cookie!.expires).toBeGreaterThan(Date.now() / 1000 + 365 * 24 * 3600);
  await page.context().close();

  const reopened = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, userAgent, storageState: state });
  const again = await reopened.newPage();
  await again.goto('/');
  await expectSignedIn(again, user);
  await again.goto('/login');
  await expect(again).toHaveURL(/\/$/);
  await reopened.close();
});

test('ACC-03 after Sign out the user is not signed in, also after reopening the browser', async ({
  page,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
}) => {
  const user = await createBoardUser(browser, baseURL);
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user);
  const before = await page.context().storageState();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expectOnLogin(page);
  await page.goto('/');
  await expectOnLogin(page);
  const after = await page.context().storageState();

  for (const state of [after, before]) {
    // «before» — сохранённая до выхода cookie: после выхода она тоже не действует.
    const ctx = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, userAgent, storageState: state });
    const p = await ctx.newPage();
    await p.goto('/');
    await expectOnLogin(p);
    await ctx.close();
  }
});

test('ADM-05 disabling the account ends the open session; ADM-06 enabling restores sign-in', async ({
  page,
  browser,
  baseURL,
}) => {
  const user = await createBoardUser(browser, baseURL);
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user);
  await adminPatchUser(browser, baseURL, user.id, { disabled: true });
  await page.goto('/');
  await expectOnLogin(page);
  await adminPatchUser(browser, baseURL, user.id, { disabled: false });
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user);
});

test('ADM-04 new password works in the form after admin change', async ({ page, browser, baseURL }) => {
  const user = await createBoardUser(browser, baseURL);
  const password = `new-${Math.random().toString(36).slice(2)}`;
  await adminPatchUser(browser, baseURL, user.id, { password });
  await signIn(page, user.email, password);
  await expectSignedIn(page, user);
});

test('ARCH-ACC-01 session cookie is HttpOnly, SameSite=Lax, not Secure on http and hidden from scripts', async ({
  boardUserPage: page,
}) => {
  await page.goto('/');
  const cookie = (await page.context().cookies()).find((c) => c.name === SESSION_COOKIE);
  expect(cookie).toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe('Lax');
  expect(cookie!.secure).toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toContain(SESSION_COOKIE);
});

test('ARCH-ACC-04 sign-in requests go to the page address, never localhost', async ({
  page,
  browser,
  baseURL,
}) => {
  const user = await createBoardUser(browser, baseURL);
  const hosts = new Set<string>();
  const paths: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    hosts.add(url.host);
    if (url.pathname.startsWith('/api')) paths.push(url.pathname);
  });
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user);
  expect([...hosts]).toEqual([new URL(baseURL!).host]);
  expect(paths).toContain('/api/login');
});

test('ARCH-ACC-05 /login interface strings are in English', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toMatch(/[А-Яа-яЁё]/);
});

test('ARCH-ACC-07 /login fits the phone width and sign-in works by tap', async ({
  page,
  browser,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, 'только профиль mobile');
  const user = await createBoardUser(browser, baseURL);
  await page.goto('/login');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).tap();
  await expectSignedIn(page, user);
});
