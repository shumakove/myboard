// Приёмка T2.1 · список досок в браузере (ACC-04, BRD-01…06, изоляция, перенос ADM-05, ARCH-T21-01).
// Сценарии — docs/qa/reports/T2.1.md; подписи интерфейса — из handoff T2.1.
// Данные готовятся через публичный API (`/api/boards`) в контексте вкладки пользователя.
import { execFileSync } from 'node:child_process';
import type { APIRequestContext, Browser, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import type { CreatedUser } from './admin';
import { adminPatchUser, apiUserLogin, createBoardUser } from './user';

interface Board {
  id: string;
  title: string;
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function tag(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function apiCreateBoard(request: APIRequestContext, title: string): Promise<Board> {
  const res = await request.post('/api/boards', { data: { title } });
  if (res.status() !== 201) throw new Error(`создание доски: ${res.status()} ${await res.text()}`);
  return (await res.json()) as Board;
}

/** Контейнер базы проверяемого стека: проект Compose из QA_COMPOSE_PROJECT (по умолчанию myboard-qa). */
const PG_CONTAINER = `${process.env.QA_COMPOSE_PROJECT || 'myboard-qa'}-postgres-1`;

/** Подготовка данных (способ из handoff T2.1): сдвинуть дату изменения доски в прошлое. */
function ageBoard(id: string, days: number): void {
  if (!UUID.test(id)) throw new Error(`не uuid: ${id}`);
  const sql = `UPDATE boards SET updated_at = now() - interval '${days} days' WHERE id = '${id}'`;
  execFileSync('docker', ['exec', PG_CONTAINER, 'psql', '-U', 'myboard', '-d', 'myboard', '-c', sql]);
}

async function signIn(page: Page, user: CreatedUser) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Пользователь с досками, созданными через API в отдельном контексте. */
async function userWithBoards(browser: Browser, baseURL: string | undefined, titles: string[]) {
  const user = await createBoardUser(browser, baseURL);
  const ctx = await browser.newContext({ baseURL });
  try {
    await apiUserLogin(ctx.request, user);
    const boards: Board[] = [];
    for (const title of titles) boards.push(await apiCreateBoard(ctx.request, title));
    return { user, boards };
  } finally {
    await ctx.close();
  }
}

const allList = (page: Page) => page.getByRole('list', { name: 'All boards' });
const recentList = (page: Page) => page.getByRole('list', { name: 'Recent boards' });
const rows = (list: Locator) => list.getByRole('listitem');
const titleLinks = (page: Page) => allList(page).getByRole('listitem').getByRole('link');

async function allTitles(page: Page): Promise<string[]> {
  return (await titleLinks(page).allInnerTexts()).map((t) => t.trim());
}

function failOnNativeDialogs(page: Page) {
  page.on('dialog', async (d) => {
    await d.dismiss();
    throw new Error(`нативный диалог браузера: ${d.type()} ${d.message()}`);
  });
}

// ---------- ACC-04 ----------

test('ACC-04 after signing in / shows exactly this user’s boards, not another user’s', async ({
  page,
  browser,
  baseURL,
}) => {
  const t = tag();
  const a = await userWithBoards(browser, baseURL, [`A first ${t}`, `A second ${t}`]);
  const b = await userWithBoards(browser, baseURL, [`B secret ${t}`]);
  await signIn(page, a.user);
  await expect(page.getByRole('heading', { name: 'All boards' })).toBeVisible();
  await expect(rows(allList(page))).toHaveCount(2);
  expect((await allTitles(page)).sort()).toEqual([`A first ${t}`, `A second ${t}`]);
  await expect(page.getByText(b.boards[0].title)).toHaveCount(0);
});

test('ACC-04 a new user sees an empty list with an invitation to create a board', async ({ boardUserPage: page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'New board' })).toBeVisible();
  await expect(page.getByText(/no boards/i)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('listitem')).toHaveCount(0);
});

// ---------- BRD-01 ----------

test('BRD-01 New board creates a board and opens it at once; it is then in the list', async ({
  boardUserPage: page,
}) => {
  failOnNativeDialogs(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(new RegExp(`/boards/${UUID.source}$`));
  const id = page.url().split('/boards/')[1];
  const res = await page.request.get(`/api/boards/${id}`);
  expect(res.status()).toBe(200);
  const title = ((await res.json()) as Board).title;
  expect(title.trim().length).toBeGreaterThan(0);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  await page.goto('/');
  await expect(allList(page).locator(`a[href="/boards/${id}"]`)).toHaveText(title);
  await expect(recentList(page).locator(`a[href="/boards/${id}"]`)).toContainText(title);
});

test('BRD-01 opening a board from the list goes to /boards/{id} with its title', async ({ boardUserPage: page }) => {
  const board = await apiCreateBoard(page.request, `Open me ${tag()}`);
  await page.goto('/');
  await allList(page).getByRole('link', { name: board.title }).click();
  await expect(page).toHaveURL(new RegExp(`/boards/${board.id}$`));
  await expect(page.getByRole('heading', { name: board.title })).toBeVisible();
});

test('BRD-01 a board title with markup is shown as plain text', async ({ boardUserPage: page }) => {
  let alerted = false;
  page.on('dialog', async (d) => {
    alerted = true;
    await d.dismiss();
  });
  const title = `<img src=x onerror="alert(1)"> ${tag()}`;
  await apiCreateBoard(page.request, title);
  await page.goto('/');
  await expect(allList(page).getByRole('link', { name: title })).toBeVisible();
  await expect(page.locator('main img')).toHaveCount(0);
  expect(alerted).toBe(false);
});

// ---------- BRD-02 ----------

test('BRD-02 renaming in the list updates All boards and Recent and survives reload', async ({
  boardUserPage: page,
}) => {
  failOnNativeDialogs(page);
  const board = await apiCreateBoard(page.request, `Before ${tag()}`);
  const newTitle = `After ${tag()}`;
  await page.goto('/');
  const row = rows(allList(page)).filter({ hasText: board.title });
  await row.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill(newTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(allList(page).getByRole('link', { name: newTitle })).toBeVisible();
  await expect(recentList(page).getByRole('link', { name: new RegExp(newTitle) })).toBeVisible();
  await expect(page.getByText(board.title)).toHaveCount(0);
  await page.reload();
  await expect(allList(page).getByRole('link', { name: newTitle })).toBeVisible();
  await page.goto(`/boards/${board.id}`);
  await expect(page.getByRole('heading', { name: newTitle })).toBeVisible();
});

test('BRD-02 Cancel keeps the old title; an empty title is not saved', async ({ boardUserPage: page }) => {
  const board = await apiCreateBoard(page.request, `Stable ${tag()}`);
  await page.goto('/');
  const row = rows(allList(page)).filter({ hasText: board.title });
  await row.getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill('Discarded');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(allList(page).getByRole('link', { name: board.title })).toBeVisible();

  await rows(allList(page)).filter({ hasText: board.title }).getByRole('button', { name: 'Rename' }).click();
  await page.getByRole('textbox', { name: 'Board name' }).fill('   ');
  await page.getByRole('button', { name: 'Save' }).click().catch(() => undefined);
  await page.reload();
  await expect(allList(page).getByRole('link', { name: board.title })).toBeVisible();
});

// ---------- BRD-03 ----------

test('BRD-03 Delete asks in the page, removes the board from both lists and it no longer opens', async ({
  boardUserPage: page,
}) => {
  failOnNativeDialogs(page);
  const t = tag();
  const keep = await apiCreateBoard(page.request, `Keep ${t}`);
  const gone = await apiCreateBoard(page.request, `Gone ${t}`);
  await page.goto('/');
  const row = rows(allList(page)).filter({ hasText: gone.title });
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page.getByText(gone.title)).toHaveCount(0);
  await expect(allList(page).getByRole('link', { name: keep.title })).toBeVisible();
  await page.reload();
  await expect(page.getByText(gone.title)).toHaveCount(0);
  await page.goto(`/boards/${gone.id}`);
  await expect(page.getByText('Board not found.')).toBeVisible();
  await expect(page.getByText(gone.title)).toHaveCount(0);
});

test('BRD-03 Cancel in the delete confirmation keeps the board', async ({ boardUserPage: page }) => {
  failOnNativeDialogs(page);
  const board = await apiCreateBoard(page.request, `Survivor ${tag()}`);
  await page.goto('/');
  const row = rows(allList(page)).filter({ hasText: board.title });
  await row.getByRole('button', { name: 'Delete' }).click();
  await row.getByRole('button', { name: 'Cancel' }).click();
  await page.reload();
  await expect(allList(page).getByRole('link', { name: board.title })).toBeVisible();
});

// ---------- BRD-04 ----------

test('BRD-04 Recent shows the latest changed boards first; All boards lists every board', async ({
  boardUserPage: page,
}) => {
  const t = tag();
  const created: Board[] = [];
  for (let i = 0; i < 11; i++) created.push(await apiCreateBoard(page.request, `N${String(i).padStart(2, '0')} ${t}`));
  ageBoard(created[10].id, 2); // самая новая по созданию — изменена давно
  await page.goto('/');
  await expect(rows(allList(page))).toHaveCount(11);
  const recent = await rows(recentList(page)).getByRole('link').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')),
  );
  expect(recent.length).toBeGreaterThan(0);
  expect(recent.length).toBeLessThan(11);
  const expected = created
    .slice(0, 10)
    .reverse()
    .map((b) => `/boards/${b.id}`)
    .slice(0, recent.length);
  expect(recent).toEqual(expected);
});

// ---------- BRD-05 ----------

test('BRD-05 Sort by Name, Date created and Last modified orders All boards', async ({ boardUserPage: page }) => {
  const t = tag();
  const banana = await apiCreateBoard(page.request, `banana ${t}`);
  const apple = await apiCreateBoard(page.request, `Apple ${t}`);
  const cherry = await apiCreateBoard(page.request, `cherry ${t}`);
  ageBoard(cherry.id, 5);
  await page.goto('/');
  const sort = page.getByRole('combobox', { name: 'Sort by' });

  await sort.selectOption({ label: 'Name' });
  await expect.poll(() => allTitles(page)).toEqual([apple.title, banana.title, cherry.title]);

  await sort.selectOption({ label: 'Date created' });
  await expect.poll(() => allTitles(page)).toEqual([cherry.title, apple.title, banana.title]);

  await sort.selectOption({ label: 'Last modified' });
  await expect.poll(() => allTitles(page)).toEqual([apple.title, banana.title, cherry.title]);
});

test('BRD-05 Modified filter hides boards changed earlier than the chosen period', async ({ boardUserPage: page }) => {
  const t = tag();
  const fresh = await apiCreateBoard(page.request, `fresh ${t}`);
  const days3 = await apiCreateBoard(page.request, `three days ${t}`);
  const days20 = await apiCreateBoard(page.request, `twenty days ${t}`);
  const days60 = await apiCreateBoard(page.request, `sixty days ${t}`);
  ageBoard(days3.id, 3);
  ageBoard(days20.id, 20);
  ageBoard(days60.id, 60);
  await page.goto('/');
  const filter = page.getByRole('combobox', { name: 'Modified' });
  const sorted = async () => (await allTitles(page)).sort();

  await filter.selectOption({ label: 'Last 24 hours' });
  await expect.poll(sorted).toEqual([fresh.title]);
  await filter.selectOption({ label: 'Last 7 days' });
  await expect.poll(sorted).toEqual([fresh.title, days3.title].sort());
  await filter.selectOption({ label: 'Last 30 days' });
  await expect.poll(sorted).toEqual([fresh.title, days3.title, days20.title].sort());
  await filter.selectOption({ label: 'Any time' });
  await expect.poll(sorted).toEqual([fresh.title, days3.title, days20.title, days60.title].sort());
});

// ---------- BRD-06 ----------

test('BRD-06 search by part of a title filters the list on the server', async ({ boardUserPage: page }) => {
  const t = tag();
  const retro = await apiCreateBoard(page.request, `Sprint Retro ${t}`);
  await apiCreateBoard(page.request, `Roadmap ${t}`);
  await page.goto('/');
  const queries: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (url.pathname === '/api/boards' && url.searchParams.get('q')) queries.push(url.searchParams.get('q')!);
  });
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('rint RET');
  await expect.poll(() => allTitles(page)).toEqual([retro.title]);
  expect(queries.some((q) => q.includes('rint RET'))).toBe(true);

  await page.getByRole('searchbox', { name: 'Search boards' }).fill(`nothing-${t}`);
  await expect(page.getByText(/no boards match/i)).toBeVisible();
  await expect(rows(allList(page))).toHaveCount(0);

  await page.getByRole('searchbox', { name: 'Search boards' }).fill('');
  await expect(rows(allList(page))).toHaveCount(2);
});

