// Приёмка T2.2 · папки и избранное в браузере (BRD-06 папки, BRD-07, BRD-09, BRD-10, BRD-11, ARCH-T22-01).
// Сценарии — docs/qa/reports/T2.2.md; подписи интерфейса — из handoff T2.2.
// Перетаскивание: в профиле desktop — мышью, в профиле mobile — касанием пальца
// (CDP Input.dispatchTouchEvent: браузер сам порождает pointer/touch-события с pointerType 'touch').
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';

interface Folder {
  id: string;
  parent_id: string | null;
  title: string;
  position: number;
  favorite: boolean;
}
interface Board {
  id: string;
  title: string;
  folder_id: string | null;
  favorite: boolean;
}

function tag(): string {
  return Math.random().toString(36).slice(2, 8);
}

async function apiFolder(request: APIRequestContext, title: string, parentId?: string): Promise<Folder> {
  const res = await request.post('/api/folders', { data: parentId ? { title, parent_id: parentId } : { title } });
  if (res.status() !== 201) throw new Error(`создание папки: ${res.status()} ${await res.text()}`);
  return (await res.json()) as Folder;
}

async function apiBoard(request: APIRequestContext, title: string): Promise<Board> {
  const res = await request.post('/api/boards', { data: { title } });
  if (res.status() !== 201) throw new Error(`создание доски: ${res.status()} ${await res.text()}`);
  return (await res.json()) as Board;
}

async function apiFolders(request: APIRequestContext): Promise<Folder[]> {
  const res = await request.get('/api/folders');
  expect(res.status()).toBe(200);
  return (await res.json()) as Folder[];
}

