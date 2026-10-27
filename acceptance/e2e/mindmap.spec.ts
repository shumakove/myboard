// Приёмка T6.9 · интеллект-карты: MAP-01…MAP-04; попутно COL-01, CVS-07, CVS-08, MOB-06, ARCH.
// Сценарии — docs/qa/reports/T6.9.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.9.
// Наблюдение: DOM холста, документ доски глазами позднего клиента по /api/ws, второй клиент.
// Код из apps/ не импортируется.
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, centerOf, obj, onCanvas, selectionBar, tool, tools, type Box } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

// ---------- интерфейс (подписи из handoff T6.9) ----------

const maps = (page: Page) => page.locator('[data-object-id][data-type="mindmap"]');
const nodeEl = (page: Page, nid: string) => page.locator(`[data-node="${nid}"]`);
const nodesOf = (page: Page, mid: string) => obj(page, mid).locator('[data-node]');
const toggleOf = (page: Page, nid: string) => page.locator(`button[data-node-toggle="${nid}"]`);
const branches = (page: Page, mid: string) => obj(page, mid).locator('svg.mindmap-branches path');
const mapGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Mind map', exact: true });
const mapButton = (page: Page, name: string) => mapGroup(page).getByRole('button', { name, exact: true });
const colorList = (page: Page) => mapGroup(page).getByLabel('Node color');
const titleField = (page: Page) => page.getByRole('textbox', { name: 'Node title' });
const recolorDialog = (page: Page) => page.getByRole('dialog', { name: 'Recolor child nodes too?' });

const idsOf = async (l: Locator, attr = 'data-object-id') => (await l.evaluateAll((els, a) => els.map((e) => e.getAttribute(a) ?? ''), attr)).sort();

type Raw = Record<string, Record<string, unknown>>;
type NodeJson = { parent: string | null; order: number; text: string; color: string; collapsed?: boolean };
type MapJson = { type: string; x: number; y: number; root: string; nodes: Record<string, NodeJson> };

async function rawDoc(page: Page, boardId: string): Promise<{ objects: Raw; trash: Raw }> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const objects: Raw = {};
  doc.getMap('objects').forEach((v, k) => {
    objects[k] = (v instanceof Y.Map ? v.toJSON() : v) as Record<string, unknown>;
  });
  return { objects, trash: doc.getMap('trash').toJSON() as Raw };
}

async function untilRaw(page: Page, boardId: string, check: (o: Raw) => void, timeout = 15_000) {
  let last: Raw = {};
  await expect(async () => {
    last = (await rawDoc(page, boardId)).objects;
    check(last);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}

const M = (o: Raw, id: string) => o[id] as unknown as MapJson;
const kids = (m: MapJson, nid: string) =>
  Object.entries(m.nodes)
    .filter(([, n]) => n.parent === nid)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([k]) => k);
const nodeByText = (m: MapJson, text: string) => Object.entries(m.nodes).find(([, n]) => n.text === text)?.[0];
const subtree = (m: MapJson, nid: string): string[] => [nid, ...kids(m, nid).flatMap((k) => subtree(m, k))];

async function deselect(page: Page) {
  const sel = page.locator('[data-object-id][aria-selected="true"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 4 && (await sel.count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  await expect(sel).toHaveCount(0);
}

/** Поставить карту клавишей I в точке холста; вернуть id. */
async function placeMap(page: Page, fx: number, fy: number): Promise<string> {
  const before = new Set(await idsOf(maps(page)));
  const p = await onCanvas(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('i');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await idsOf(maps(page))).filter((x) => !before.has(x)).length).toBe(1);
  return (await idsOf(maps(page))).find((x) => !before.has(x))!;
}

/** id узла карты по видимому названию. */
async function nodeId(page: Page, mid: string, text: string): Promise<string> {
  const l = nodesOf(page, mid).filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
  await expect(l).toHaveCount(1);
  return (await l.getAttribute('data-node'))!;
}

async function clickNode(page: Page, nid: string) {
  const c = centerOf(await boxOf(nodeEl(page, nid)));
  await page.mouse.click(c.x, c.y);
  await expect(nodeEl(page, nid)).toHaveAttribute('data-active', 'true');
  await expect(mapGroup(page)).toBeVisible();
}

/** Добавить дочерний узел к выбранному узлу и назвать его; вернуть id. */
async function addChild(page: Page, mid: string, parent: string, text: string, how: 'button' | 'Tab' = 'button'): Promise<string> {
  await clickNode(page, parent);
  const before = new Set(await idsOf(nodesOf(page, mid), 'data-node'));
  if (how === 'button') await mapButton(page, 'Add child').click();
  else await page.keyboard.press('Tab');
  await expect(titleField(page)).toBeFocused();
  await titleField(page).fill(text);
  await titleField(page).press('Enter');
  await expect(titleField(page)).toHaveCount(0);
  const after = (await idsOf(nodesOf(page, mid), 'data-node')).filter((x) => !before.has(x));
  expect(after).toHaveLength(1);
  return after[0];
}

async function pickColor(page: Page, value?: string): Promise<string> {
  const list = colorList(page);
  const tag = await list.evaluate((e) => e.tagName);
  if (tag === 'SELECT') {
    const opts = await list.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
    const cur = await list.inputValue();
    const v = value ?? opts.find((o) => o !== cur)!;
    await list.selectOption(v);
    return v;
  }
  // список кнопок-образцов
  const btns = list.getByRole(tag === 'BUTTON' ? 'button' : 'radio');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    const pressed = (await b.getAttribute('aria-pressed')) === 'true' || (await b.getAttribute('aria-checked')) === 'true';
    const label = (await b.getAttribute('aria-label')) ?? (await b.textContent()) ?? '';
    if (value ? label.includes(value) : !pressed) {
      await b.click();
      return label;
    }
  }
  throw new Error('нет цвета для выбора');
}

