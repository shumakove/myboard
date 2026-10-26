// Приёмка T6.8 · канбан и карточки: KBN-01…KBN-03; попутно COL-01, CVS-07, CVS-08, CVS-19, MOB-06, ARCH.
// Сценарии — docs/qa/reports/T6.8.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.8.
// Наблюдение: DOM холста, документ доски глазами позднего клиента по /api/ws, второй клиент.
// Код из apps/ не импортируется.
import type { Browser, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, centerOf, obj, onCanvas, selectionBar, tool, tools, type Box } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

// ---------- интерфейс (подписи из handoff T6.8) ----------

const kanbans = (page: Page) => page.locator('[data-object-id][data-type="kanban"]');
const cards = (page: Page) => page.locator('[data-object-id][data-type="card"]');
const idsOf = async (l: ReturnType<typeof kanbans>) => (await l.evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();
const columnEl = (page: Page, kid: string, col: string) => obj(page, kid).locator(`[data-column="${col}"]`);
const columnTitle = (page: Page, kid: string, col: string) => obj(page, kid).locator(`[data-column-title="${col}"]`);
const barButton = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const kanbanGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Kanban', exact: true });
const kanbanButton = (page: Page, name: string) => kanbanGroup(page).getByRole('button', { name, exact: true });
const titleField = (page: Page) => page.getByLabel('Column title', { exact: true });
const deleteDialog = (page: Page) => page.getByRole('dialog', { name: /^Delete column/ });
const textEditor = (page: Page) => page.getByRole('textbox', { name: 'Object text' });
const tagsBtn = (page: Page) => selectionBar(page).getByRole('button', { name: /^Tags/ });
const tagsGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Tags' });
const addTagField = (page: Page) => tagsGroup(page).getByLabel('Add tag');
const canvasTags = (page: Page, id: string) => obj(page, id).getByRole('list', { name: 'Tags' }).getByRole('listitem');

type Raw = Record<string, Record<string, unknown>>;
type KanbanJson = { type: string; x: number; y: number; width: number; height: number; columns: string[]; titles: Record<string, string> };
type CardJson = { type: string; x: number; y: number; text: string; tags: string[]; parent?: string | null; cell?: string | null };

async function rawDoc(page: Page, boardId: string): Promise<{ objects: Raw; trash: Raw }> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const objects: Raw = {};
  doc.getMap('objects').forEach((v, k) => {
    objects[k] = (v instanceof Y.Map ? v.toJSON() : v) as Record<string, unknown>;
  });
  return { objects, trash: doc.getMap('trash').toJSON() as Raw };
}

async function untilRaw(page: Page, boardId: string, check: (o: Raw, trash: Raw) => void, timeout = 15_000) {
  let last: Raw = {};
  await expect(async () => {
    const d = await rawDoc(page, boardId);
    last = d.objects;
    check(d.objects, d.trash);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}

const K = (o: Raw, id: string) => o[id] as unknown as KanbanJson;
const C = (o: Raw, id: string) => o[id] as unknown as CardJson;

/** Столбцы канбана на холсте слева направо: id и название. */
async function columnsOnCanvas(page: Page, kid: string): Promise<{ id: string; title: string }[]> {
  const cols = await obj(page, kid)
    .locator('[data-column]')
    .evaluateAll((els) =>
      els.map((e) => ({
        id: e.getAttribute('data-column') ?? '',
        left: (e as HTMLElement).getBoundingClientRect().left,
        title: (e.querySelector('[data-column-title]')?.textContent ?? '').trim(),
      })),
    );
  return cols.sort((a, b) => a.left - b.left).map(({ id, title }) => ({ id, title }));
}

async function deselect(page: Page) {
  const sel = page.locator('[data-object-id][aria-selected="true"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 4 && (await sel.count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  await expect(sel).toHaveCount(0);
}

/** Поставить канбан клавишей J в точке холста; вернуть id. */
async function placeKanban(page: Page, fx: number, fy: number): Promise<string> {
  const before = new Set(await idsOf(kanbans(page)));
  const p = await onCanvas(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('j');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await idsOf(kanbans(page))).filter((x) => !before.has(x)).length).toBe(1);
  return (await idsOf(kanbans(page))).find((x) => !before.has(x))!;
}

/** Точка в столбце (доля высоты столбца). */
async function inColumn(page: Page, kid: string, col: string, fy = 0.75): Promise<Point> {
  const b = await boxOf(columnEl(page, kid, col));
  return { x: b.x + b.width / 2, y: b.y + b.height * fy };
}

/** Поставить карточку клавишей A в столбец и ввести текст; вернуть id. */
async function placeCard(page: Page, kid: string, col: string, text: string, fy = 0.75): Promise<string> {
  await deselect(page);
  const before = new Set(await idsOf(cards(page)));
  const p = await inColumn(page, kid, col, fy);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('a');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await idsOf(cards(page))).filter((x) => !before.has(x)).length).toBe(1);
  const id = (await idsOf(cards(page))).find((x) => !before.has(x))!;
  await expect(textEditor(page)).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(textEditor(page)).toHaveCount(0);
  return id;
}

