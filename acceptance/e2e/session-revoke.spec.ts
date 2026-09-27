// Приёмка T1.3 · отзыв сессий при смене пароля в браузере (ADM-04, дополнение).
// Сценарии — docs/qa/reports/T1.3.md; подписи формы панели — из handoff T1.1.
import type { Page } from '@playwright/test';
import { test, expect, type BrowserClient } from './fixtures';
import type { CreatedUser } from './admin';
import { adminPatchUser, createBoardUser } from './user';

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectSignedIn(page: Page, name: string) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

async function expectOnLogin(page: Page) {
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
}

function newPassword(): string {
  return `new-${Math.random().toString(36).slice(2)}`;
}

async function signedInTwice(
  [one, two]: [BrowserClient, BrowserClient],
  user: CreatedUser,
): Promise<void> {
  for (const c of [one, two]) {
    await signIn(c.page, user.email, user.password);
    await expectSignedIn(c.page, user.name);
  }
}

test('ADM-04 password change sends every open tab of the account to /login; new password signs in', async ({
  twoClients,
  browser,
  baseURL,
}) => {
  const user = await createBoardUser(browser, baseURL);
  await signedInTwice(twoClients, user);
  const password = newPassword();
  await adminPatchUser(browser, baseURL, user.id, { password });
  for (const c of twoClients) {
    await c.page.reload();
    await expectOnLogin(c.page);
  }
  const [one] = twoClients;
  await signIn(one.page, user.email, password);
  await expectSignedIn(one.page, user.name);
});

test('ADM-04 browser state saved before the password change no longer signs in', async ({
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
  await expectSignedIn(page, user.name);
  const saved = await page.context().storageState();
  await adminPatchUser(browser, baseURL, user.id, { password: newPassword() });

  const reopened = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, userAgent, storageState: saved });
  const again = await reopened.newPage();
  await again.goto('/');
  await expectOnLogin(again);
  await reopened.close();
});

test('ADM-04 changing only name and email keeps the open tab signed in', async ({ page, browser, baseURL }) => {
  const user = await createBoardUser(browser, baseURL);
  await signIn(page, user.email, user.password);
  await expectSignedIn(page, user.name);
  const name = `Renamed ${Math.random().toString(36).slice(2, 6)}`;
  const email = `qa-e2e-moved-${Math.random().toString(36).slice(2, 10)}@example.com`;
  await adminPatchUser(browser, baseURL, user.id, { name, email });
  await page.reload();
  await expectSignedIn(page, name);
});

test('ADM-04 new password saved in the admin panel ends the user session, the admin stays signed in', async ({
  adminPage,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
}) => {
  const user = await createBoardUser(browser, baseURL);
  const userCtx = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, userAgent });
  const userPage = await userCtx.newPage();
  await signIn(userPage, user.email, user.password);
  await expectSignedIn(userPage, user.name);

  await adminPage.goto('/admin/users');
  await adminPage.getByRole('row', { name: user.email }).getByRole('button', { name: 'Edit' }).click();
  const row = adminPage.getByRole('row', { name: user.email });
  const password = newPassword();
  await row.getByLabel('New password').fill(password);
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(row.getByRole('button', { name: 'Edit' })).toBeVisible();

  await userPage.reload();
  await expectOnLogin(userPage);

  // Панель администратора продолжает работать после правки.
  await adminPage.reload();
  await expect(adminPage).toHaveURL(/\/admin\/users$/);
  await expect(adminPage.getByRole('row', { name: user.email })).toBeVisible();

  await signIn(userPage, user.email, password);
  await expectSignedIn(userPage, user.name);
  await userCtx.close();
});