const bg = (page: Page, nid: string) => nodeEl(page, nid).evaluate((e) => getComputedStyle(e).backgroundColor);

async function drag(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

function overlap(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function ownerAndGuest(browser: Browser, f: Fx) {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  return { owner, guest, opts: o };
}

async function pickFromAll(page: Page, name: string, isMobile = false) {
  const open = tool(page, 'All tools');
  if (isMobile) await open.tap();
  else await open.click();
  const b = page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name, exact: true });
  if (isMobile) await b.tap();
  else await b.click();
}

/** Карта с корнем, детьми A, B и внуками A1, A2 (A1 — с правнуком A1x). */
async function buildTree(page: Page, mid: string) {
  const root = await nodeId(page, mid, 'Main topic');
  const i1 = await nodeId(page, mid, 'Idea 1');
  const a1 = await addChild(page, mid, i1, 'A1');
  const a2 = await addChild(page, mid, i1, 'A2');
  const a1x = await addChild(page, mid, a1, 'A1x');
  const i2 = await nodeId(page, mid, 'Idea 2');
  return { root, i1, i2, a1, a2, a1x };
}

// ---------- MAP-01 ----------

test('MAP-01 Mind map tool (All tools and key I) places a map with a root and child nodes; grandchildren; branches; second client and reload; no browser dialogs', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    await pickFromAll(page, 'Mind map');
    const p = await onCanvas(page, 0.35, 0.3);
    await page.mouse.click(p.x, p.y);
    await expect(maps(page)).toHaveCount(1);
    const mid = (await idsOf(maps(page)))[0];
    await expect(obj(page, mid).locator('[data-node][data-root="true"]')).toHaveCount(1);
    const n0 = await nodesOf(page, mid).count();
    expect(n0, 'корень и хотя бы один дочерний узел').toBeGreaterThanOrEqual(2);
    const t = await buildTree(page, mid);
    await expect(nodesOf(page, mid)).toHaveCount(n0 + 3);
    await expect(branches(page, mid)).toHaveCount(n0 + 3 - 1);
    const raw = await untilRaw(page, owner.boardId, (o) => {
      expect(M(o, mid)?.type).toBe('mindmap');
      expect(Object.keys(M(o, mid).nodes)).toHaveLength(n0 + 3);
    });
    const m = M(raw, mid);
    expect(m.nodes[m.root].parent ?? null).toBeNull();
    expect(m.root).toBe(t.root);
    expect(m.nodes[t.i1].parent).toBe(t.root);
    expect(m.nodes[t.a1].parent).toBe(t.i1);
    expect(m.nodes[t.a1x].parent).toBe(t.a1);
    // дочерние правее родителя
    const rb = await boxOf(nodeEl(page, t.root));
    const ib = await boxOf(nodeEl(page, t.i1));
    const ab = await boxOf(nodeEl(page, t.a1));
    expect(ib.x).toBeGreaterThan(rb.x + rb.width - 1);
    expect(ab.x).toBeGreaterThan(ib.x + ib.width - 1);
    // второй клиент
    await expect(nodesOf(guest.page, mid)).toHaveCount(n0 + 3);
    await expect(nodeEl(guest.page, t.a1x)).toContainText('A1x');
    await expect(branches(guest.page, mid)).toHaveCount(n0 + 2);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(nodesOf(page, mid)).toHaveCount(n0 + 3);
    await expect(nodeEl(page, t.a1x)).toContainText('A1x');
    // вторая карта клавишей I — независима
    await deselect(page);
    const m2 = await placeMap(page, 0.35, 0.85);
    const ids1 = await idsOf(nodesOf(page, mid), 'data-node');
    const ids2 = await idsOf(nodesOf(page, m2), 'data-node');
    expect(ids2.some((x) => ids1.includes(x))).toBe(false);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-01 dragging the map moves all its nodes; another map stays; sibling nodes do not overlap', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const mid = await placeMap(page, 0.3, 0.3);
    await deselect(page);
    const other = await placeMap(page, 0.3, 0.8);
    await deselect(page);
    const root = await nodeId(page, mid, 'Main topic');
    const i1 = await nodeId(page, mid, 'Idea 1');
    const c1 = await addChild(page, mid, root, 'Third');
    const c2 = await addChild(page, mid, root, 'Fourth');
    const ch = [i1, await nodeId(page, mid, 'Idea 2'), c1, c2];
    const boxes = await Promise.all(ch.map((n) => boxOf(nodeEl(page, n))));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `узлы ${i} и ${j} не накладываются`).toBe(false);
    await deselect(page);
    const before = await Promise.all([root, ...ch].map((n) => boxOf(nodeEl(page, n))));
    const otherBefore = await boxOf(obj(page, other));
    const g0 = await boxOf(nodeEl(guest.page, c2));
    const r = centerOf(before[0]);
    await drag(page, r, { x: r.x + 90, y: r.y + 40 });
    // сдвиг может округляться привязкой к сетке — все узлы сдвинуты на одно и то же
    const after = await Promise.all([root, ...ch].map((n) => boxOf(nodeEl(page, n))));
    const dx = after[0].x - before[0].x;
    const dy = after[0].y - before[0].y;
    expect(Math.abs(dx - 90)).toBeLessThanOrEqual(20);
    expect(Math.abs(dy - 40)).toBeLessThanOrEqual(20);
    for (let i = 0; i < after.length; i++) {
      expect(Math.abs(after[i].x - before[i].x - dx)).toBeLessThanOrEqual(1);
      expect(Math.abs(after[i].y - before[i].y - dy)).toBeLessThanOrEqual(1);
    }
    const otherAfter = await boxOf(obj(page, other));
    expect(Math.abs(otherAfter.x - otherBefore.x) + Math.abs(otherAfter.y - otherBefore.y)).toBeLessThanOrEqual(1);
    await expect.poll(async () => Math.round((await boxOf(nodeEl(guest.page, c2))).x - g0.x)).toBeGreaterThan(40);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-01 SHR-04 participant by link creates a mind map with a child node; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const gp = guest.page;
    const mid = await placeMap(gp, 0.35, 0.4);
    const root = await nodeId(gp, mid, 'Main topic');
    const n = await addChild(gp, mid, root, 'from guest');
    await expect(nodeEl(owner.page, n)).toContainText('from guest');
    await expect(obj(owner.page, mid).locator('[data-node][data-root="true"]')).toHaveCount(1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- MAP-02 ----------

test('MAP-02 add child and sibling, rename, recolor and delete a node with its branch; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const mid = await placeMap(page, 0.3, 0.35);
    const t = await buildTree(page, mid);
    // соседний узел (Enter/Add sibling) — сразу после выбранного
    await clickNode(page, t.a1);
    await mapButton(page, 'Add sibling').click();
    await expect(titleField(page)).toBeFocused();
    await titleField(page).fill('A1b');
    await titleField(page).press('Enter');
    let raw = await untilRaw(page, owner.boardId, (o) => expect(nodeByText(M(o, mid), 'A1b')).toBeTruthy());
    const sib = nodeByText(M(raw, mid), 'A1b')!;
    expect(kids(M(raw, mid), t.i1)).toEqual([t.a1, sib, t.a2]);
    // переименование двойным щелчком
    const c = centerOf(await boxOf(nodeEl(page, t.a2)));
    await page.mouse.dblclick(c.x, c.y);
    await expect(titleField(page)).toBeFocused();
    await titleField(page).fill('Renamed');
    await titleField(page).press('Enter');
    await expect(nodeEl(guest.page, t.a2)).toHaveText(/Renamed/);
    // переименование кнопкой Rename
    await clickNode(page, t.i2);
    await mapButton(page, 'Rename').click();
    await titleField(page).fill('Second');
    await titleField(page).press('Enter');
    await expect(nodeEl(guest.page, t.i2)).toHaveText(/Second/);
    // перекраска листа — без вопроса
    await clickNode(page, t.i2);
    const g0 = await bg(guest.page, t.i2);
    await pickColor(page);
    await expect(recolorDialog(page)).toHaveCount(0);
    await expect.poll(() => bg(guest.page, t.i2)).not.toBe(g0);
    raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.i2].color).not.toBe(M(o, mid).nodes[t.root].color));
    const leafColor = M(raw, mid).nodes[t.i2].color;
    // удаление узла с веткой
    await clickNode(page, t.a1);
    await mapButton(page, 'Delete node').click();
    for (const n of [t.a1, t.a1x]) await expect(nodeEl(page, n)).toHaveCount(0);
    for (const n of [t.a1, t.a1x]) await expect(nodeEl(guest.page, n)).toHaveCount(0);
    raw = await untilRaw(page, owner.boardId, (o) => {
      expect(M(o, mid).nodes[t.a1]).toBeUndefined();
      expect(M(o, mid).nodes[t.a1x]).toBeUndefined();
    });
    expect(kids(M(raw, mid), t.i1)).toEqual([sib, t.a2]);
    // удаление клавишей Delete
    await clickNode(page, sib);
    await page.keyboard.press('Delete');
    await expect(nodeEl(guest.page, sib)).toHaveCount(0);
    await expect(maps(guest.page)).toHaveCount(1);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(nodeEl(page, t.a2)).toHaveText(/Renamed/);
    await expect(nodeEl(page, t.i2)).toHaveText(/Second/);
    for (const n of [t.a1, t.a1x, sib]) await expect(nodeEl(page, n)).toHaveCount(0);
    raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid)?.nodes[t.i2]).toBeTruthy());
    expect(M(raw, mid).nodes[t.i2].color).toBe(leafColor);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-02 dragging a node onto another node makes it a child together with its branch; reorder before a sibling; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    // A1 (с правнуком A1x) — на Idea 2 (середина цели)
    await clickNode(page, t.a1);
    const from = centerOf(await boxOf(nodeEl(page, t.a1)));
    const to = centerOf(await boxOf(nodeEl(page, t.i2)));
    await drag(page, from, to);
    let raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1].parent).toBe(t.i2));
    expect(M(raw, mid).nodes[t.a1x].parent).toBe(t.a1);
    expect(kids(M(raw, mid), t.i1)).toEqual([t.a2]);
    // на холсте: A1 правее Idea 2, ветка видна у второго клиента
    for (const pg of [page, guest.page]) {
      await expect
        .poll(async () => {
          const a = await boxOf(nodeEl(pg, t.a1));
          const p = await boxOf(nodeEl(pg, t.i2));
          return a.x > p.x + p.width - 1;
        })
        .toBe(true);
    }
    // перестановка: Idea 2 — перед Idea 1 (верхняя четверть цели)
    await clickNode(page, t.i2);
    const ib = await boxOf(nodeEl(page, t.i1));
    await drag(page, centerOf(await boxOf(nodeEl(page, t.i2))), { x: ib.x + ib.width / 2, y: ib.y + ib.height * 0.1 });
    raw = await untilRaw(page, owner.boardId, (o) => expect(kids(M(o, mid), t.root)).toEqual([t.i2, t.i1]));
    await expect
      .poll(async () => (await boxOf(nodeEl(guest.page, t.i2))).y < (await boxOf(nodeEl(guest.page, t.i1))).y)
      .toBe(true);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await untilRaw(page, owner.boardId, (o) => expect(M(o, mid)?.nodes[t.a1].parent).toBe(t.i2));
    await expect(nodeEl(page, t.i1)).toBeVisible();
    expect((await boxOf(nodeEl(page, t.i2))).y).toBeLessThan((await boxOf(nodeEl(page, t.i1))).y);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-02 negative: a node dropped into its own branch does not create a cycle; an empty title stays a usable node; Delete on the root never loses the map', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    const before = M(await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1x]).toBeTruthy()), mid);
    // Idea 1 на собственного правнука A1x
    await clickNode(page, t.i1);
    await drag(page, centerOf(await boxOf(nodeEl(page, t.i1))), centerOf(await boxOf(nodeEl(page, t.a1x))));
    await page.waitForTimeout(800);
    const raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid)?.nodes[t.a1x]).toBeTruthy());
    const m = M(raw, mid);
    for (const [k, n] of Object.entries(before.nodes)) expect(m.nodes[k]?.parent ?? null, `родитель ${n.text}`).toBe(n.parent ?? null);
    // пустое название — узел остаётся видимым и выбираемым
    await clickNode(page, t.i2);
    await mapButton(page, 'Rename').click();
    await titleField(page).fill('');
    await titleField(page).press('Enter');
    await expect(nodeEl(page, t.i2)).toBeVisible();
    console.log(`наблюдение MAP-02: пустое название показано как «${(await nodeEl(page, t.i2).textContent())?.trim()}»`);
    await clickNode(page, t.i2);
    // корень: нет Delete node; Delete и Backspace при выбранном корне не удаляют ни корень, ни карту (BUG-025)
    await clickNode(page, t.root);
    await expect(mapButton(page, 'Delete node')).toHaveCount(0);
    const count = Object.keys(M(await untilRaw(page, owner.boardId, (o) => expect(M(o, mid)).toBeTruthy()), mid).nodes).length;
    for (const key of ['Delete', 'Backspace']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(500);
      const after = await untilRaw(page, owner.boardId, () => undefined);
      expect(after[mid], `${key} при выбранном корне: карта остаётся`).toBeTruthy();
      expect(M(after, mid).nodes[t.root], `${key}: корень на месте`).toBeTruthy();
      expect(Object.keys(M(after, mid).nodes), `${key}: узлы не удалены`).toHaveLength(count);
      await expect(page.locator(`[data-object-id="${mid}"]`)).toBeVisible();
    }
  } finally {
    await owner.close();
  }
});