async function selectCard(page: Page, id: string) {
  await deselect(page);
  const b = await boxOf(obj(page, id));
  await page.mouse.click(b.x + 12, b.y + 12);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

async function addTag(page: Page, tag: string) {
  if (!(await tagsGroup(page).isVisible())) await tagsBtn(page).click();
  await expect(tagsGroup(page)).toBeVisible();
  await addTagField(page).fill(tag);
  await addTagField(page).press('Enter');
}

/** Выбрать столбец щелчком по заголовку. */
async function selectColumn(page: Page, kid: string, col: string) {
  await deselect(page);
  const b = await boxOf(columnTitle(page, kid, col));
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await expect(columnEl(page, kid, col)).toHaveAttribute('data-active', 'true');
}

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Перетащить карточку центром в точку. */
async function dragCardTo(page: Page, id: string, to: Point) {
  await deselect(page);
  const c = centerOf(await boxOf(obj(page, id)));
  await drag(page, c, to);
}

/** Перетащить канбан за пустое место первого столбца на `d`. */
async function moveKanban(page: Page, kid: string, d: Point) {
  await deselect(page);
  const cols = await columnsOnCanvas(page, kid);
  const b = await boxOf(columnEl(page, kid, cols[cols.length - 1].id));
  const from = { x: b.x + b.width / 2, y: b.y + b.height - 20 };
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-object-id]')?.getAttribute('data-object-id') ?? '', from);
  expect(hit, 'точка захвата канбана свободна от карточек').toBe(kid);
  await drag(page, from, { x: from.x + d.x, y: from.y + d.y });
}