test('BRD-06 search does not reveal another user’s boards', async ({ boardUserPage: page, browser, baseURL }) => {
  const t = tag();
  const other = await userWithBoards(browser, baseURL, [`Confidential ${t}`]);
  await apiCreateBoard(page.request, `Mine ${t}`);
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('Confidential');
  await expect(page.getByText(/no boards match/i)).toBeVisible();
  await expect(page.getByText(other.boards[0].title)).toHaveCount(0);
});

// ---------- Изоляция ----------

test('BRD-01 isolation: user B opening /boards/{id of A} sees Board not found, anonymous goes to /login', async ({
  page,
  browser,
  baseURL,
}) => {
  const a = await userWithBoards(browser, baseURL, [`Private of A ${tag()}`]);
  const b = await createBoardUser(browser, baseURL);
  await apiUserLogin(page.request, b);
  await page.goto(`/boards/${a.boards[0].id}`);
  await expect(page.getByText('Board not found.')).toBeVisible();
  await expect(page.getByText(a.boards[0].title)).toHaveCount(0);

  const anon = await browser.newContext({ baseURL });
  try {
    const anonPage = await anon.newPage();
    await anonPage.goto(`/boards/${a.boards[0].id}`);
    await expect(anonPage).toHaveURL(/\/login$/);
    await expect(anonPage.getByText(a.boards[0].title)).toHaveCount(0);
  } finally {
    await anon.close();
  }
});