test('MAP-02 SHR-04 participant by link renames, recolors, deletes and moves nodes of the owner map; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const mid = await placeMap(owner.page, 0.3, 0.3);
    const t = await buildTree(owner.page, mid);
    await deselect(owner.page);
    const gp = guest.page;
    await expect(nodeEl(gp, t.a1x)).toBeVisible();
    // переименовать
    await clickNode(gp, t.a2);
    await mapButton(gp, 'Rename').click();
    await titleField(gp).fill('guest name');
    await titleField(gp).press('Enter');
    await expect(nodeEl(owner.page, t.a2)).toHaveText(/guest name/);
    // перекрасить лист
    await clickNode(gp, t.a2);
    const o0 = await bg(owner.page, t.a2);
    await pickColor(gp);
    await expect.poll(() => bg(owner.page, t.a2)).not.toBe(o0);
    // переставить A2 на Idea 2
    await clickNode(gp, t.a2);
    await drag(gp, centerOf(await boxOf(nodeEl(gp, t.a2))), centerOf(await boxOf(nodeEl(gp, t.i2))));
    await untilRaw(owner.page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a2].parent).toBe(t.i2));
    // удалить A1 с веткой
    await clickNode(gp, t.a1);
    await mapButton(gp, 'Delete node').click();
    await expect(nodeEl(owner.page, t.a1)).toHaveCount(0);
    await expect(nodeEl(owner.page, t.a1x)).toHaveCount(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- MAP-03 ----------

test('MAP-03 collapsing a child branch hides its whole subtree; expanding brings it back; state is shared and survives reload; a leaf has no toggle', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    await deselect(page);
    await expect(toggleOf(page, t.i2)).toHaveCount(0);
    await expect(toggleOf(page, t.a2)).toHaveCount(0);
    await toggleOf(page, t.i1).click();
    for (const n of [t.a1, t.a2, t.a1x]) await expect(nodeEl(page, n)).toBeHidden();
    for (const n of [t.root, t.i1, t.i2]) await expect(nodeEl(page, n)).toBeVisible();
    await expect(toggleOf(page, t.i1)).toHaveAccessibleName(/^Expand/);
    await expect(toggleOf(page, t.i1)).toHaveText(/3/);
    // второй клиент
    for (const n of [t.a1, t.a2, t.a1x]) await expect(nodeEl(guest.page, n)).toBeHidden();
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(nodeEl(page, t.i1)).toBeVisible();
    for (const n of [t.a1, t.a2, t.a1x]) await expect(nodeEl(page, n)).toBeHidden();
    const raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.i1].collapsed).toBe(true));
    expect(Object.keys(M(raw, mid).nodes)).toHaveLength(6);
    // развернуть
    await toggleOf(page, t.i1).click();
    for (const n of [t.a1, t.a2, t.a1x]) await expect(nodeEl(page, n)).toBeVisible();
    for (const n of [t.a1, t.a2, t.a1x]) await expect(nodeEl(guest.page, n)).toBeVisible();
    // свёрнутая внутренняя ветка остаётся свёрнутой внутри развёрнутой (A1)
    await toggleOf(page, t.a1).click();
    await expect(nodeEl(page, t.a1x)).toBeHidden();
    await expect(nodeEl(page, t.a2)).toBeVisible();
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-03 branches of the root collapse and expand: Collapse on the root hides every child; Expand restores them', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    const r0 = await boxOf(nodeEl(page, t.root));
    await clickNode(page, t.root);
    await mapButton(page, 'Collapse').click();
    for (const n of [t.i1, t.i2, t.a1, t.a2, t.a1x]) await expect(nodeEl(page, n)).toBeHidden();
    for (const n of [t.i1, t.i2, t.a1, t.a2, t.a1x]) await expect(nodeEl(guest.page, n)).toBeHidden();
    await expect(nodeEl(page, t.root)).toBeVisible();
    const r1 = await boxOf(nodeEl(page, t.root));
    console.log(`наблюдение MAP-03: корень при свёртке смещён на (${Math.round(r1.x - r0.x)}, ${Math.round(r1.y - r0.y)})`);
    // кнопкой у корня
    await deselect(page);
    await expect(toggleOf(page, t.root)).toHaveAccessibleName(/^Expand/);
    await toggleOf(page, t.root).click();
    for (const n of [t.i1, t.i2, t.a1, t.a2, t.a1x]) await expect(nodeEl(page, n)).toBeVisible();
    // свернуть одну ветку корня кнопкой, другая видна
    await toggleOf(page, t.i1).click();
    await expect(nodeEl(page, t.a1)).toBeHidden();
    await expect(nodeEl(page, t.i2)).toBeVisible();
    await clickNode(page, t.root);
    await mapButton(page, 'Collapse').click();
    await expect(nodeEl(page, t.i2)).toBeHidden();
    await clickNode(page, t.root);
    await mapButton(page, 'Expand').click();
    await expect(nodeEl(page, t.i2)).toBeVisible();
    await expect(nodeEl(page, t.i1)).toBeVisible();
    console.log(`наблюдение MAP-03: после развёртки корня ветка Idea 1 ${(await nodeEl(page, t.a1).isVisible()) ? 'развёрнута' : 'осталась свёрнутой'}`);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- MAP-04 ----------

