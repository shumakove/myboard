// Приёмка T3.1 · ссылка на доску и вход по ссылке в браузере (SHR-01…03, SHR-05, SHR-06, ARCH-T31-*).
// Сценарии — docs/qa/reports/T3.1.md; подписи интерфейса — из handoff T3.1.
// Данные готовятся через публичный API; участник — отдельный контекст без сессии пользователя.
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { createBoardUser, apiUserLogin } from './user';

interface Link {
  token: string;
  url: string;
}

function failOnNativeDialogs(page: Page) {
  page.on('dialog', async (d) => {
    await d.dismiss();
    throw new Error(`нативный диалог браузера: ${d.type()} ${d.message()}`);
  });
}

async function apiLink(page: Page, boardId: string): Promise<Link> {
  const res = await page.request.get(`/api/boards/${boardId}/share`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Link;
}

/** Новый контекст в настройках текущего профиля — «другой браузер» без cookie. */
async function freshPage(
  browser: Browser,
  opts: BrowserContextOptions,
): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext(opts);
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

function profile(p: {
  baseURL?: string;
  viewport: BrowserContextOptions['viewport'];
  hasTouch: boolean;
  isMobile: boolean;
  userAgent?: string;
  deviceScaleFactor?: number;
}): BrowserContextOptions {
  return {
    baseURL: p.baseURL,
    viewport: p.viewport,
    hasTouch: p.hasTouch,
    isMobile: p.isMobile,
    userAgent: p.userAgent,
    deviceScaleFactor: p.deviceScaleFactor,
  };
}

async function press(page: Page, name: string, isMobile: boolean) {
  const button = page.getByRole('button', { name, exact: true });
  if (isMobile) await button.tap();
  else await button.click();
}

async function openShare(page: Page, boardId: string, isMobile: boolean) {
  await page.goto(`/boards/${boardId}`);
  await press(page, 'Share', isMobile);
  const dialog = page.getByRole('dialog', { name: 'Share board' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// ---------- SHR-01 ----------

test('SHR-01 owner sees board link built from PUBLIC_BASE_URL in Share dialog', async ({
  boardUserPage: page,
  board,
  baseURL,
  isMobile,
}) => {
  failOnNativeDialogs(page);
  const dialog = await openShare(page, board.id, isMobile);
  const field = dialog.getByLabel('Board link');
  const value = await field.inputValue();
  const api = await apiLink(page, board.id);
  expect(value).toBe(api.url);
  expect(value).toBe(`${baseURL}/b/${api.token}`);
  expect(value).not.toMatch(/localhost|127\.0\.0\.1/);
});

test('SHR-01 Copy link puts the board link on the clipboard', async ({ boardUserPage: page, board, isMobile }) => {
  failOnNativeDialogs(page);
  // Перехват того, что браузер отдаёт в буфер обмена: событие copy (execCommand по http)
  // и Clipboard API (защищённый контекст).
  await page.addInitScript(() => {
    const w = window as unknown as { __copied: string[] };
    w.__copied = [];
    document.addEventListener('copy', () => {
      const el = document.activeElement as HTMLInputElement | null;
      let text = window.getSelection()?.toString() ?? '';
      if (!text && el && typeof el.selectionStart === 'number' && el.selectionEnd !== null) {
        text = el.value.substring(el.selectionStart, el.selectionEnd);
      }
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
  const dialog = await openShare(page, board.id, isMobile);
  const url = await dialog.getByLabel('Board link').inputValue();
  await press(page, 'Copy link', isMobile);
  await expect(page.getByText('Link copied.')).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);
  expect(copied).toContain(url);
});

// ---------- SHR-02, SHR-03 ----------

test('SHR-02 SHR-03 browser without account opens the link, enters a name and gets onto the board', async ({
  boardUserPage,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const { url } = await apiLink(boardUserPage, board.id);
  const guest = await freshPage(browser, profile({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = guest.page;
    failOnNativeDialogs(page);
    await page.goto(url);
    await expect(page.getByText('Enter your name to join the board.')).toBeVisible();
    await expect(page.getByText(/You joined as/)).toHaveCount(0);
    await page.getByLabel('Your name').fill('Даша <b>QA</b>');
    await press(page, 'Join board', isMobile);
    await expect(page.getByText('You joined as Даша <b>QA</b>.')).toBeVisible();
    expect(await page.evaluate(() => document.cookie)).toBe('');
    // Повторное открытие в той же сессии имя не спрашивает.
    await page.reload();
    await expect(page.getByText('You joined as Даша <b>QA</b>.')).toBeVisible();
    await expect(page.getByLabel('Your name')).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

test('SHR-03 empty or blank name does not let the participant in', async ({
  boardUserPage,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const { url, token } = await apiLink(boardUserPage, board.id);
  const guest = await freshPage(browser, profile({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = guest.page;
    failOnNativeDialogs(page);
    await page.goto(url);
    for (const value of ['', '   ']) {
      await page.getByLabel('Your name').fill(value);
      const join = page.getByRole('button', { name: 'Join board', exact: true });
      if (await join.isEnabled()) await press(page, 'Join board', isMobile);
      await expect(page.getByText(/You joined as/)).toHaveCount(0);
    }
    const state = await page.request.get(`/api/share/${token}`);
    expect(((await state.json()) as { participant: unknown }).participant).toBeNull();
  } finally {
    await guest.close();
  }
});

test('SHR-03 markup in the name is shown as text and not executed', async ({
  boardUserPage,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const { url } = await apiLink(boardUserPage, board.id);
  const guest = await freshPage(browser, profile({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = guest.page;
    failOnNativeDialogs(page);
    const name = '<img src=x onerror="alert(1)">';
    await page.goto(url);
    await page.getByLabel('Your name').fill(name);
    await press(page, 'Join board', isMobile);
    await expect(page.getByText(`You joined as ${name}.`)).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

// ---------- SHR-05 ----------

test('SHR-05 unknown and revoked links show the same refusal page', async ({
  boardUserPage,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const old = await apiLink(boardUserPage, board.id);
  expect((await boardUserPage.request.post(`/api/boards/${board.id}/share/reset`)).status()).toBe(200);
  const guest = await freshPage(browser, profile({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = guest.page;
    const texts: string[] = [];
    const unknown = 'Q'.repeat(43);
    for (const path of [`/b/${old.token}`, `/b/${unknown}`, '/b/x', `/b/${board.id}`]) {
      await page.goto(path);
      await expect(page.getByText('This link is not available.')).toBeVisible();
      await expect(page.getByLabel('Your name')).toHaveCount(0);
      texts.push((await page.locator('body').innerText()).trim());
    }
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).not.toContain(board.title ?? '\u0000');
  } finally {
    await guest.close();
  }
});

test('SHR-05 participant does not get the board list or the owner board page', async ({
  linkParticipantPage: page,
  board,
}) => {
  await expect(page.getByText('You joined as QA Guest.')).toBeVisible();
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await page.goto(`/boards/${board.id}`);
  await expect(page).toHaveURL(/\/login$/);
});

test('SHR-05 board page address without owner session does not open the board', async ({
  boardUserPage,
  board,
  browser,
  baseURL,
}) => {
  const other = await createBoardUser(browser, baseURL);
  const ctx = await browser.newContext({ baseURL });
  try {
    await apiUserLogin(ctx.request, other);
    const page = await ctx.newPage();
    const resp = await page.request.get(`/api/boards/${board.id}`);
    expect([403, 404]).toContain(resp.status());
    await page.goto(`/boards/${board.id}`);
    await expect(page.getByText((board as { title?: string }).title ?? 'QA board')).toHaveCount(0);
    expect(await boardUserPage.request.get(`/api/boards/${board.id}`).then((r) => r.status())).toBe(200);
  } finally {
    await ctx.close();
  }
});

// ---------- SHR-06 ----------

test('SHR-06 Reset link in Share dialog shows a new link; old link stops working, new one works', async ({
  boardUserPage: page,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  failOnNativeDialogs(page);
  const dialog = await openShare(page, board.id, isMobile);
  const field = dialog.getByLabel('Board link');
  const oldUrl = await field.inputValue();

  // Отмена подтверждения ссылку не меняет.
  await press(page, 'Reset link', isMobile);
  await press(page, 'Cancel', isMobile);
  await expect(field).toHaveValue(oldUrl);
  expect((await apiLink(page, board.id)).url).toBe(oldUrl);

  await press(page, 'Reset link', isMobile);
  await press(page, 'Reset', isMobile);
  await expect(page.getByText('New link created. The previous link no longer works.')).toBeVisible();
  await expect(field).not.toHaveValue(oldUrl);
  const newUrl = await field.inputValue();
  expect(newUrl).toBe((await apiLink(page, board.id)).url);
  expect(newUrl.startsWith(`${baseURL}/b/`)).toBe(true);

  const guest = await freshPage(browser, profile({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    await guest.page.goto(oldUrl);
    await expect(guest.page.getByText('This link is not available.')).toBeVisible();
    await guest.page.goto(newUrl);
    await guest.page.getByLabel('Your name').fill('After reset');
    await press(guest.page, 'Join board', isMobile);
    await expect(guest.page.getByText('You joined as After reset.')).toBeVisible();
  } finally {
    await guest.close();
  }
});

test('SHR-06 participant joined by the old link loses access after reset', async ({
  linkParticipantPage: page,
  boardUserPage,
  board,
}) => {
  await expect(page.getByText('You joined as QA Guest.')).toBeVisible();
  const oldUrl = page.url();
  expect((await boardUserPage.request.post(`/api/boards/${board.id}/share/reset`)).status()).toBe(200);
  await page.reload();
  await expect(page.getByText('This link is not available.')).toBeVisible();
  const { url } = await apiLink(boardUserPage, board.id);
  expect(url).not.toBe(oldUrl);
  await page.goto(url);
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByText(/You joined as/)).toHaveCount(0);
});

// ---------- ARCH-T31 ----------

test('ARCH-T31-04 share dialog and link page use only the page origin, English UI, no console errors, no horizontal scroll', async ({
  boardUserPage,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on('request', (r) => {
      const u = new URL(r.url());
      if (u.protocol.startsWith('http') && u.origin !== origin) foreign.push(r.url());
      if (u.protocol.startsWith('ws') && u.host !== new URL(origin).host) foreign.push(r.url());
    });
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  };
  watch(boardUserPage);
  await openShare(boardUserPage, board.id, isMobile);
  expect(await boardUserPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const { url } = await apiLink(boardUserPage, board.id);

  const guest = await freshPage(browser, profile({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    watch(guest.page);
    await guest.page.goto(url);
    await expect(guest.page.getByLabel('Your name')).toBeVisible();
    expect(await guest.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await guest.page.getByLabel('Your name').fill('Origin check');
    await press(guest.page, 'Join board', isMobile);
    await expect(guest.page.getByText('You joined as Origin check.')).toBeVisible();
    expect(await guest.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const text = await guest.page.locator('body').innerText();
    expect(text).not.toMatch(/[А-Яа-яЁё]/);
  } finally {
    await guest.close();
  }
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});