async function apiBoardById(request: APIRequestContext, id: string): Promise<Board> {
  const res = await request.get(`/api/boards/${id}`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Board;
}

async function rootOrder(request: APIRequestContext, parentId: string | null = null): Promise<string[]> {
  return (await apiFolders(request))
    .filter((f) => f.parent_id === parentId)
    .sort((a, b) => a.position - b.position)
    .map((f) => f.title);
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Folders and favorites' });
const folderTree = (page: Page) => sidebar(page).getByRole('list', { name: 'Folders', exact: true });
const favorites = (page: Page) => sidebar(page).getByRole('list', { name: 'Favorites', exact: true });
const contentsOf = (page: Page, title: string) => sidebar(page).getByRole('list', { name: `Contents of ${title}` });
const folderItem = (page: Page, title: string) => folderTree(page).getByRole('listitem', { name: title, exact: true });
const folderRow = (page: Page, title: string) => folderItem(page, title).locator(':scope > div').first();
const folderToggle = (page: Page, title: string) =>
  folderRow(page, title).getByRole('button', { name: title, exact: true }).and(page.locator('[aria-expanded]'));
const allBoards = (page: Page) => page.getByRole('list', { name: 'All boards' });

/** Названия папок верхнего уровня дерева в порядке показа. */
async function treeTopTitles(page: Page): Promise<string[]> {
  return folderTree(page)
    .locator('> li')
    .evaluateAll((items) => items.map((li) => li.getAttribute('aria-label') ?? ''));
}

async function expand(page: Page, title: string) {
  const toggle = folderToggle(page, title);
  await expect(toggle).toBeVisible();
  await expect(async () => {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', { timeout: 1000 });
  }).toPass();
}

function failOnNativeDialogs(page: Page, seen: string[]) {
  page.on('dialog', async (d) => {
    seen.push(`${d.type()}: ${d.message()}`);
    await d.dismiss();
  });
}

type Point = { x: number; y: number };

async function centerOf(loc: Locator): Promise<Point> {
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error('элемент не виден');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Точка на строке-цели: доля высоты строки сверху (0.1 — «перед», 0.5 — «внутрь», 0.9 — «после»). */
async function pointIn(loc: Locator, fraction: number): Promise<Point> {
  const box = await loc.boundingBox();
  if (!box) throw new Error('цель не видна');
  return { x: box.x + box.width / 2, y: box.y + box.height * fraction };
}

/**
 * Перетаскивание ручки `Drag <title>` на точку цели: мышью (desktop) или пальцем (mobile).
 * Цель вычисляется после начала жеста — список может сдвинуться.
 */
async function dragTo(page: Page, handle: Locator, target: () => Promise<Point>, touch: boolean) {
  const from = await centerOf(handle);
  if (!touch) {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y + 8, { steps: 4 });
    const to = await target();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.move(to.x, to.y + 1, { steps: 2 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const touchAt = (type: string, p?: Point) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }] : [],
    } as never);
  await touchAt('touchStart', from);
  for (let i = 1; i <= 4; i++) await touchAt('touchMove', { x: from.x + 2 * i, y: from.y + 2 * i });
  const to = await target();
  const start = { x: from.x + 8, y: from.y + 8 };
  const steps = 15;
  for (let i = 1; i <= steps; i++) {
    await touchAt('touchMove', { x: start.x + ((to.x - start.x) * i) / steps, y: start.y + ((to.y - start.y) * i) / steps });
  }
  await touchAt('touchMove', { x: to.x, y: to.y + 1 });
  await touchAt('touchEnd');
  await cdp.detach();
}

async function openList(page: Page) {
  await page.goto('/');
  await expect(sidebar(page)).toBeVisible();
}

// ---------- BRD-09 ----------

test('BRD-09 folder in a folder in a folder created from the sidebar survives reload', async ({ boardUserPage: page }) => {
  const t = tag();
  await openList(page);
  await expect(sidebar(page).getByText('No folders yet.')).toBeVisible();

  await sidebar(page).getByRole('button', { name: 'New folder', exact: true }).click();
  await sidebar(page).getByLabel('Folder name').fill(`Top ${t}`);
  await sidebar(page).getByRole('button', { name: 'Create' }).click();
  await expect(folderToggle(page, `Top ${t}`)).toBeVisible();

  await sidebar(page).getByRole('button', { name: `New folder in Top ${t}`, exact: true }).click();
  await sidebar(page).getByLabel('Folder name').fill(`Mid ${t}`);
  await sidebar(page).getByRole('button', { name: 'Create' }).click();
  await expand(page, `Top ${t}`);
  await expect(contentsOf(page, `Top ${t}`).getByRole('button', { name: `Mid ${t}`, exact: true })).toBeVisible();

  await sidebar(page).getByRole('button', { name: `New folder in Mid ${t}`, exact: true }).click();
  await sidebar(page).getByLabel('Folder name').fill(`Low ${t}`);
  await sidebar(page).getByRole('button', { name: 'Create' }).click();
  await expand(page, `Mid ${t}`);
  await expect(contentsOf(page, `Mid ${t}`).getByRole('button', { name: `Low ${t}`, exact: true })).toBeVisible();

  const byTitle = Object.fromEntries((await apiFolders(page.request)).map((f) => [f.title, f]));
  expect(byTitle[`Top ${t}`].parent_id).toBeNull();
  expect(byTitle[`Mid ${t}`].parent_id).toBe(byTitle[`Top ${t}`].id);
  expect(byTitle[`Low ${t}`].parent_id).toBe(byTitle[`Mid ${t}`].id);

  await page.reload();
  await expand(page, `Top ${t}`);
  await expand(page, `Mid ${t}`);
  await expect(contentsOf(page, `Mid ${t}`).getByRole('button', { name: `Low ${t}`, exact: true })).toBeVisible();
  await expect.poll(() => treeTopTitles(page)).toEqual([`Top ${t}`]);
});

test('BRD-09 folder title with markup is shown as plain text; empty name is not created', async ({ boardUserPage: page }) => {
  const title = `<b>bold</b> & Проект ${tag()}`;
  await openList(page);
  await sidebar(page).getByRole('button', { name: 'New folder', exact: true }).click();
  await sidebar(page).getByRole('button', { name: 'Create' }).click();
  expect(await apiFolders(page.request)).toEqual([]);
  await sidebar(page).getByLabel('Folder name').fill(title);
  await sidebar(page).getByRole('button', { name: 'Create' }).click();
  await expect(folderToggle(page, title)).toContainText(title);
  await expect(sidebar(page).locator('b', { hasText: 'bold' })).toHaveCount(0);
});

// ---------- BRD-11 ----------

test('BRD-11 folders collapse and expand in the sidebar, each level independently', async ({ boardUserPage: page }) => {
  const t = tag();
  const top = await apiFolder(page.request, `Top ${t}`);
  const mid = await apiFolder(page.request, `Mid ${t}`, top.id);
  await apiFolder(page.request, `Low ${t}`, mid.id);
  const board = await apiBoard(page.request, `In mid ${t}`);
  await page.request.put(`/api/boards/${board.id}/folder`, { data: { folder_id: mid.id } });
  const empty = `Empty ${t}`;
  await apiFolder(page.request, empty);

  await openList(page);
  await expand(page, `Top ${t}`);
  await expand(page, `Mid ${t}`);
  const midContents = contentsOf(page, `Mid ${t}`);
  await expect(midContents.getByRole('button', { name: `Low ${t}`, exact: true })).toBeVisible();
  await expect(midContents.getByRole('link', { name: board.title })).toBeVisible();

  // Свернуть вложенную — родитель остаётся развёрнутым.
  await folderToggle(page, `Mid ${t}`).click();
  await expect(folderToggle(page, `Mid ${t}`)).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar(page).getByRole('link', { name: board.title })).toHaveCount(0);
  await expect(sidebar(page).getByRole('button', { name: `Low ${t}`, exact: true })).toHaveCount(0);
  await expect(folderToggle(page, `Mid ${t}`)).toBeVisible();

  // Свернуть верхнюю — скрыто всё поддерево.
  await folderToggle(page, `Top ${t}`).click();
  await expect(folderToggle(page, `Top ${t}`)).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar(page).getByRole('button', { name: `Mid ${t}`, exact: true })).toHaveCount(0);

  // Развернуть снова — вложенная помнит, что свёрнута.
  await folderToggle(page, `Top ${t}`).click();
  await expect(folderToggle(page, `Mid ${t}`)).toHaveAttribute('aria-expanded', 'false');
  await folderToggle(page, `Mid ${t}`).click();
  await expect(midContents.getByRole('link', { name: board.title })).toBeVisible();

  // Пустая папка: разворачивание не ломает список.
  await expand(page, empty);
  await expect(folderItem(page, empty).getByText('Empty folder')).toBeVisible();
  await folderToggle(page, empty).click();
  await expect(folderItem(page, empty).getByText('Empty folder')).toHaveCount(0);
});