const offset = (a: Box, b: Box): Point => ({ x: a.x - b.x, y: a.y - b.y });
function near(p: Point, q: Point, tol = 3) {
  expect(Math.abs(p.x - q.x), `x: ${p.x} против ${q.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.y - q.y), `y: ${p.y} против ${q.y}`).toBeLessThanOrEqual(tol);
}

/** Карточка лежит в столбце на холсте страницы (центр внутри прямоугольника столбца). */
async function cardInColumnOnCanvas(page: Page, kid: string, col: string, id: string) {
  await expect
    .poll(async () => {
      const c = centerOf(await boxOf(obj(page, id)));
      const b = await boxOf(columnEl(page, kid, col));
      return c.x > b.x && c.x < b.x + b.width && c.y > b.y && c.y < b.y + b.height;
    })
    .toBe(true);
}

async function ownerAndGuest(browser: Browser, f: Fx) {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  return { owner, guest, opts: o };
}

/** Инструмент из полного списка инструментов. */
async function pickFromAll(page: Page, name: string, isMobile = false) {
  const open = tool(page, 'All tools');
  if (isMobile) await open.tap();
  else await open.click();
  const b = page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name, exact: true });
  if (isMobile) await b.tap();
  else await b.click();
}

// ---------- KBN-01 ----------

test('KBN-01 Kanban tool (All tools and key J) places a kanban with titled columns; second client and reload; no browser dialogs', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    await pickFromAll(page, 'Kanban');
    const p = await onCanvas(page, 0.5, 0.45);
    await page.mouse.click(p.x, p.y);
    await expect(kanbans(page)).toHaveCount(1);
    const k1 = (await idsOf(kanbans(page)))[0];
    const cols = await columnsOnCanvas(page, k1);
    expect(cols.length).toBeGreaterThanOrEqual(2);
    for (const c of cols) expect(c.title.length, 'у столбца есть заголовок').toBeGreaterThan(0);
    console.log(`наблюдение KBN-01: столбцы нового канбана — ${cols.map((c) => c.title).join(', ')}`);
    const raw = await untilRaw(page, owner.boardId, (o) => expect(o[k1]).toBeTruthy());
    expect(K(raw, k1).type).toBe('kanban');
    expect(K(raw, k1).columns).toEqual(cols.map((c) => c.id));
    expect(cols.map((c) => K(raw, k1).titles[c.id])).toEqual(cols.map((c) => c.title));
    // второй канбан клавишей J — отдельный объект со своими столбцами
    await deselect(page);
    const k2 = await placeKanban(page, 0.5, 0.97);
    const cols2 = await columnsOnCanvas(page, k2);
    expect(cols2.map((c) => c.id).some((id) => cols.some((c) => c.id === id))).toBe(false);
    // второй клиент
    for (const kid of [k1, k2]) {
      await expect(obj(guest.page, kid)).toBeVisible();
      await expect(obj(guest.page, kid).locator('[data-column]')).toHaveCount((await columnsOnCanvas(page, kid)).length);
    }
    expect((await columnsOnCanvas(guest.page, k1)).map((c) => c.title)).toEqual(cols.map((c) => c.title));
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(kanbans(page)).toHaveCount(2);
    expect((await columnsOnCanvas(page, k1)).map((c) => c.title)).toEqual(cols.map((c) => c.title));
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-01 moving the kanban moves its columns and cards; another kanban and its cards stay', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const k1 = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, k1);
    const c1 = await placeCard(page, k1, cols[0].id, 'travels', 0.4);
    const rel0 = offset(await boxOf(obj(page, c1)), await boxOf(columnEl(page, k1, cols[0].id)));
    const g0 = offset(await boxOf(obj(guest.page, c1)), await boxOf(columnEl(guest.page, k1, cols[0].id)));
    await moveKanban(page, k1, { x: 60, y: 120 });
    near(offset(await boxOf(obj(page, c1)), await boxOf(columnEl(page, k1, cols[0].id))), rel0);
    await expect
      .poll(async () => {
        const d = offset(await boxOf(obj(guest.page, c1)), await boxOf(columnEl(guest.page, k1, cols[0].id)));
        return Math.abs(d.x - g0.x) + Math.abs(d.y - g0.y);
      })
      .toBeLessThanOrEqual(4);
    const raw = await untilRaw(page, owner.boardId, (o) => expect(C(o, c1)?.parent).toBe(k1));
    expect(C(raw, c1).cell).toBe(cols[0].id);
    console.log(`наблюдение ARCH: карточка в столбце — parent=${String(C(raw, c1).parent)}, cell=${String(C(raw, c1).cell)}, x=${C(raw, c1).x}, y=${C(raw, c1).y}`);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-01 SHR-04 participant by link creates a kanban; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const kid = await placeKanban(guest.page, 0.5, 0.45);
    await expect(obj(owner.page, kid)).toBeVisible();
    expect((await columnsOnCanvas(owner.page, kid)).length).toBeGreaterThanOrEqual(2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- KBN-02 ----------

test('KBN-02 a card in a column gets text and several tags; second client and reload; tag removal; empty tag is not added', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const cid = await placeCard(page, kid, cols[0].id, 'Write docs');
    await selectCard(page, cid);
    await addTag(page, 'docs');
    await addTag(page, 'urgent');
    await addTag(page, '   ');
    const raw = await untilRaw(page, owner.boardId, (o) => {
      expect(C(o, cid)?.type).toBe('card');
      expect(C(o, cid).text).toBe('Write docs');
      expect(C(o, cid).tags).toEqual(['docs', 'urgent']);
    });
    expect(C(raw, cid).parent).toBe(kid);
    expect(C(raw, cid).cell).toBe(cols[0].id);
    for (const pg of [page, guest.page]) {
      await expect(obj(pg, cid)).toContainText('Write docs');
      await expect(canvasTags(pg, cid)).toHaveText(['docs', 'urgent']);
    }
    // удаление тега
    await tagsGroup(page).getByRole('button', { name: 'Remove tag docs', exact: true }).click();
    await expect(canvasTags(guest.page, cid)).toHaveText(['urgent']);
    // правка текста кнопкой Edit text (панель выделения закрывает верх карточки — двойной щелчок в COL-01)
    await barButton(page, 'Edit text').click();
    await expect(textEditor(page)).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.type(' now');
    await page.keyboard.press('Escape');
    await expect(obj(guest.page, cid)).toContainText('Write docs now');
    await page.reload();
    await expect(obj(page, cid)).toContainText('Write docs now');
    await expect(canvasTags(page, cid)).toHaveText(['urgent']);
    await cardInColumnOnCanvas(page, kid, cols[0].id, cid);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-02 a card dragged into another column belongs to it — owner, second client, reload; it stays there when the kanban moves', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const a = await placeCard(page, kid, cols[0].id, 'card A', 0.3);
    const b = await placeCard(page, kid, cols[0].id, 'card B', 0.6);
    await dragCardTo(page, a, await inColumn(page, kid, cols[1].id, 0.5));
    const raw = await untilRaw(page, owner.boardId, (o) => {
      expect(C(o, a).parent).toBe(kid);
      expect(C(o, a).cell).toBe(cols[1].id);
    });
    expect(C(raw, b).cell).toBe(cols[0].id);
    for (const pg of [page, guest.page]) {
      await cardInColumnOnCanvas(pg, kid, cols[1].id, a);
      await cardInColumnOnCanvas(pg, kid, cols[0].id, b);
    }
    // наблюдение: столбец, откуда ушла карточка, смыкается
    console.log(`наблюдение KBN-02: B после ухода A — y=${C(raw, b).y}`);
    // перенос в третий столбец и сдвиг канбана
    await dragCardTo(page, b, await inColumn(page, kid, cols[2].id, 0.5));
    await untilRaw(page, owner.boardId, (o) => expect(C(o, b).cell).toBe(cols[2].id));
    await moveKanban(page, kid, { x: 50, y: 80 });
    await cardInColumnOnCanvas(page, kid, cols[1].id, a);
    await cardInColumnOnCanvas(page, kid, cols[2].id, b);
    await cardInColumnOnCanvas(guest.page, kid, cols[2].id, b);
    await page.reload();
    await expect(obj(page, a)).toBeVisible();
    await cardInColumnOnCanvas(page, kid, cols[1].id, a);
    await cardInColumnOnCanvas(page, kid, cols[2].id, b);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-02 boundaries: order inside a column by drag; a card dropped outside the kanban is kept on the canvas, not lost', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const a = await placeCard(page, kid, cols[0].id, 'first', 0.3);
    const b = await placeCard(page, kid, cols[0].id, 'second', 0.6);
    let raw = await untilRaw(page, owner.boardId, (o) => expect(C(o, b).cell).toBe(cols[0].id));
    expect(C(raw, a).y).toBeLessThan(C(raw, b).y);
    // B выше A
    const ab = await boxOf(obj(page, a));
    await dragCardTo(page, b, { x: ab.x + ab.width / 2, y: ab.y + 4 });
    raw = await untilRaw(page, owner.boardId, (o) => expect(C(o, b).y).toBeLessThan(C(o, a).y));
    console.log(`наблюдение KBN-02: порядок внутри столбца — B y=${C(raw, b).y}, A y=${C(raw, a).y}`);
    // вынос за канбан
    const kb = await boxOf(obj(page, kid));
    const out = { x: kb.x + 140, y: kb.y + kb.height + 70 };
    const cv = await boxOf(canvas(page));
    expect(out.y).toBeLessThan(cv.y + cv.height - 20);
    await dragCardTo(page, a, out);
    raw = await untilRaw(page, owner.boardId, (o) => expect(C(o, a).parent ?? null).toBeNull());
    expect(C(raw, a).text).toBe('first');
    await expect(obj(page, a)).toBeVisible();
    const free = await boxOf(obj(page, a));
    await moveKanban(page, kid, { x: -40, y: 60 });
    near(await boxOf(obj(page, a)), free, 1);
    // и обратно в столбец
    await dragCardTo(page, a, await inColumn(page, kid, cols[1].id, 0.5));
    await untilRaw(page, owner.boardId, (o) => expect(C(o, a).cell).toBe(cols[1].id));
  } finally {
    await owner.close();
  }
});

test('KBN-02 SHR-04 participant by link drags the owner card to another column; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const kid = await placeKanban(owner.page, 0.5, 0.45);
    const cols = await columnsOnCanvas(owner.page, kid);
    const cid = await placeCard(owner.page, kid, cols[0].id, 'owner card');
    await deselect(owner.page);
    await expect(obj(guest.page, cid)).toBeVisible();
    await dragCardTo(guest.page, cid, await inColumn(guest.page, kid, cols[1].id, 0.5));
    await cardInColumnOnCanvas(owner.page, kid, cols[1].id, cid);
    await untilRaw(owner.page, owner.boardId, (o) => expect(C(o, cid).cell).toBe(cols[1].id));
    // участник создаёт свою карточку с тегом
    const gid = await placeCard(guest.page, kid, cols[2].id, 'guest card');
    await selectCard(guest.page, gid);
    await addTag(guest.page, 'guest');
    await expect(canvasTags(owner.page, gid)).toHaveText(['guest']);
    await cardInColumnOnCanvas(owner.page, kid, cols[2].id, gid);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- KBN-03 ----------

test('KBN-03 a column is renamed (Rename column and double click on title); second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    await selectColumn(page, kid, cols[1].id);
    await expect(kanbanGroup(page)).toContainText(`Column: ${cols[1].title}`);
    await kanbanButton(page, 'Rename column').click();
    await expect(titleField(page)).toBeFocused();
    await titleField(page).fill('Doing');
    await titleField(page).press('Enter');
    await expect(columnTitle(page, kid, cols[1].id)).toHaveText('Doing');
    await expect(columnTitle(guest.page, kid, cols[1].id)).toHaveText('Doing');
    // двойной щелчок по заголовку
    await deselect(page);
    const t = await boxOf(columnTitle(page, kid, cols[0].id));
    await page.mouse.dblclick(t.x + t.width / 2, t.y + t.height / 2);
    await expect(titleField(page)).toBeFocused();
    await titleField(page).fill('Backlog');
    await titleField(page).press('Enter');
    await expect(columnTitle(guest.page, kid, cols[0].id)).toHaveText('Backlog');
    const raw = await untilRaw(page, owner.boardId, (o) => expect(K(o, kid).titles[cols[0].id]).toBe('Backlog'));
    expect(K(raw, kid).titles[cols[1].id]).toBe('Doing');
    expect(K(raw, kid).titles[cols[2].id]).toBe(cols[2].title);
    // граничный: пустое имя — наблюдение
    await selectColumn(page, kid, cols[2].id);
    await kanbanButton(page, 'Rename column').click();
    await titleField(page).fill('');
    await titleField(page).press('Enter');
    await page.waitForTimeout(500);
    console.log(`наблюдение KBN-03: пустое название → «${(await columnTitle(page, kid, cols[2].id).textContent()) ?? ''}»`);
    await expect(obj(page, kid).locator('[data-column]')).toHaveCount(3);
    await page.reload();
    await expect(columnTitle(page, kid, cols[0].id)).toHaveText('Backlog');
    await expect(columnTitle(page, kid, cols[1].id)).toHaveText('Doing');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-03 Add column adds one column and keeps cards in place; second client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const c0 = await placeCard(page, kid, cols[0].id, 'stay 0');
    const c2 = await placeCard(page, kid, cols[2].id, 'stay 2');
    const r0 = await untilRaw(page, owner.boardId, (o) => expect(C(o, c2)?.cell).toBe(cols[2].id));
    await selectColumn(page, kid, cols[0].id);
    await kanbanButton(page, 'Add column').click();
    // новое название сразу в правке (наблюдение) — задаём своё
    if (await titleField(page).isVisible()) {
      await titleField(page).fill('Review');
      await titleField(page).press('Enter');
    }
    await expect(obj(page, kid).locator('[data-column]')).toHaveCount(cols.length + 1);
    await expect(obj(guest.page, kid).locator('[data-column]')).toHaveCount(cols.length + 1);
    const after = await columnsOnCanvas(page, kid);
    const added = after.find((c) => !cols.some((x) => x.id === c.id))!;
    console.log(`наблюдение KBN-03: новый столбец «${added.title}» на позиции ${after.findIndex((c) => c.id === added.id)} из ${after.length}`);
    const r1 = await untilRaw(page, owner.boardId, (o) => expect(K(o, kid).columns.length).toBe(cols.length + 1));
    expect(K(r1, kid).width).toBeGreaterThan(K(r0, kid).width);
    expect(C(r1, c0).cell).toBe(cols[0].id);
    expect(C(r1, c2).cell).toBe(cols[2].id);
    for (const pg of [page, guest.page]) {
      await cardInColumnOnCanvas(pg, kid, cols[0].id, c0);
      await cardInColumnOnCanvas(pg, kid, cols[2].id, c2);
    }
    // без выбранного столбца — тоже добавляется
    await deselect(page);
    const kb = await boxOf(obj(page, kid));
    await page.mouse.click(kb.x + 20, kb.y + kb.height - 15);
    await expect(obj(page, kid)).toHaveAttribute('aria-selected', 'true');
    await kanbanButton(page, 'Add column').click();
    if (await titleField(page).isVisible()) await titleField(page).press('Enter');
    await expect(obj(guest.page, kid).locator('[data-column]')).toHaveCount(cols.length + 2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-03 deleting a column with cards asks in an app dialog; Cancel changes nothing; moving the cards keeps them with text and tags; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const x = await placeCard(page, kid, cols[1].id, 'move me 1', 0.3);
    await selectCard(page, x);
    await addTag(page, 'keep-tag');
    const y = await placeCard(page, kid, cols[1].id, 'move me 2', 0.6);
    const z = await placeCard(page, kid, cols[2].id, 'already done');
    await untilRaw(page, owner.boardId, (o) => expect(C(o, y)?.cell).toBe(cols[1].id));
    // Cancel
    await selectColumn(page, kid, cols[1].id);
    await kanbanButton(page, 'Delete column').click();
    await expect(deleteDialog(page)).toBeVisible();
    await expect(deleteDialog(page)).toContainText('2');
    await deleteDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(deleteDialog(page)).toHaveCount(0);
    await expect(obj(page, kid).locator('[data-column]')).toHaveCount(3);
    await untilRaw(page, owner.boardId, (o) => {
      expect(K(o, kid).columns).toHaveLength(3);
      expect(C(o, x).cell).toBe(cols[1].id);
    });
    // перенос в последний столбец
    await selectColumn(page, kid, cols[1].id);
    await kanbanButton(page, 'Delete column').click();
    await expect(deleteDialog(page)).toBeVisible();
    await deleteDialog(page).getByLabel('Move cards to').selectOption({ label: cols[2].title });
    await deleteDialog(page).getByRole('button', { name: 'Move cards and delete column', exact: true }).click();
    await expect(deleteDialog(page)).toHaveCount(0);
    const raw = await untilRaw(page, owner.boardId, (o) => {
      expect(K(o, kid).columns).toEqual([cols[0].id, cols[2].id]);
      for (const id of [x, y, z]) expect(C(o, id).cell).toBe(cols[2].id);
    });
    expect(C(raw, x).text).toBe('move me 1');
    expect(C(raw, x).tags).toEqual(['keep-tag']);
    expect(C(raw, y).text).toBe('move me 2');
    for (const pg of [page, guest.page]) {
      await expect(obj(pg, kid).locator('[data-column]')).toHaveCount(2);
      for (const id of [x, y, z]) await cardInColumnOnCanvas(pg, kid, cols[2].id, id);
    }
    // карточки не накладываются друг на друга
    const bx = [await boxOf(obj(page, x)), await boxOf(obj(page, y)), await boxOf(obj(page, z))].sort((p, q) => p.y - q.y);
    expect(bx[1].y).toBeGreaterThanOrEqual(bx[0].y + bx[0].height - 1);
    expect(bx[2].y).toBeGreaterThanOrEqual(bx[1].y + bx[1].height - 1);
    await page.reload();
    await expect(obj(page, kid).locator('[data-column]')).toHaveCount(2);
    for (const id of [x, y, z]) await cardInColumnOnCanvas(page, kid, cols[2].id, id);
    await expect(canvasTags(page, x)).toHaveText(['keep-tag']);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-03 deleting a column together with its cards removes the cards on both clients and after reload; other cards stay', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const gone1 = await placeCard(page, kid, cols[0].id, 'gone 1', 0.3);
    const gone2 = await placeCard(page, kid, cols[0].id, 'gone 2', 0.6);
    const stay = await placeCard(page, kid, cols[1].id, 'stay');
    await untilRaw(page, owner.boardId, (o) => expect(C(o, gone2)?.cell).toBe(cols[0].id));
    await selectColumn(page, kid, cols[0].id);
    await kanbanButton(page, 'Delete column').click();
    await expect(deleteDialog(page)).toBeVisible();
    await deleteDialog(page).getByRole('button', { name: 'Delete column and cards', exact: true }).click();
    await expect(deleteDialog(page)).toHaveCount(0);
    let trashKeys: string[] = [];
    await untilRaw(page, owner.boardId, (o, trash) => {
      expect(K(o, kid).columns).toEqual([cols[1].id, cols[2].id]);
      expect(o[gone1]).toBeUndefined();
      expect(o[gone2]).toBeUndefined();
      expect(C(o, stay).cell).toBe(cols[1].id);
      trashKeys = Object.keys(trash);
    });
    console.log(`наблюдение KBN-03: в корзине после удаления — ${trashKeys.length} записей`);
    for (const pg of [page, guest.page]) {
      await expect(obj(pg, gone1)).toHaveCount(0);
      await expect(obj(pg, gone2)).toHaveCount(0);
      await expect(obj(pg, kid).locator('[data-column]')).toHaveCount(2);
      await cardInColumnOnCanvas(pg, kid, cols[1].id, stay);
    }
    await page.reload();
    await expect(obj(page, kid)).toBeVisible();
    await expect(obj(page, gone1)).toHaveCount(0);
    await expect(obj(page, kid).locator('[data-column]')).toHaveCount(2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('KBN-03 boundaries: an empty column is deleted (no stray cards); the last column cannot leave a broken kanban', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    for (let i = 0; i < cols.length - 1; i++) {
      await selectColumn(page, kid, cols[i].id);
      await kanbanButton(page, 'Delete column').click();
      const asked = await deleteDialog(page).isVisible();
      if (asked) {
        console.log('наблюдение KBN-03: пустой столбец — с вопросом');
        await deleteDialog(page).getByRole('button', { name: /delete/i }).first().click();
      }
      await expect(obj(page, kid).locator('[data-column]')).toHaveCount(cols.length - 1 - i);
    }
    const last = cols[cols.length - 1].id;
    await selectColumn(page, kid, last);
    const del = kanbanButton(page, 'Delete column');
    const canDelete = (await del.count()) > 0 && (await del.isEnabled());
    console.log(`наблюдение KBN-03: удаление последнего столбца ${canDelete ? 'доступно' : 'недоступно'}`);
    if (canDelete) {
      await del.click();
      if (await deleteDialog(page).isVisible()) await deleteDialog(page).getByRole('button', { name: /delete/i }).first().click();
    }
    const raw = await untilRaw(page, owner.boardId, () => {});
    if (raw[kid]) expect(K(raw, kid).columns.length).toBeGreaterThanOrEqual(1);
    for (const o of Object.values(raw)) if ((o as CardJson).type === 'card' && (o as CardJson).parent) expect(raw[String((o as CardJson).parent)]).toBeTruthy();
  } finally {
    await owner.close();
  }
});

test('KBN-03 SHR-04 participant by link renames, adds and deletes a column with its cards moved; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const kid = await placeKanban(owner.page, 0.5, 0.45);
    const cols = await columnsOnCanvas(owner.page, kid);
    const cid = await placeCard(owner.page, kid, cols[0].id, 'owner card');
    await deselect(owner.page);
    const g = guest.page;
    await expect(obj(g, cid)).toBeVisible();
    await selectColumn(g, kid, cols[1].id);
    await kanbanButton(g, 'Rename column').click();
    await titleField(g).fill('Guest named');
    await titleField(g).press('Enter');
    await expect(columnTitle(owner.page, kid, cols[1].id)).toHaveText('Guest named');
    await selectColumn(g, kid, cols[2].id);
    await kanbanButton(g, 'Add column').click();
    if (await titleField(g).isVisible()) await titleField(g).press('Enter');
    await expect(obj(owner.page, kid).locator('[data-column]')).toHaveCount(cols.length + 1);
    await selectColumn(g, kid, cols[0].id);
    await kanbanButton(g, 'Delete column').click();
    await expect(deleteDialog(g)).toBeVisible();
    await deleteDialog(g).getByLabel('Move cards to').selectOption({ label: 'Guest named' });
    await deleteDialog(g).getByRole('button', { name: 'Move cards and delete column', exact: true }).click();
    await expect(obj(owner.page, kid).locator('[data-column]')).toHaveCount(cols.length);
    await cardInColumnOnCanvas(owner.page, kid, cols[1].id, cid);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- попутно ----------

test('COL-01 owner and participant edit the text of two cards at the same time; both edits survive on both', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const kid = await placeKanban(owner.page, 0.5, 0.45);
    const cols = await columnsOnCanvas(owner.page, kid);
    const a = await placeCard(owner.page, kid, cols[0].id, 'A');
    const b = await placeCard(owner.page, kid, cols[1].id, 'B');
    await deselect(owner.page);
    await expect(obj(guest.page, b)).toBeVisible();
    const open = async (pg: Page, id: string) => {
      await deselect(pg);
      const bx = await boxOf(obj(pg, id));
      await pg.mouse.dblclick(bx.x + bx.width / 2, bx.y + 14);
      await expect(textEditor(pg)).toBeFocused();
      await pg.keyboard.press('End');
    };
    await open(owner.page, a);
    await open(guest.page, b);
    await Promise.all([owner.page.keyboard.type(' owner', { delay: 30 }), guest.page.keyboard.type(' guest', { delay: 30 })]);
    await owner.page.keyboard.press('Escape');
    await guest.page.keyboard.press('Escape');
    for (const pg of [owner.page, guest.page]) {
      await expect(obj(pg, a)).toContainText('A owner');
      await expect(obj(pg, b)).toContainText('B guest');
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 undo reverts a card move and a column deletion; CVS-19 a locked kanban does not move; CVS-08 search finds a card by its tag', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const cid = await placeCard(page, kid, cols[0].id, 'undo card');
    await selectCard(page, cid);
    await addTag(page, 'qa-kbn-tag');
    await dragCardTo(page, cid, await inColumn(page, kid, cols[1].id, 0.5));
    await untilRaw(page, owner.boardId, (o) => expect(C(o, cid).cell).toBe(cols[1].id));
    await deselect(page);
    await page.keyboard.press('ControlOrMeta+z');
    await untilRaw(page, owner.boardId, (o) => expect(C(o, cid).cell).toBe(cols[0].id));
    await cardInColumnOnCanvas(page, kid, cols[0].id, cid);
    // удаление столбца с карточкой и отмена
    await selectColumn(page, kid, cols[0].id);
    await kanbanButton(page, 'Delete column').click();
    await deleteDialog(page).getByRole('button', { name: 'Delete column and cards', exact: true }).click();
    await untilRaw(page, owner.boardId, (o) => expect(o[cid]).toBeUndefined());
    await deselect(page);
    await page.keyboard.press('ControlOrMeta+z');
    const raw = await untilRaw(page, owner.boardId, (o) => {
      expect(K(o, kid).columns).toEqual(cols.map((c) => c.id));
      expect(C(o, cid)?.cell).toBe(cols[0].id);
    });
    expect(C(raw, cid).tags).toEqual(['qa-kbn-tag']);
    await cardInColumnOnCanvas(page, kid, cols[0].id, cid);
    // поиск по тегу карточки
    await tools(page).getByRole('button', { name: 'Search', exact: true }).click();
    const panel = page.getByRole('search', { name: 'Search board' });
    await panel.getByLabel('Search text and tags').fill('qa-kbn-tag');
    await expect(panel.getByRole('list', { name: 'Search results' }).getByRole('button')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // блокировка канбана
    await deselect(page);
    const kb = await boxOf(obj(page, kid));
    await page.mouse.click(kb.x + kb.width - 20, kb.y + kb.height - 15);
    await expect(obj(page, kid)).toHaveAttribute('aria-selected', 'true');
    await barButton(page, 'Lock').click();
    const b0 = await boxOf(obj(page, kid));
    await moveKanban(page, kid, { x: 80, y: 60 });
    near(await boxOf(obj(page, kid)), b0, 1);
  } finally {
    await owner.close();
  }
});

test('MOB-06 on a phone a kanban is placed by tap and a card is added to a column', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickFromAll(page, 'Kanban', true);
    const p = await onCanvas(page, 0.5, 0.4);
    await page.touchscreen.tap(p.x, p.y);
    await expect(kanbans(page)).toHaveCount(1);
    const kid = (await idsOf(kanbans(page)))[0];
    const cols = await columnsOnCanvas(page, kid);
    expect(cols.length).toBeGreaterThanOrEqual(2);
    // канбан шире экрана телефона: касание по видимой части канбана выделяет его,
    // Add card без выбранного столбца ставит карточку в первый (handoff T6.8)
    const kb = await boxOf(obj(page, kid));
    const cv = await boxOf(canvas(page));
    const tx = Math.max(kb.x, cv.x) + 30;
    const ty = Math.min(kb.y + kb.height, cv.y + cv.height) - 40;
    await page.touchscreen.tap(tx, ty);
    await expect(obj(page, kid)).toHaveAttribute('aria-selected', 'true');
    await kanbanButton(page, 'Add card').tap();
    await expect(cards(page)).toHaveCount(1);
    const cid = (await idsOf(cards(page)))[0];
    if (!(await textEditor(page).isVisible())) await barButton(page, 'Edit text').tap();
    await expect(textEditor(page)).toBeFocused();
    await page.keyboard.type('phone');
    await page.keyboard.press('Escape');
    await untilRaw(page, owner.boardId, (o) => {
      expect(C(o, cid).text).toBe('phone');
      expect(C(o, cid).parent).toBe(kid);
      expect(C(o, cid).cell).toBe(cols[0].id);
    });
  } finally {
    await owner.close();
  }
});

test('ARCH kanban and card edits go through the WebSocket only — no mutating HTTP requests to /api', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    });
    const kid = await placeKanban(page, 0.5, 0.45);
    const cols = await columnsOnCanvas(page, kid);
    const cid = await placeCard(page, kid, cols[0].id, 'arch');
    await selectCard(page, cid);
    await addTag(page, 'ws');
    await dragCardTo(page, cid, await inColumn(page, kid, cols[1].id, 0.5));
    await selectColumn(page, kid, cols[2].id);
    await kanbanButton(page, 'Rename column').click();
    await titleField(page).fill('Arch');
    await titleField(page).press('Enter');
    await kanbanButton(page, 'Add column').click();
    if (await titleField(page).isVisible()) await titleField(page).press('Enter');
    await untilRaw(page, owner.boardId, (o) => {
      expect(K(o, kid).columns.length).toBe(4);
      expect(C(o, cid).cell).toBe(cols[1].id);
    });
    expect(writes).toEqual([]);
  } finally {
    await owner.close();
  }
});