// ---------- ADM-05 ----------

test('ADM-05 a disabled user cannot sign in, and after re-enabling the same boards are there', async ({
  page,
  browser,
  baseURL,
}) => {
  const t = tag();
  const a = await userWithBoards(browser, baseURL, [`Kept one ${t}`, `Kept two ${t}`]);
  await adminPatchUser(browser, baseURL, a.user.id, { disabled: true });
  await page.goto('/login');
  await page.getByLabel('Email').fill(a.user.email);
  await page.getByLabel('Password').fill(a.user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await adminPatchUser(browser, baseURL, a.user.id, { disabled: false });
  await signIn(page, a.user);
  await expect(rows(allList(page))).toHaveCount(2);
  expect((await allTitles(page)).sort()).toEqual([`Kept one ${t}`, `Kept two ${t}`]);
});

// ---------- ARCH-T21-01 ----------

test('ARCH-T21-01 list and board pages talk only to the page origin, never localhost', async ({
  boardUserPage: page,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== origin) foreign.push(r.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'New board' }).click();
  await expect(page).toHaveURL(new RegExp(`/boards/${UUID.source}$`));
  await page.goto('/');
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('x');
  await page.getByRole('combobox', { name: 'Sort by' }).selectOption({ label: 'Name' });
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
});

test('ARCH-T21-01 no horizontal scroll on the list page', async ({ boardUserPage: page }) => {
  await apiCreateBoard(page.request, `A rather long board title to check wrapping on a narrow phone ${tag()}`);
  await page.goto('/');
  await expect(rows(allList(page))).toHaveCount(1);
  const [scroll, client] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  expect(scroll).toBeLessThanOrEqual(client);
});