// ---------- BRD-07 ----------

test('BRD-07 a board and a folder are added to Favorites and removed; state survives reload', async ({ boardUserPage: page }) => {
  const t = tag();
  const board = await apiBoard(page.request, `Fav board ${t}`);
  await apiBoard(page.request, `Plain board ${t}`);
  const folder = await apiFolder(page.request, `Fav folder ${t}`);
  await openList(page);
  await expect(favorites(page)).toHaveCount(0);

  const boardRow = allBoards(page).getByRole('listitem').filter({ hasText: board.title });
  await boardRow.getByRole('button', { name: 'Favorite' }).click();
  await expect(boardRow.getByRole('button', { name: 'Favorite' })).toHaveAttribute('aria-pressed', 'true');
  await folderRow(page, folder.title).getByRole('button', { name: 'Favorite' }).click();

  await expect(favorites(page).getByRole('link', { name: board.title })).toBeVisible();
  await expect(favorites(page).getByRole('button', { name: folder.title, exact: true })).toBeVisible();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(2);

  await page.reload();
  await expect(favorites(page).getByRole('listitem')).toHaveCount(2);
  await expect(
    allBoards(page).getByRole('listitem').filter({ hasText: board.title }).getByRole('button', { name: 'Favorite' }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Убрать из избранного — из раздела Favorites.
  await favorites(page).getByRole('listitem', { name: board.title }).getByRole('button', { name: 'Favorite' }).click();
  await expect(favorites(page).getByRole('link', { name: board.title })).toHaveCount(0);
  await favorites(page).getByRole('listitem', { name: folder.title }).getByRole('button', { name: 'Favorite' }).click();
  await expect(favorites(page)).toHaveCount(0);

  await page.reload();
  await expect(favorites(page)).toHaveCount(0);
  // Сами доска и папка на месте.
  await expect(allBoards(page).getByRole('link', { name: board.title })).toBeVisible();
  await expect(folderToggle(page, folder.title)).toBeVisible();
  expect((await apiBoardById(page.request, board.id)).favorite).toBe(false);
});

test('BRD-07 a favorite folder in Favorites reveals the folder in the tree', async ({ boardUserPage: page }) => {
  const t = tag();
  const top = await apiFolder(page.request, `Outer ${t}`);
  const deep = await apiFolder(page.request, `Deep fav ${t}`, top.id);
  await page.request.put(`/api/folders/${deep.id}/favorite`);
  await openList(page);
  await expect(folderToggle(page, `Outer ${t}`)).toHaveAttribute('aria-expanded', 'false');
  await favorites(page).getByRole('button', { name: deep.title, exact: true }).click();
  await expect(contentsOf(page, `Outer ${t}`).getByRole('button', { name: deep.title, exact: true })).toBeVisible();
});

// ---------- BRD-10: перетаскивание ----------

test('BRD-10 dragging changes folder order; order survives reload and shows in another session', async ({
  boardUserPage: page,
  hasTouch,
  browser,
  baseURL,
  viewport,
  isMobile,
  userAgent,
}) => {
  const t = tag();
  for (const n of ['A', 'B', 'C']) await apiFolder(page.request, `${n} ${t}`);
  await openList(page);
  await expect.poll(() => treeTopTitles(page)).toEqual([`A ${t}`, `B ${t}`, `C ${t}`]);

  // C — перед A (верхняя часть строки A).
  await dragTo(page, folderRow(page, `C ${t}`).getByRole('button', { name: `Drag C ${t}`, exact: true }), () =>
    pointIn(folderRow(page, `A ${t}`), 0.1), hasTouch);
  await expect.poll(() => treeTopTitles(page)).toEqual([`C ${t}`, `A ${t}`, `B ${t}`]);
  await expect.poll(() => rootOrder(page.request)).toEqual([`C ${t}`, `A ${t}`, `B ${t}`]);

  // A — после B (нижняя часть строки B).
  await dragTo(page, folderRow(page, `A ${t}`).getByRole('button', { name: `Drag A ${t}`, exact: true }), () =>
    pointIn(folderRow(page, `B ${t}`), 0.9), hasTouch);
  await expect.poll(() => rootOrder(page.request)).toEqual([`C ${t}`, `B ${t}`, `A ${t}`]);

  await page.reload();
  await expect.poll(() => treeTopTitles(page)).toEqual([`C ${t}`, `B ${t}`, `A ${t}`]);

  // Вторая сессия того же пользователя (свой контекст) видит тот же порядок.
  const state = await page.context().storageState();
  const other = await browser.newContext({ baseURL, viewport, hasTouch, isMobile, userAgent, storageState: state });
  try {
    const p2 = await other.newPage();
    await openList(p2);
    await expect.poll(() => treeTopTitles(p2)).toEqual([`C ${t}`, `B ${t}`, `A ${t}`]);
  } finally {
    await other.close();
  }
});

test('BRD-10 dragging a folder onto another nests it with its subtree; dropping on Folders brings it back to top level', async ({
  boardUserPage: page,
  hasTouch,
}) => {
  const t = tag();
  const home = await apiFolder(page.request, `Home ${t}`);
  const work = await apiFolder(page.request, `Work ${t}`);
  const inner = await apiFolder(page.request, `Inner ${t}`, work.id);
  await openList(page);

  await dragTo(page, folderRow(page, work.title).getByRole('button', { name: `Drag ${work.title}`, exact: true }), () =>
    pointIn(folderRow(page, home.title), 0.5), hasTouch);
  await expect.poll(async () => (await apiFolders(page.request)).find((f) => f.id === work.id)?.parent_id).toBe(home.id);
  expect((await apiFolders(page.request)).find((f) => f.id === inner.id)?.parent_id).toBe(work.id);

  await page.reload();
  await expect.poll(() => treeTopTitles(page)).toEqual([home.title]);
  await expand(page, home.title);
  await expect(contentsOf(page, home.title).getByRole('button', { name: work.title, exact: true })).toBeVisible();

  // Обратно на верхний уровень — на свободное место раздела Folders (заголовок раздела).
  await dragTo(page, folderRow(page, work.title).getByRole('button', { name: `Drag ${work.title}`, exact: true }), () =>
    centerOf(sidebar(page).getByRole('heading', { name: 'Folders', exact: true })), hasTouch);
  await expect.poll(async () => (await apiFolders(page.request)).find((f) => f.id === work.id)?.parent_id).toBeNull();
  expect((await apiFolders(page.request)).find((f) => f.id === inner.id)?.parent_id).toBe(work.id);
});

test('BRD-10 dragging moves a board into a folder, between folders and back out; survives reload', async ({
  boardUserPage: page,
  hasTouch,
}) => {
  const t = tag();
  const f1 = await apiFolder(page.request, `First ${t}`);
  const f2 = await apiFolder(page.request, `Second ${t}`);
  const board = await apiBoard(page.request, `Mover ${t}`);
  await openList(page);

  // Из полного списка All boards — в первую папку.
  const listHandle = allBoards(page).getByRole('button', { name: `Drag ${board.title}`, exact: true });
  await dragTo(page, listHandle, () => pointIn(folderRow(page, f1.title), 0.5), hasTouch);
  await expect.poll(async () => (await apiBoardById(page.request, board.id)).folder_id).toBe(f1.id);
  // Доска остаётся в полном списке.
  await expect(allBoards(page).getByRole('link', { name: board.title })).toBeVisible();

  await page.reload();
  await expand(page, f1.title);
  await expect(contentsOf(page, f1.title).getByRole('link', { name: board.title })).toBeVisible();

  // Из дерева — во вторую папку.
  await dragTo(page, contentsOf(page, f1.title).getByRole('button', { name: `Drag ${board.title}`, exact: true }), () =>
    pointIn(folderRow(page, f2.title), 0.5), hasTouch);
  await expect.poll(async () => (await apiBoardById(page.request, board.id)).folder_id).toBe(f2.id);
  await expand(page, f2.title);
  await expect(contentsOf(page, f2.title).getByRole('link', { name: board.title })).toBeVisible();
  await expect(sidebar(page).getByRole('link', { name: board.title })).toHaveCount(1);

  // Из папки — на верхний уровень.
  await dragTo(page, contentsOf(page, f2.title).getByRole('button', { name: `Drag ${board.title}`, exact: true }), () =>
    centerOf(sidebar(page).getByRole('heading', { name: 'Folders', exact: true })), hasTouch);
  await expect.poll(async () => (await apiBoardById(page.request, board.id)).folder_id).toBeNull();
  await page.reload();
  await expect(sidebar(page).getByRole('link', { name: board.title })).toHaveCount(0);
  await expect(allBoards(page).getByRole('link', { name: board.title })).toBeVisible();
});

test('BRD-10 a folder cannot be dragged into its own subfolder: tree unchanged, message shown', async ({
  boardUserPage: page,
  hasTouch,
}) => {
  const t = tag();
  const parent = await apiFolder(page.request, `Parent ${t}`);
  const child = await apiFolder(page.request, `Child ${t}`, parent.id);
  const dialogs: string[] = [];
  failOnNativeDialogs(page, dialogs);
  await openList(page);
  await expand(page, parent.title);
  const before = await apiFolders(page.request);

  await dragTo(page, folderRow(page, parent.title).getByRole('button', { name: `Drag ${parent.title}`, exact: true }), () =>
    pointIn(folderRow(page, child.title), 0.5), hasTouch);

  const shown = page.getByText('A folder cannot be moved into itself or its subfolder');
  await expect.poll(async () => dialogs.length + (await shown.count())).toBeGreaterThan(0);
  expect(await apiFolders(page.request)).toEqual(before);
  await page.reload();
  await expect.poll(() => treeTopTitles(page)).toEqual([parent.title]);
});

test('BRD-10 a tap on a drag handle or a swipe over a row does not move anything', async ({ boardUserPage: page, hasTouch }) => {
  const t = tag();
  for (const n of ['A', 'B']) await apiFolder(page.request, `${n} ${t}`);
  const board = await apiBoard(page.request, `Still ${t}`);
  // Много досок, чтобы страница прокручивалась.
  for (let i = 0; i < 12; i++) await apiBoard(page.request, `Filler ${i} ${t}`);
  await openList(page);
  const before = await apiFolders(page.request);

  const handle = folderRow(page, `B ${t}`).getByRole('button', { name: `Drag B ${t}`, exact: true });
  if (hasTouch) {
    const c = await centerOf(handle);
    await page.touchscreen.tap(c.x, c.y);
  } else {
    await handle.click();
  }
  // Движение по строке (не за ручку): на телефоне — прокрутка, не перетаскивание.
  const row = allBoards(page).getByRole('listitem').filter({ hasText: board.title });
  const link = row.getByRole('link', { name: board.title });
  const from = await centerOf(link);
  if (hasTouch) {
    const cdp = await page.context().newCDPSession(page);
    const send = (type: string, y?: number) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: y === undefined ? [] : [{ x: Math.round(from.x), y: Math.round(y), id: 1 }],
      } as never);
    await send('touchStart', from.y);
    for (let i = 1; i <= 10; i++) await send('touchMove', from.y - 25 * i);
    await send('touchEnd');
    await cdp.detach();
  }
  await page.waitForTimeout(500);
  expect(await apiFolders(page.request)).toEqual(before);
  expect((await apiBoardById(page.request, board.id)).folder_id).toBeNull();
  await expect(page).toHaveURL(/\/$/);
});

