// Приёмка T1.1 · панель администратора в браузере (ADM-01…07, ARCH-ADM-*).
// Сценарии — docs/qa/reports/T1.1.md; маршруты и подписи — из handoff T1.1.
// Неудачных входов здесь мало: лимит попыток общий для всех клиентов стенда.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { ADMIN_COOKIE, adminCredentials, apiAdminLogin, apiCreateUser, uniqueEmail } from './admin';

async function openUsers(page: Page) {
  await page.goto('/admin/users');
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible();
}

async function createViaForm(page: Page, name: string, email: string, password: string) {
  const form = page.getByRole('region', { name: 'Create user' });
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Email').fill(email);
  await form.getByLabel('Password').fill(password);
  await form.getByRole('button', { name: 'Create user' }).click();
}

test('ADM-01 admin signs in through /admin/login and reaches /admin/users', async ({ page }) => {
  const { email, password } = adminCredentials();
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible();
});

test('ADM-01 wrong password shows a terse error and no session', async ({ page, context }) => {
  const { email, password } = adminCredentials();
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(`${password}-wrong`);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect((await context.cookies()).some((c) => c.name === ADMIN_COOKIE && c.value)).toBe(false);
});

test('ADM-01 anonymous visitor does not see the account list', async ({ page, browser, baseURL }) => {
  const adminCtx = await browser.newContext({ baseURL });
  await apiAdminLogin(adminCtx.request);
  const user = await apiCreateUser(adminCtx.request);
  await adminCtx.close();
  await page.goto('/admin/users');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByText(user.email)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Create user' })).toHaveCount(0);
});

test('ADM-02 ADM-03 account created in the form appears in the list', async ({ adminPage: page }) => {
  await openUsers(page);
  const email = uniqueEmail('ui');
  await createViaForm(page, 'Form User', email, 'secret-pass-1');
  const row = page.getByRole('row', { name: email });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Form User');
  await expect(row).toContainText('Active');
  // После перезагрузки учётка по-прежнему в списке (сохранена на сервере).
  await page.reload();
  await expect(page.getByRole('row', { name: email })).toBeVisible();
});

test('ADM-02 accounts created elsewhere are listed', async ({ adminPage: page }) => {
  const user = await apiCreateUser(page.request);
  await openUsers(page);
  const row = page.getByRole('row', { name: user.email });
  await expect(row).toContainText(user.name);
});

test('ADM-07 duplicate email in the form shows an error and the list is unchanged', async ({
  adminPage: page,
}) => {
  const user = await apiCreateUser(page.request);
  await openUsers(page);
  await createViaForm(page, 'Duplicate', user.email.toUpperCase(), 'another-pass-1');
  await expect(page.getByRole('region', { name: 'Create user' }).getByRole('alert')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('row', { name: user.email })).toHaveCount(1);
  await expect(page.getByRole('row', { name: user.email })).not.toContainText('Duplicate');
});

test('ADM-04 edit changes name and email in the list', async ({ adminPage: page }) => {
  const user = await apiCreateUser(page.request);
  await openUsers(page);
  await page.getByRole('row', { name: user.email }).getByRole('button', { name: 'Edit' }).click();
  const row = page.getByRole('row', { name: user.email });
  const newEmail = uniqueEmail('edited');
  await row.getByLabel('Name').fill('Edited Name');
  await row.getByLabel('Email').fill(newEmail);
  await row.getByLabel('New password').fill('fresh-pass-2');
  await row.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('row', { name: newEmail })).toContainText('Edited Name');
  await page.reload();
  await expect(page.getByRole('row', { name: newEmail })).toContainText('Edited Name');
  await expect(page.getByRole('row', { name: user.email })).toHaveCount(0);
});

test('ADM-05 ADM-06 disable and enable toggle the account status', async ({ adminPage: page }) => {
  const user = await apiCreateUser(page.request);
  await openUsers(page);
  const row = page.getByRole('row', { name: user.email });
  await row.getByRole('button', { name: 'Disable' }).click();
  await expect(row).toContainText('Disabled');
  await page.reload();
  await expect(page.getByRole('row', { name: user.email })).toContainText('Disabled');
  await page.getByRole('row', { name: user.email }).getByRole('button', { name: 'Enable' }).click();
  await expect(page.getByRole('row', { name: user.email })).toContainText('Active');
  await page.reload();
  await expect(page.getByRole('row', { name: user.email })).toContainText('Active');
});

test('ADM-01 sign out returns to /admin/login and closes the panel', async ({ adminPage: page }) => {
  await openUsers(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.goto('/admin/users');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  expect((await page.request.get('/api/admin/users')).status()).toBe(401);
});

test('ARCH-ADM-01 session cookie is HttpOnly, SameSite=Lax, not Secure on http', async ({
  adminPage: page,
  context,
  baseURL,
}) => {
  await openUsers(page);
  const cookie = (await context.cookies()).find((c) => c.name === ADMIN_COOKIE);
  expect(cookie, 'нет cookie сессии администратора').toBeTruthy();
  expect(cookie!.httpOnly).toBe(true);
  expect(cookie!.sameSite).toBe('Lax');
  if (baseURL!.startsWith('http://')) expect(cookie!.secure).toBe(false);
  expect(await page.evaluate(() => document.cookie)).not.toContain(ADMIN_COOKIE);
});

test('ARCH-ADM-05 panel talks to the API on the page origin only', async ({ page, baseURL }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  const { email, password } = adminCredentials();
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Create user' })).toBeVisible();
  const origin = new URL(baseURL!).origin;
  expect(urls.some((u) => u.startsWith(`${origin}/api/admin/`))).toBe(true);
  for (const u of urls) {
    expect(u.startsWith('data:') || new URL(u).origin === origin, u).toBe(true);
    expect(u).not.toMatch(/localhost|127\.0\.0\.1|0\.0\.0\.0/);
  }
});

test('ARCH-ADM-06 panel interface strings are English', async ({
  adminPage: page,
  browser,
  baseURL,
}) => {
  await openUsers(page);
  const text = await page.locator('body').innerText();
  // Кириллица допустима только во введённых данных; строк, созданных QA кириллицей,
  // в этой проверке нет, кроме имён из api-тестов — их исключаем по ячейкам таблицы.
  const withoutData = text
    .split('\n')
    .filter((line) => !/@example\.com/.test(line))
    .join('\n');
  const tableCells = await page.locator('td').allInnerTexts();
  let chrome = withoutData;
  for (const cell of tableCells) chrome = chrome.split(cell).join('');
  expect(chrome).not.toMatch(/[А-Яа-яЁё]/);
  // Вошедшего администратора /admin/login уводит в панель — форму смотрим анонимно.
  const anon = await browser.newContext({ baseURL });
  const login = await anon.newPage();
  await login.goto('/admin/login');
  await expect(login.getByRole('heading', { name: 'Admin sign in' })).toBeVisible();
  expect(await login.locator('body').innerText()).not.toMatch(/[А-Яа-яЁё]/);
  await anon.close();
});

test('ARCH-ADM-08 users page has no horizontal scroll', async ({ adminPage: page }) => {
  await apiCreateUser(page.request, { name: 'Wide Row User', email: uniqueEmail('wide-row-check') });
  await openUsers(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