test('MAP-04 recoloring a node with children asks in an app dialog; Recolor all recolors the node and every descendant; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    const before = M(await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1x]).toBeTruthy()), mid);
    await clickNode(page, t.i1);
    await pickColor(page);
    await expect(recolorDialog(page)).toBeVisible();
    await expect(recolorDialog(page)).toContainText('Idea 1');
    await recolorDialog(page).getByRole('button', { name: 'Recolor all', exact: true }).click();
    await expect(recolorDialog(page)).toHaveCount(0);
    const raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.i1].color).not.toBe(before.nodes[t.i1].color));
    const c = M(raw, mid).nodes[t.i1].color;
    for (const n of [t.a1, t.a2, t.a1x]) expect(M(raw, mid).nodes[n].color, M(raw, mid).nodes[n].text).toBe(c);
    for (const n of [t.root, t.i2]) expect(M(raw, mid).nodes[n].color).toBe(before.nodes[n].color);
    for (const pg of [page, guest.page]) {
      const want = await bg(pg, t.i1);
      for (const n of [t.a1, t.a2, t.a1x]) await expect.poll(() => bg(pg, n)).toBe(want);
      await expect.poll(() => bg(pg, t.i2)).not.toBe(want);
    }
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    const want = await bg(page, t.i1);
    for (const n of [t.a1, t.a2, t.a1x]) expect(await bg(page, n)).toBe(want);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-04 Only this node recolors just the node; Cancel changes nothing; a leaf is recolored without a question; the root with Recolor all recolors the whole map', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    const before = M(await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1x]).toBeTruthy()), mid);
    // Cancel
    await clickNode(page, t.i1);
    await pickColor(page);
    await expect(recolorDialog(page)).toBeVisible();
    await recolorDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(recolorDialog(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    let raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid)?.nodes[t.a1x]).toBeTruthy());
    for (const n of subtree(before, t.root)) expect(M(raw, mid).nodes[n].color).toBe(before.nodes[n].color);
    // Only this node
    await clickNode(page, t.a1);
    await pickColor(page);
    await expect(recolorDialog(page)).toBeVisible();
    await recolorDialog(page).getByRole('button', { name: 'Only this node', exact: true }).click();
    raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1].color).not.toBe(before.nodes[t.a1].color));
    expect(M(raw, mid).nodes[t.a1x].color).toBe(before.nodes[t.a1x].color);
    expect(M(raw, mid).nodes[t.i1].color).toBe(before.nodes[t.i1].color);
    await expect.poll(async () => (await bg(guest.page, t.a1)) !== (await bg(guest.page, t.a1x))).toBe(true);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    expect(await bg(page, t.a1)).not.toBe(await bg(page, t.a1x));
    // лист — без вопроса
    await clickNode(page, t.a2);
    await pickColor(page);
    await expect(recolorDialog(page)).toHaveCount(0);
    await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a2].color).not.toBe(before.nodes[t.a2].color));
    // корень, Recolor all — вся карта одного цвета
    await clickNode(page, t.root);
    await pickColor(page);
    await recolorDialog(page).getByRole('button', { name: 'Recolor all', exact: true }).click();
    raw = await untilRaw(page, owner.boardId, (o) => {
      const m = M(o, mid);
      for (const n of Object.keys(m.nodes)) expect(m.nodes[n].color).toBe(m.nodes[t.root].color);
    });
    expect(M(raw, mid).nodes[t.root].color).not.toBe(before.nodes[t.root].color);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('MAP-04 SHR-04 participant by link gets the recolor question and recolors a branch; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const mid = await placeMap(owner.page, 0.3, 0.3);
    const t = await buildTree(owner.page, mid);
    await deselect(owner.page);
    const gp = guest.page;
    await expect(nodeEl(gp, t.a1x)).toBeVisible();
    await clickNode(gp, t.a1);
    await pickColor(gp);
    await expect(recolorDialog(gp)).toBeVisible();
    await recolorDialog(gp).getByRole('button', { name: 'Recolor all', exact: true }).click();
    await expect.poll(async () => (await bg(owner.page, t.a1x)) === (await bg(owner.page, t.a1))).toBe(true);
    await expect.poll(async () => (await bg(owner.page, t.a1)) !== (await bg(owner.page, t.i1))).toBe(true);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- попутно ----------

test('COL-01 owner and participant rename two nodes at the same time; both edits survive on both', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const mid = await placeMap(owner.page, 0.3, 0.3);
    await deselect(owner.page);
    const i1 = await nodeId(owner.page, mid, 'Idea 1');
    const i2 = await nodeId(owner.page, mid, 'Idea 2');
    await expect(nodeEl(guest.page, i2)).toBeVisible();
    await clickNode(owner.page, i1);
    await mapButton(owner.page, 'Rename').click();
    await clickNode(guest.page, i2);
    await mapButton(guest.page, 'Rename').click();
    await titleField(owner.page).fill('by owner');
    await titleField(guest.page).fill('by guest');
    await Promise.all([titleField(owner.page).press('Enter'), titleField(guest.page).press('Enter')]);
    for (const pg of [owner.page, guest.page]) {
      await expect(nodeEl(pg, i1)).toHaveText(/by owner/);
      await expect(nodeEl(pg, i2)).toHaveText(/by guest/);
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 undo restores a deleted branch and reverts a node move; CVS-08 search finds a node by its title', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    await clickNode(page, t.a1);
    await mapButton(page, 'Delete node').click();
    await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1x]).toBeUndefined());
    await deselect(page);
    await page.keyboard.press('ControlOrMeta+z');
    let raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a1x]?.parent).toBe(t.a1));
    expect(M(raw, mid).nodes[t.a1].parent).toBe(t.i1);
    await expect(nodeEl(page, t.a1x)).toBeVisible();
    // перенос и отмена
    await clickNode(page, t.a2);
    await drag(page, centerOf(await boxOf(nodeEl(page, t.a2))), centerOf(await boxOf(nodeEl(page, t.i2))));
    await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a2].parent).toBe(t.i2));
    await deselect(page);
    await page.keyboard.press('ControlOrMeta+z');
    raw = await untilRaw(page, owner.boardId, (o) => expect(M(o, mid).nodes[t.a2].parent).toBe(t.i1));
    // поиск по названию узла
    await tools(page).getByRole('button', { name: 'Search', exact: true }).click();
    const panel = page.getByRole('search', { name: 'Search board' });
    await panel.getByLabel('Search text and tags').fill('A1x');
    await expect(panel.getByRole('list', { name: 'Search results' }).getByRole('button')).toHaveCount(1);
    await page.keyboard.press('Escape');
  } finally {
    await owner.close();
  }
});