// ---------- BRD-06: поиск папок ----------

test('BRD-06 search finds a nested folder by part of its title and reveals it in the tree', async ({ boardUserPage: page }) => {
  const t = tag();
  const work = await apiFolder(page.request, `Work ${t}`);
  const projects = await apiFolder(page.request, `Projects ${t}`, work.id);
  const alpha = await apiFolder(page.request, `Alpha ${t} Ёлка`, projects.id);
  await apiFolder(page.request, `Beta ${t}`);
  await openList(page);

  const folderQueries: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname === '/api/folders' && u.searchParams.get('q')) folderQueries.push(u.searchParams.get('q')!);
  });
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('ёЛКа');
  const matches = page.getByRole('list', { name: 'Matching folders' });
  await expect(matches.getByRole('listitem')).toHaveCount(1);
  await expect(matches.getByRole('button', { name: alpha.title, exact: true })).toBeVisible();
  await expect(matches).toContainText(`${work.title} / ${projects.title} / ${alpha.title}`);
  expect(folderQueries).toContain('ёЛКа');

  await matches.getByRole('button', { name: alpha.title, exact: true }).click();
  await expect(contentsOf(page, projects.title).getByRole('button', { name: alpha.title, exact: true })).toBeVisible();

  await page.getByRole('searchbox', { name: 'Search boards' }).fill(`nothing-${t}`);
  await expect(page.getByRole('list', { name: 'Matching folders' })).toHaveCount(0);
});

test('BRD-06 folder search does not show another user’s folders', async ({ boardUserPage: page, browser, baseURL }) => {
  const t = tag();
  const { createBoardUser, apiUserLogin } = await import('./user');
  const other = await createBoardUser(browser, baseURL);
  const ctx = await browser.newContext({ baseURL });
  try {
    await apiUserLogin(ctx.request, other);
    await apiFolder(ctx.request, `Secret ${t}`);
  } finally {
    await ctx.close();
  }
  await openList(page);
  await page.getByRole('searchbox', { name: 'Search boards' }).fill(`Secret ${t}`);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('list', { name: 'Matching folders' })).toHaveCount(0);
  await expect(sidebar(page).getByText(`Secret ${t}`)).toHaveCount(0);
});

// ---------- ARCH-T22-01 ----------

test('ARCH-T22-01 folders and favorites on / use only the page origin, no console errors, no horizontal scroll', async ({
  boardUserPage: page,
  baseURL,
  hasTouch,
}) => {
  const t = tag();
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  const errors: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && new URL(r.url()).origin !== origin) foreign.push(r.url());
  });
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  const top = await apiFolder(page.request, `Long folder name to check wrapping on a phone ${t}`);
  const mid = await apiFolder(page.request, `Nested folder with a long name too ${t}`, top.id);
  await apiFolder(page.request, `Third level folder with long name ${t}`, mid.id);
  const board = await apiBoard(page.request, `Board ${t}`);
  await page.request.put(`/api/boards/${board.id}/favorite`);
  await page.request.put(`/api/folders/${mid.id}/favorite`);
  await openList(page);
  await expand(page, top.title);
  await expand(page, mid.title);
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('level');
  await expect(page.getByRole('list', { name: 'Matching folders' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search boards' }).fill('');
  await dragTo(page, allBoards(page).getByRole('button', { name: `Drag ${board.title}`, exact: true }), () =>
    pointIn(folderRow(page, top.title), 0.5), hasTouch);
  await expect.poll(async () => (await apiBoardById(page.request, board.id)).folder_id).toBe(top.id);
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(foreign).toEqual([]);
  expect(errors).toEqual([]);
});

// ---------- BRD-10: длинный список (телефон — дерево выше списка досок) ----------

/**
 * Жест, как у человека: взять ручку далеко внизу, увести палец/мышь к верхнему краю экрана,
 * держать, пока список прокручивается и цель не станет видна, затем отпустить на цели.
 */
async function dragFarUp(page: Page, handle: Locator, target: Locator, touch: boolean) {
  const from = await centerOf(handle);
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const move = async (type: 'start' | 'move' | 'end', p?: Point) => {
    if (cdp) {
      const t = { start: 'touchStart', move: 'touchMove', end: 'touchEnd' }[type];
      await cdp.send('Input.dispatchTouchEvent', {
        type: t,
        touchPoints: p ? [{ x: Math.round(p.x), y: Math.round(p.y), id: 1 }] : [],
      } as never);
    } else if (type === 'start') {
      await page.mouse.move(p!.x, p!.y);
      await page.mouse.down();
    } else if (type === 'move') {
      await page.mouse.move(p!.x, p!.y);
    } else {
      await page.mouse.up();
    }
  };
  await move('start', from);
  for (let i = 1; i <= 4; i++) await move('move', { x: from.x, y: from.y - 3 * i });
  const edge = { x: from.x, y: 10 };
  for (let i = 1; i <= 10; i++) await move('move', { x: from.x, y: from.y + ((edge.y - from.y) * i) / 10 });
  const viewportH = page.viewportSize()!.height;
  let dest: Point | null = null;
  for (let i = 0; i < 100 && !dest; i++) {
    await move('move', { x: edge.x, y: edge.y + (i % 2) });
    await page.waitForTimeout(50);
    const box = await target.boundingBox();
    if (box && box.y > 0.15 * viewportH && box.y + box.height < viewportH) {
      dest = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }
  }
  if (!dest) {
    await move('end');
    throw new Error('цель так и не показалась при удержании у края (автопрокрутка)');
  }
  for (let i = 1; i <= 6; i++) await move('move', { x: edge.x + ((dest.x - edge.x) * i) / 6, y: edge.y + ((dest.y - edge.y) * i) / 6 });
  await move('move', { x: dest.x, y: dest.y + 1 });
  await move('end');
  await cdp?.detach();
}

test('BRD-10 a board at the end of a long list is dragged up to a folder at the top (touch on phone)', async ({
  boardUserPage: page,
  hasTouch,
}) => {
  const t = tag();
  const target = await apiFolder(page.request, `Target ${t}`);
  await apiFolder(page.request, `Other ${t}`);
  const far = await apiBoard(page.request, `Far ${t}`);
  for (let i = 0; i < 15; i++) await apiBoard(page.request, `Filler ${i} ${t}`);
  await page.addInitScript(() => {
    (window as unknown as { __ptypes: string[] }).__ptypes = [];
    window.addEventListener('pointerdown', (e) => (window as unknown as { __ptypes: string[] }).__ptypes.push(e.pointerType), true);
  });
  await openList(page);
  await expect(folderToggle(page, target.title)).toBeVisible();
  const handle = allBoards(page).getByRole('button', { name: `Drag ${far.title}`, exact: true });
  await dragFarUp(page, handle, folderRow(page, target.title), hasTouch);
  await expect.poll(async () => (await apiBoardById(page.request, far.id)).folder_id).toBe(target.id);
  const types = await page.evaluate(() => (window as unknown as { __ptypes: string[] }).__ptypes);
  expect(types).toContain(hasTouch ? 'touch' : 'mouse');
  await page.reload();
  await expand(page, target.title);
  await expect(contentsOf(page, target.title).getByRole('link', { name: far.title, exact: true })).toBeVisible();
});