test('MOB-06 on a phone a mind map is placed by tap and a child node is added', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickFromAll(page, 'Mind map', true);
    const p = await onCanvas(page, 0.5, 0.3);
    await page.touchscreen.tap(p.x, p.y);
    await expect(maps(page)).toHaveCount(1);
    const mid = (await idsOf(maps(page)))[0];
    const root = await nodeId(page, mid, 'Main topic');
    const c = centerOf(await boxOf(nodeEl(page, root)));
    await page.touchscreen.tap(c.x, c.y);
    await expect(nodeEl(page, root)).toHaveAttribute('data-active', 'true');
    const before = await nodesOf(page, mid).count();
    await mapButton(page, 'Add child').tap();
    await expect(titleField(page)).toBeFocused();
    await titleField(page).fill('phone');
    await titleField(page).press('Enter');
    await expect(nodesOf(page, mid)).toHaveCount(before + 1);
    await untilRaw(page, owner.boardId, (o) => {
      const id = nodeByText(M(o, mid), 'phone');
      expect(id).toBeTruthy();
      expect(M(o, mid).nodes[id!].parent).toBe(root);
    });
  } finally {
    await owner.close();
  }
});

test('ARCH mind map edits go through the WebSocket only — no mutating HTTP requests to /api', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`);
    });
    const mid = await placeMap(page, 0.3, 0.3);
    const t = await buildTree(page, mid);
    await clickNode(page, t.i1);
    await pickColor(page);
    await recolorDialog(page).getByRole('button', { name: 'Recolor all', exact: true }).click();
    await deselect(page);
    await toggleOf(page, t.i1).click();
    await clickNode(page, t.i2);
    await mapButton(page, 'Delete node').click();
    await untilRaw(page, owner.boardId, (o) => {
      expect(M(o, mid).type).toBe('mindmap');
      expect(M(o, mid).nodes[t.i2]).toBeUndefined();
      expect(M(o, mid).nodes[t.i1].collapsed).toBe(true);
    });
    expect(writes).toEqual([]);
  } finally {
    await owner.close();
  }
});
