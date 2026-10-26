// Приёмка T6.7 · таблицы: TBL-01…TBL-07; попутно COL-01, CVS-07, CVS-19, MOB-06, ARCH.
// Сценарии — docs/qa/reports/T6.7.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.7.
// Наблюдение: DOM холста, документ доски глазами позднего клиента по /api/ws, второй клиент,
// внешняя «электронная таблица» — отдельная вкладка, которая кладёт в буфер и читает из него
// форматы Excel/Google Sheets (text/plain TSV, text/html <table>). Код из apps/ не импортируется.
import type { Browser, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, centerOf, obj, objectIds, onCanvas, seed, selectionBar, tool, type Box, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

// ---------- интерфейс (подписи из handoff T6.7) ----------

const tables = (page: Page) => page.locator('[data-object-id][data-type="table"]');
const tableIds = async (page: Page) => (await tables(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();
const barButton = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const cellsGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Cells', exact: true });
const cellSelect = (page: Page, label: string) => cellsGroup(page).locator('label', { hasText: new RegExp(`^${label}`) }).locator('select');
const rcGroup = (page: Page) => page.getByRole('group', { name: 'Rows and columns', exact: true });
const pasteDialog = (page: Page) => page.getByRole('dialog', { name: 'Paste table' });
const cellEditor = (page: Page) => page.getByLabel('Table cell');

type Raw = Record<string, Record<string, unknown>>;
type TableJson = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rows: string[];
  columns: string[];
  sizes: Record<string, number>;
  cells: Record<string, Record<string, unknown>>;
};

async function rawObjects(page: Page, boardId: string): Promise<Raw> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const out: Raw = {};
  doc.getMap('objects').forEach((v, k) => {
    out[k] = (v instanceof Y.Map ? v.toJSON() : v) as Record<string, unknown>;
  });
  return out;
}

async function untilRaw(page: Page, boardId: string, check: (o: Raw) => void, timeout = 15_000) {
  let last: Raw = {};
  await expect(async () => {
    last = await rawObjects(page, boardId);
    check(last);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}

/** Сетка значений таблицы из документа (строки × столбцы). */
const gridOf = (t: TableJson): string[][] => t.rows.map((r) => t.columns.map((c) => String(t.cells?.[`${r}:${c}`]?.text ?? '')));

/** Ключи ячеек таблицы на холсте: [строка][столбец] по положению элементов (как видит пользователь). */
async function domKeys(page: Page, tid: string): Promise<string[][]> {
  const cells = await obj(page, tid)
    .locator('[data-cell]')
    .evaluateAll((els) => els.map((e) => ({ key: e.getAttribute('data-cell') ?? '', top: (e as HTMLElement).offsetTop, left: (e as HTMLElement).offsetLeft })));
  const rowIds = [...new Map(cells.map((c) => [c.key.split(':')[0], c.top])).entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  const colIds = [...new Map(cells.map((c) => [c.key.split(':')[1], c.left])).entries()].sort((a, b) => a[1] - b[1]).map((e) => e[0]);
  return rowIds.map((r) => colIds.map((c) => `${r}:${c}`));
}

const cellEl = (page: Page, tid: string, key: string) => obj(page, tid).locator(`[data-cell="${key}"]`);
const cellText = (page: Page, tid: string, key: string) => cellEl(page, tid, key).locator('.table-cell-text');

async function domGrid(page: Page, tid: string): Promise<string[][]> {
  const keys = await domKeys(page, tid);
  const out: string[][] = [];
  for (const row of keys) {
    const r: string[] = [];
    for (const k of row) r.push((cellEl(page, tid, k) && (await cellEl(page, tid, k).count())) ? (await cellText(page, tid, k).innerText()).trim() : '');
    out.push(r);
  }
  return out;
}

async function clickEmpty(page: Page, p?: Point) {
  const at = p ?? (await onCanvas(page, 0.85, 0.85));
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(150);
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

/** Поставить таблицу клавишей B в точке холста; вернуть id. */
async function placeTable(page: Page, fx: number, fy: number): Promise<string> {
  const before = new Set(await tableIds(page));
  const p = await onCanvas(page, fx, fy);
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('b');
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await tableIds(page)).filter((x) => !before.has(x)).length).toBe(1);
  return (await tableIds(page)).find((x) => !before.has(x))!;
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

async function clickCell(page: Page, tid: string, key: string, modifiers: ('Shift')[] = []) {
  const b = await boxOf(cellEl(page, tid, key));
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  for (const m of modifiers) await page.keyboard.up(m);
}

/** Ввести текст в ячейку: щелчок, Enter, ввод, Escape. */
async function typeInCell(page: Page, tid: string, key: string, text: string) {
  await clickCell(page, tid, key);
  await expect(cellEl(page, tid, key)).toHaveAttribute('data-focus', 'true');
  await page.keyboard.press('Enter');
  await expect(cellEditor(page)).toBeFocused();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(cellEditor(page)).toHaveCount(0);
}

async function fillTable(page: Page, tid: string, values: string[][]) {
  const keys = await domKeys(page, tid);
  for (let r = 0; r < values.length; r++) for (let c = 0; c < values[r].length; c++) if (values[r][c]) await typeInCell(page, tid, keys[r][c], values[r][c]);
}

async function tableJson(page: Page, boardId: string, tid: string, check: (t: TableJson) => void = () => {}): Promise<TableJson> {
  const raw = await untilRaw(page, boardId, (o) => {
    expect(o[tid]).toBeTruthy();
    check(o[tid] as unknown as TableJson);
  });
  return raw[tid] as unknown as TableJson;
}

/** Перетащить таблицу за ячейку на `d` пикселей экрана. */
async function moveTable(page: Page, tid: string, key: string, d: Point) {
  await deselect(page);
  const b = await boxOf(cellEl(page, tid, key));
  const from = { x: b.x + 10, y: b.y + 10 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 6 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Точка объекта, где сверху именно он. */
async function freePointOf(page: Page, id: string): Promise<Point> {
  const b = await boxOf(obj(page, id));
  const fr = [0.5, 0.8, 0.2];
  for (const fy of fr)
    for (const fx of fr) {
      const p = { x: b.x + b.width * fx, y: b.y + b.height * fy };
      const hit = await page.evaluate(({ x, y }) => {
        const e = document.elementFromPoint(x, y);
        if (!e || e.closest('[data-handle]')) return '';
        return e.closest('[data-object-id]')?.getAttribute('data-object-id') ?? '';
      }, p);
      if (hit === id) return p;
    }
  throw new Error(`у объекта ${id} нет свободной точки`);
}

async function moveObject(page: Page, id: string, d: Point) {
  await deselect(page);
  const from = await freePointOf(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 6 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function moveCenterTo(page: Page, id: string, to: Point) {
  const c = centerOf(await boxOf(obj(page, id)));
  await moveObject(page, id, { x: to.x - c.x, y: to.y - c.y });
}

const offset = (a: Box, b: Box): Point => ({ x: a.x - b.x, y: a.y - b.y });
function near(p: Point, q: Point, tol = 3) {
  expect(Math.abs(p.x - q.x), `x: ${p.x} против ${q.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.y - q.y), `y: ${p.y} против ${q.y}`).toBeLessThanOrEqual(tol);
}

// ---------- внешняя электронная таблица (вкладка того же браузера, общий буфер) ----------

/** «Скопировать во внешней таблице»: положить в системный буфер заданные форматы. */
async function copyFromSpreadsheet(page: Page, data: Record<string, string>) {
  const ext = await page.context().newPage();
  await ext.goto('data:text/html,<!doctype html><meta charset=utf-8><div id=src>sheet</div>');
  await ext.evaluate((d) => {
    document.addEventListener('copy', (e) => {
      for (const [t, v] of Object.entries(d)) e.clipboardData!.setData(t, v);
      e.preventDefault();
    });
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('src')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(r);
  }, data);
  await ext.keyboard.press('ControlOrMeta+c');
  await ext.close();
  await page.bringToFront();
}

/** «Вставить во внешнюю таблицу»: прочитать, какие форматы лежат в системном буфере. */
async function pasteIntoSpreadsheet(page: Page): Promise<Record<string, string>> {
  const ext = await page.context().newPage();
  await ext.goto('data:text/html,<!doctype html><meta charset=utf-8><div contenteditable id=ed style="min-height:40px;border:1px solid">x</div>');
  await ext.evaluate(() => {
    (window as unknown as { got: Record<string, string> }).got = {};
    document.addEventListener('paste', (e) => {
      for (const t of e.clipboardData!.types) (window as unknown as { got: Record<string, string> }).got[t] = e.clipboardData!.getData(t);
      e.preventDefault();
    });
  });
  await ext.locator('#ed').click();
  await ext.keyboard.press('ControlOrMeta+v');
  const got = await ext.evaluate(() => (window as unknown as { got: Record<string, string> }).got);
  await ext.close();
  await page.bringToFront();
  return got;
}

/** Разбор TSV, как его читают электронные таблицы (без кавычек — значения простые). */
const parseTsv = (s: string) => s.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));

/** Разбор HTML <table> во внешней вкладке-«таблице» (DOMParser). */
async function parseHtmlTable(page: Page, html: string): Promise<string[][]> {
  return page.evaluate((h) => {
    const d = new DOMParser().parseFromString(h, 'text/html');
    const t = d.querySelector('table');
    if (!t) return [];
    return [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((td) => (td.textContent ?? '').trim()));
  }, html);
}

const toTsv = (g: string[][]) => g.map((r) => r.join('\t')).join('\n');
const toHtml = (g: string[][]) =>
  `<meta charset="utf-8"><google-sheets-html-origin><table xmlns="http://www.w3.org/1999/xhtml" cellspacing="0" cellpadding="0" dir="ltr" border="1"><colgroup><col width="100"/><col width="100"/><col width="100"/></colgroup><tbody>${g
    .map((r) => `<tr style="height:21px;">${r.map((v) => `<td style="overflow:hidden;padding:2px 3px 2px 3px;vertical-align:bottom;">${v}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;

/** Вставить на холст (Ctrl/⌘+V) под указателем в точке `p`. */
async function pasteOnCanvas(page: Page, p: Point) {
  await clickEmpty(page, p);
  await page.mouse.move(p.x + 2, p.y + 2);
  await page.keyboard.press('ControlOrMeta+v');
}

async function ownerAndGuest(browser: Browser, f: Fx) {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  return { owner, guest, opts: o };
}

const VALUES = [
  ['A1', 'B1', 'C1'],
  ['A2', 'B2', 'C2'],
  ['A3', 'B3', 'C3'],
];

// ---------- TBL-01 ----------

test('TBL-01 Table tool (All tools and key B) places a grid table that the second client sees and that survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    // из полного списка инструментов
    await pickFromAll(page, 'Table');
    const p = await onCanvas(page, 0.3, 0.3);
    await page.mouse.click(p.x, p.y);
    await expect(tables(page)).toHaveCount(1);
    const t1 = (await tableIds(page))[0];
    // клавишей B
    const t2 = await placeTable(page, 0.6, 0.65);
    for (const tid of [t1, t2]) {
      const keys = await domKeys(page, tid);
      expect(keys.length).toBeGreaterThanOrEqual(2);
      expect(keys[0].length).toBeGreaterThanOrEqual(2);
      await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(keys.length * keys[0].length);
      const t = await tableJson(page, owner.boardId, tid);
      expect(t.type).toBe('table');
      expect(t.rows.length).toBe(keys.length);
      expect(t.columns.length).toBe(keys[0].length);
      await expect(obj(guest.page, tid)).toBeVisible();
      await expect(obj(guest.page, tid).locator('[data-cell]')).toHaveCount(keys.length * keys[0].length);
    }
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(tables(page)).toHaveCount(2);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TBL-01 column width and row height change one column / row only — by border handle and by size field; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.4, 0.4);
    const t0 = await tableJson(page, owner.boardId, tid);
    const [c0, c1, c2] = t0.columns;
    const [r0, r1] = t0.rows;
    const zoom = (await boxOf(obj(page, tid))).width / t0.width;
    // перетаскивание маркера границы первого столбца и первой строки
    await clickCell(page, tid, `${r1}:${c1}`);
    const hc = await boxOf(page.locator(`[data-object-id="${tid}"] [data-handle="col:${c0}"]`));
    await page.mouse.move(hc.x + hc.width / 2, hc.y + hc.height / 2);
    await page.mouse.down();
    await page.mouse.move(hc.x + hc.width / 2 + 30, hc.y + hc.height / 2, { steps: 5 });
    await page.mouse.move(hc.x + hc.width / 2 + 60, hc.y + hc.height / 2, { steps: 5 });
    await page.mouse.up();
    const hr = await boxOf(page.locator(`[data-object-id="${tid}"] [data-handle="row:${r0}"]`));
    await page.mouse.move(hr.x + hr.width / 2, hr.y + hr.height / 2);
    await page.mouse.down();
    await page.mouse.move(hr.x + hr.width / 2, hr.y + hr.height / 2 + 20, { steps: 5 });
    await page.mouse.move(hr.x + hr.width / 2, hr.y + hr.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    const t1 = await tableJson(page, owner.boardId, tid, (t) => {
      expect(Math.abs(t.sizes[c0] - (t0.sizes[c0] + 60 / zoom))).toBeLessThanOrEqual(3);
      expect(Math.abs(t.sizes[r0] - (t0.sizes[r0] + 40 / zoom))).toBeLessThanOrEqual(3);
    });
    expect(t1.sizes[c1]).toBe(t0.sizes[c1]);
    expect(t1.sizes[c2]).toBe(t0.sizes[c2]);
    expect(t1.sizes[r1]).toBe(t0.sizes[r1]);
    // полем размера — для столбца и строки активной ячейки
    await clickCell(page, tid, `${r1}:${c1}`);
    await barButton(page, 'Rows & columns').click();
    const cw = rcGroup(page).getByLabel('Column width');
    await cw.fill('250');
    await cw.press('Enter');
    const rh = rcGroup(page).getByLabel('Row height');
    await rh.fill('90');
    await rh.press('Enter');
    const t2 = await tableJson(page, owner.boardId, tid, (t) => {
      expect(t.sizes[c1]).toBe(250);
      expect(t.sizes[r1]).toBe(90);
    });
    expect(t2.sizes[c0]).toBe(t1.sizes[c0]);
    expect(t2.sizes[c2]).toBe(t0.sizes[c2]);
    expect(t2.sizes[r0]).toBe(t1.sizes[r0]);
    // на холсте у обоих клиентов ширина ячеек соответствует
    for (const pg of [page, guest.page]) {
      await expect.poll(async () => Math.round((await boxOf(cellEl(pg, tid, `${r0}:${c1}`))).width / zoom)).toBe(250);
      await expect.poll(async () => Math.round((await boxOf(cellEl(pg, tid, `${r1}:${c0}`))).height / zoom)).toBe(90);
      await expect.poll(async () => Math.round((await boxOf(cellEl(pg, tid, `${r0}:${c2}`))).width / zoom)).toBe(t0.sizes[c2]);
    }
    await page.reload();
    await expect(cellEl(page, tid, `${r0}:${c1}`)).toBeVisible();
    expect(Math.round((await boxOf(cellEl(page, tid, `${r0}:${c1}`))).width / zoom)).toBe(250);
    // граничный: сильное уменьшение — минимальная ширина, а не ноль (наблюдение)
    await clickCell(page, tid, `${r1}:${c1}`);
    await barButton(page, 'Rows & columns').click();
    await rcGroup(page).getByLabel('Column width').fill('1');
    await rcGroup(page).getByLabel('Column width').press('Enter');
    const t3 = await tableJson(page, owner.boardId, tid, (t) => expect(t.sizes[c1]).toBeLessThan(250));
    console.log(`наблюдение TBL-01: ширина столбца после ввода 1 = ${t3.sizes[c1]}`);
    expect(t3.sizes[c1]).toBeGreaterThan(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TBL-01 rows and columns are added and deleted (including in the middle); other cells keep their values', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.35, 0.35);
    await fillTable(page, tid, VALUES);
    await tableJson(page, owner.boardId, tid, (t) => expect(gridOf(t)).toEqual(VALUES));
    const rc = async (name: string, r: number, c: number) => {
      const keys = await domKeys(page, tid);
      await clickCell(page, tid, keys[r][c]);
      if (!(await rcGroup(page).isVisible())) await barButton(page, 'Rows & columns').click();
      await rcGroup(page).getByRole('button', { name, exact: true }).click();
      await page.waitForTimeout(200);
    };
    await rc('Add row above', 1, 1);
    await tableJson(page, owner.boardId, tid, (t) => expect(gridOf(t)).toEqual([VALUES[0], ['', '', ''], VALUES[1], VALUES[2]]));
    await rc('Add column right', 0, 0);
    await tableJson(page, owner.boardId, tid, (t) =>
      expect(gridOf(t)).toEqual([
        ['A1', '', 'B1', 'C1'],
        ['', '', '', ''],
        ['A2', '', 'B2', 'C2'],
        ['A3', '', 'B3', 'C3'],
      ]),
    );
    await rc('Add row below', 3, 0);
    await rc('Add column left', 0, 0);
    await tableJson(page, owner.boardId, tid, (t) => expect(t.rows.length * 10 + t.columns.length).toBe(55));
    // удаление в середине: строка B2 и столбец «B»
    await rc('Delete row', 2, 3); // строка A2
    await rc('Delete column', 0, 3); // столбец B
    const after = [
      ['', 'A1', '', 'C1'],
      ['', '', '', ''],
      ['', 'A3', '', 'C3'],
      ['', '', '', ''],
    ];
    await tableJson(page, owner.boardId, tid, (t) => expect(gridOf(t)).toEqual(after));
    await expect.poll(() => domGrid(page, tid)).toEqual(after);
    await expect.poll(() => domGrid(guest.page, tid)).toEqual(after);
    await page.reload();
    await expect(tables(page)).toHaveCount(1);
    await expect.poll(() => domGrid(page, tid)).toEqual(after);
    // граничный: удалять до последней строки и столбца (наблюдение — последнюю удалить нельзя или таблица исчезает)
    const tryDelete = async (name: string) => {
      const keys = await domKeys(page, tid);
      await clickCell(page, tid, keys[0][0]);
      if (!(await rcGroup(page).isVisible())) await barButton(page, 'Rows & columns').click();
      const b = rcGroup(page).getByRole('button', { name, exact: true });
      if ((await b.count()) === 0 || (await b.isDisabled())) return false;
      await b.click();
      await page.waitForTimeout(200);
      return true;
    };
    const deleted = { row: 0, col: 0 };
    for (let i = 0; i < 4; i++) if (await tryDelete('Delete row')) deleted.row++;
    for (let i = 0; i < 4; i++) if (await tryDelete('Delete column')) deleted.col++;
    console.log(`наблюдение TBL-01: удалено строк ${deleted.row}/4, столбцов ${deleted.col}/4`);
    const raw = await rawObjects(page, owner.boardId);
    const t = raw[tid] as unknown as TableJson | undefined;
    console.log(`наблюдение TBL-01: после удаления всех строк/столбцов — ${t ? `${t.rows.length}×${t.columns.length}` : 'таблица удалена'}`);
    if (t) {
      expect(t.rows.length).toBeGreaterThanOrEqual(1);
      expect(t.columns.length).toBeGreaterThanOrEqual(1);
      await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(t.rows.length * t.columns.length);
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TBL-01 SHR-04 participant by link creates a table and adds a row; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const g = guest.page;
    await pickFromAll(g, 'Table');
    const p = await onCanvas(g, 0.4, 0.4);
    await g.mouse.click(p.x, p.y);
    await expect(tables(g)).toHaveCount(1);
    const tid = (await tableIds(g))[0];
    const keys = await domKeys(g, tid);
    await typeInCell(g, tid, keys[0][0], 'guest');
    await clickCell(g, tid, keys[0][0]);
    await barButton(g, 'Rows & columns').click();
    await rcGroup(g).getByRole('button', { name: 'Add row below', exact: true }).click();
    await expect(obj(owner.page, tid).locator('[data-cell]')).toHaveCount((keys.length + 1) * keys[0].length);
    await expect(obj(owner.page, tid)).toContainText('guest');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TBL-02 ----------

test('TBL-02 cell text color, emphasis, horizontal and vertical alignment apply to selected cells only; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const apiCalls: string[] = [];
    const tid = await placeTable(page, 0.35, 0.35);
    await fillTable(page, tid, VALUES);
    const k = await domKeys(page, tid);
    // высота строки больше текста — чтобы вертикальное выравнивание было видно
    await clickCell(page, tid, k[1][1]);
    await barButton(page, 'Rows & columns').click();
    await rcGroup(page).getByLabel('Row height').fill('120');
    await rcGroup(page).getByLabel('Row height').press('Enter');
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/ws')) apiCalls.push(`${r.method()} ${u.pathname}`);
    });
    // B2 и C2 (Shift+щелчок — диапазон)
    await clickCell(page, tid, k[1][1]);
    await clickCell(page, tid, k[1][2], ['Shift']);
    await expect(obj(page, tid).locator('[data-cell][data-selected="true"]')).toHaveCount(2);
    await cellSelect(page, 'Text color').selectOption({ label: 'Pink' });
    await cellSelect(page, 'Style').selectOption({ label: 'Bold' });
    await cellSelect(page, 'Align').selectOption({ label: 'Center' });
    await cellSelect(page, 'Vertical align').selectOption({ label: 'Bottom' });
    await page.waitForTimeout(300);

    const look = (pg: Page, key: string) =>
      cellEl(pg, tid, key).evaluate((el) => {
        const txt = el.querySelector('.table-cell-text') as HTMLElement;
        const cs = getComputedStyle(txt);
        const cb = el.getBoundingClientRect();
        const tb = txt.getBoundingClientRect();
        return {
          color: cs.color,
          weight: cs.fontWeight,
          align: getComputedStyle(el).textAlign,
          // вертикальное положение текста в ячейке: доля свободного места сверху
          vpos: Math.round(((tb.top - cb.top) / Math.max(1, cb.height - tb.height)) * 10) / 10,
          hpos: Math.round(((tb.left - cb.left) / Math.max(1, cb.width - tb.width)) * 10) / 10,
          geo: `${cb.top}/${cb.height} ${tb.top}/${tb.height} ${el.getAttribute('style')}`,
        };
      });
    const check = async (pg: Page, a2Top = true) => {
      for (const key of [k[1][1], k[1][2]]) {
        await expect.poll(async () => (await look(pg, key)).color).toBe('rgb(244, 143, 177)');
        const l = await look(pg, key);
        expect(Number(l.weight)).toBeGreaterThanOrEqual(600);
        expect(l.align).toBe('center');
        expect(l.vpos).toBeGreaterThanOrEqual(0.8);
      }
      // соседние ячейки — без изменений
      for (const key of [k[1][0], k[0][1], k[2][1]]) {
        const l = await look(pg, key);
        expect(l.color).not.toBe('rgb(244, 143, 177)');
        expect(Number(l.weight)).toBeLessThan(600);
        expect(l.align).not.toBe('center');
      }
      const a2 = await look(pg, k[1][0]);
      if (a2Top) expect(a2.vpos, a2.geo).toBeLessThanOrEqual(0.2);
    };
    await check(page);
    await check(guest.page);
    // остальные варианты выравнивания и начертания
    await clickCell(page, tid, k[0][0]);
    await cellSelect(page, 'Align').selectOption({ label: 'Right' });
    await cellSelect(page, 'Style').selectOption({ label: 'Italic' });
    await clickCell(page, tid, k[1][0]);
    await cellSelect(page, 'Vertical align').selectOption({ label: 'Middle' });
    await expect.poll(async () => (await look(page, k[0][0])).align).toBe('right');
    expect(await cellText(page, tid, k[0][0]).evaluate((e) => getComputedStyle(e).fontStyle)).toBe('italic');
    await expect.poll(async () => (await look(page, k[1][0])).vpos).toBe(0.5);
    await clickCell(page, tid, k[2][2]);
    await cellSelect(page, 'Style').selectOption({ label: 'Underline' });
    await expect.poll(() => cellText(page, tid, k[2][2]).evaluate((e) => {
      let s = '';
      for (let x: Element | null = e; x; x = x.parentElement) s += getComputedStyle(x).textDecorationLine;
      return s.includes('underline');
    })).toBe(true);
    // Q-005 (а): «выделение» — начертание, включая зачёркнутый
    await clickCell(page, tid, k[0][2]);
    await cellSelect(page, 'Style').selectOption({ label: 'Strikethrough' });
    await expect.poll(() => cellText(page, tid, k[0][2]).evaluate((e) => {
      let s = '';
      for (let x: Element | null = e; x; x = x.parentElement) s += getComputedStyle(x).textDecorationLine;
      return s.includes('line-through');
    })).toBe(true);
    await page.reload();
    await expect(tables(page)).toHaveCount(1);
    await check(page, false);
    // ARCH: оформление ячеек — без HTTP к /api (только канал sync)
    expect(apiCalls.filter((c) => !c.startsWith('GET'))).toEqual([]);
    // «Выделение» как подсветка текста (фон под текстом) — наблюдение для вопроса владельцу
    await clickCell(page, tid, k[0][0]);
    console.log(`наблюдение TBL-02: средство подсветки текста в ячейке — ${(await cellsGroup(page).locator('label', { hasText: /highlight/i }).count()) ? 'есть' : 'нет'}; начертания: ${(await cellSelect(page, 'Style').locator('option').allInnerTexts()).join(', ')}`);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TBL-03 ----------

test('TBL-03 cells are filled with color and a 2×2 range is merged into one cell; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.35, 0.35);
    await fillTable(page, tid, VALUES);
    const k = await domKeys(page, tid);
    const bg = (pg: Page, key: string) => cellEl(pg, tid, key).evaluate((e) => getComputedStyle(e).backgroundColor);
    const plain = await bg(page, k[2][2]);
    // заливка одной ячейки и диапазона
    await clickCell(page, tid, k[2][2]);
    await cellSelect(page, 'Cell fill').selectOption({ label: 'Blue' });
    await clickCell(page, tid, k[0][0]);
    await clickCell(page, tid, k[0][1], ['Shift']);
    await cellSelect(page, 'Cell fill').selectOption({ label: 'Green' });
    for (const pg of [page, guest.page]) {
      await expect.poll(() => bg(pg, k[2][2])).toBe('rgb(129, 212, 250)');
      await expect.poll(() => bg(pg, k[0][0])).toBe('rgb(165, 214, 167)');
      await expect.poll(() => bg(pg, k[0][1])).toBe('rgb(165, 214, 167)');
      expect(await bg(pg, k[1][1])).toBe(plain);
    }
    // одна ячейка: объединять нечего
    await clickCell(page, tid, k[1][1]);
    const mergeOne = barButton(page, 'Merge cells');
    const mergeOneState = (await mergeOne.count()) === 0 ? 'нет кнопки' : (await mergeOne.isDisabled()) ? 'недоступна' : 'доступна';
    console.log(`наблюдение TBL-03: Merge cells при одной ячейке — ${mergeOneState}`);
    if (mergeOneState === 'доступна') {
      await mergeOne.click();
      await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(9);
    }
    // объединение B2:C3 (с текстом)
    const zoom = (await boxOf(obj(page, tid))).width / (await tableJson(page, owner.boardId, tid)).width;
    const sumW = (await boxOf(cellEl(page, tid, k[1][1]))).width + (await boxOf(cellEl(page, tid, k[1][2]))).width;
    const sumH = (await boxOf(cellEl(page, tid, k[1][1]))).height + (await boxOf(cellEl(page, tid, k[2][1]))).height;
    await clickCell(page, tid, k[1][1]);
    await clickCell(page, tid, k[2][2], ['Shift']);
    await expect(obj(page, tid).locator('[data-cell][data-selected="true"]')).toHaveCount(4);
    await barButton(page, 'Merge cells').click();
    for (const pg of [page, guest.page]) {
      await expect(obj(pg, tid).locator('[data-cell]')).toHaveCount(6);
      const m = await boxOf(cellEl(pg, tid, k[1][1]));
      expect(Math.abs(m.width - sumW)).toBeLessThanOrEqual(2);
      expect(Math.abs(m.height - sumH)).toBeLessThanOrEqual(2);
      expect(zoom).toBeGreaterThan(0);
    }
    const t = await tableJson(page, owner.boardId, tid);
    const merged = String(t.cells[k[1][1]]?.text ?? '');
    console.log(`наблюдение TBL-03: текст объединённой ячейки — ${JSON.stringify(merged)}`);
    expect(merged).toContain('B2');
    // строки и столбцы вне объединения не задеты
    await expect(cellText(page, tid, k[0][2])).toHaveText('C1');
    await expect(cellText(page, tid, k[2][0])).toHaveText('A3');
    await page.reload();
    await expect(tables(page)).toHaveCount(1);
    await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(6);
    expect(await bg(page, k[0][0])).toBe('rgb(165, 214, 167)');
    // разъединение — наблюдение (требованием не названо)
    await clickCell(page, tid, k[1][1]);
    if (await barButton(page, 'Unmerge cells').count()) {
      await barButton(page, 'Unmerge cells').click();
      await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(9);
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TBL-04 ----------

test('TBL-04 arrow keys move between cells; typing goes to the new cell; at the edge the focus stays and nothing moves', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.35, 0.35);
    const k = await domKeys(page, tid);
    const focusKey = () => obj(page, tid).locator('[data-cell][data-focus="true"]').getAttribute('data-cell');
    await clickCell(page, tid, k[0][0]);
    await expect.poll(focusKey).toBe(k[0][0]);
    const box0 = await boxOf(obj(page, tid));
    // край: влево и вверх из A1 — остаёмся, таблица и вид не двигаются
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await expect.poll(focusKey).toBe(k[0][0]);
    near(await boxOf(obj(page, tid)), box0, 1);
    await page.keyboard.press('ArrowRight');
    await expect.poll(focusKey).toBe(k[0][1]);
    await page.keyboard.press('ArrowDown');
    await expect.poll(focusKey).toBe(k[1][1]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focusKey).toBe(k[2][2]);
    near(await boxOf(obj(page, tid)), box0, 1);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    await expect.poll(focusKey).toBe(k[1][1]);
    // ввод попадает в активную ячейку
    await page.keyboard.press('Enter');
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('mid');
    // в режиме ввода стрелка на краю текста переводит в соседнюю ячейку
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('right');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.type('down');
    await page.keyboard.press('Escape');
    await tableJson(page, owner.boardId, tid, (t) =>
      expect(gridOf(t)).toEqual([
        ['', '', ''],
        ['', 'mid', 'right'],
        ['', '', 'down'],
      ]),
    );
    // стрелки после выхода из ввода снова ходят по ячейкам, а не двигают вид
    await expect.poll(focusKey).toBe(k[2][2]);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect.poll(focusKey).toBe(k[2][2]);
    near(await boxOf(obj(page, tid)), box0, 1);
  } finally {
    await owner.close();
  }
});

// ---------- TBL-05 ----------

const STK: Obj = { type: 'sticky', x: 40, y: 380, width: 80, height: 80, text: 'in cell' } as Obj;
const OUTS: Obj = { type: 'sticky', x: 300, y: 380, width: 80, height: 80, text: 'outside' } as Obj;

test('TBL-05 a sticky dropped into a cell becomes its child and moves with the table; outside objects stay; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.45, 0.3);
    await seed(page, owner.boardId, { 'qa-stk': STK, 'qa-out': OUTS });
    const k = await domKeys(page, tid);
    // строка повыше, чтобы стикер помещался в ячейку
    await clickCell(page, tid, k[1][1]);
    await barButton(page, 'Rows & columns').click();
    await rcGroup(page).getByLabel('Row height').fill('140');
    await rcGroup(page).getByLabel('Row height').press('Enter');
    await deselect(page);
    await moveCenterTo(page, 'qa-stk', centerOf(await boxOf(cellEl(page, tid, k[1][1]))));
    const raw = await untilRaw(page, owner.boardId, (o) => expect(o['qa-stk']?.parent).toBe(tid));
    expect(raw['qa-stk'].cell).toBe(k[1][1]);
    console.log(`наблюдение ARCH: ребёнок ячейки — parent=${String(raw['qa-stk'].parent)}, cell=${String(raw['qa-stk'].cell)}, x=${String(raw['qa-stk'].x)}, y=${String(raw['qa-stk'].y)}`);
    const rel0 = offset(await boxOf(obj(page, 'qa-stk')), await boxOf(cellEl(page, tid, k[1][1])));
    const out0 = await boxOf(obj(page, 'qa-out'));
    const g0 = offset(await boxOf(obj(guest.page, 'qa-stk')), await boxOf(cellEl(guest.page, tid, k[1][1])));
    near(g0, rel0);
    // сдвиг таблицы: стикер едет, внешний стоит
    await moveTable(page, tid, k[0][0], { x: 90, y: 60 });
    const t1 = await tableJson(page, owner.boardId, tid);
    expect(t1).toBeTruthy();
    near(offset(await boxOf(obj(page, 'qa-stk')), await boxOf(cellEl(page, tid, k[1][1]))), rel0);
    near(await boxOf(obj(page, 'qa-out')), out0, 1);
    await expect
      .poll(async () => {
        const d = offset(await boxOf(obj(guest.page, 'qa-stk')), await boxOf(cellEl(guest.page, tid, k[1][1])));
        return Math.abs(d.x - g0.x) + Math.abs(d.y - g0.y);
      })
      .toBeLessThanOrEqual(4);
    // локальные координаты ребёнка не меняются при сдвиге таблицы
    const raw2 = await untilRaw(page, owner.boardId, (o) => expect(o['qa-stk']?.parent).toBe(tid));
    expect(raw2['qa-stk'].x).toBe(raw['qa-stk'].x);
    expect(raw2['qa-stk'].y).toBe(raw['qa-stk'].y);
    // граничный: столбец слева шире — стикер остаётся в своей ячейке
    await clickCell(page, tid, k[1][0]);
    await barButton(page, 'Rows & columns').click();
    await rcGroup(page).getByLabel('Column width').fill('260');
    await rcGroup(page).getByLabel('Column width').press('Enter');
    await deselect(page);
    await expect
      .poll(async () => {
        const d = offset(await boxOf(obj(page, 'qa-stk')), await boxOf(cellEl(page, tid, k[1][1])));
        return Math.abs(d.x - rel0.x) + Math.abs(d.y - rel0.y);
      })
      .toBeLessThanOrEqual(4);
    // перезагрузка
    await page.reload();
    await expect(obj(page, 'qa-stk')).toBeVisible();
    near(offset(await boxOf(obj(page, 'qa-stk')), await boxOf(cellEl(page, tid, k[1][1]))), rel0);
    // вынесенный стикер перестаёт ехать
    const outside = await boxOf(obj(page, 'qa-out'));
    await moveCenterTo(page, 'qa-stk', { x: outside.x + outside.width / 2 + 160, y: outside.y + outside.height / 2 });
    await untilRaw(page, owner.boardId, (o) => expect(o['qa-stk']?.parent ?? null).toBeNull());
    const free = await boxOf(obj(page, 'qa-stk'));
    await moveTable(page, tid, k[0][0], { x: -60, y: 40 });
    near(await boxOf(obj(page, 'qa-stk')), free, 1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TBL-05 SHR-04 participant by link puts a sticky into a cell and moves the table; the owner sees the sticky follow', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const g = guest.page;
    const tid = await placeTable(owner.page, 0.45, 0.3);
    await seed(owner.page, owner.boardId, { 'qa-stk': { ...STK, width: 40, height: 40 } as Obj });
    await expect(obj(g, tid)).toBeVisible();
    await expect(obj(g, 'qa-stk')).toBeVisible();
    const k = await domKeys(g, tid);
    await moveCenterTo(g, 'qa-stk', centerOf(await boxOf(cellEl(g, tid, k[2][2]))));
    await untilRaw(owner.page, owner.boardId, (o) => expect(o['qa-stk']?.parent).toBe(tid));
    const rel = offset(await boxOf(obj(owner.page, 'qa-stk')), await boxOf(cellEl(owner.page, tid, k[2][2])));
    await moveTable(g, tid, k[0][0], { x: 80, y: 50 });
    await untilRaw(owner.page, owner.boardId, () => {});
    await expect
      .poll(async () => {
        const d = offset(await boxOf(obj(owner.page, 'qa-stk')), await boxOf(cellEl(owner.page, tid, k[2][2])));
        return Math.abs(d.x - rel.x) + Math.abs(d.y - rel.y);
      })
      .toBeLessThanOrEqual(4);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TBL-06 ----------

test('TBL-06 copying a table puts a spreadsheet grid on the clipboard (TSV and HTML table), empty cells in place', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.35, 0.35);
    const values = [
      ['Name', 'Qty', 'Note'],
      ['Apple', '', 'red'],
      ['', '5', ''],
    ];
    await fillTable(page, tid, values);
    await tableJson(page, owner.boardId, tid, (t) => expect(gridOf(t)).toEqual(values));
    // выделить таблицу целиком (без ячеек) и копировать
    await clickCell(page, tid, (await domKeys(page, tid))[0][0]);
    await page.keyboard.press('Escape');
    await expect(obj(page, tid)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+c');
    const got = await pasteIntoSpreadsheet(page);
    console.log(`наблюдение TBL-06: форматы буфера — ${Object.keys(got).join(', ')}`);
    expect(got['text/plain']).toBeTruthy();
    expect(parseTsv(got['text/plain'])).toEqual(values);
    expect(got['text/html']).toContain('<table');
    expect(await parseHtmlTable(page, got['text/html'])).toEqual(values);
  } finally {
    await owner.close();
  }
});

test('TBL-06 a spreadsheet pasted from Excel (TSV) or Google Sheets (HTML) becomes a table with the same grid; the second client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const excel = [
      ['City', 'Pop', 'Year'],
      ['Oslo', '709000', ''],
      ['Rome', '', '2024'],
      ['', 'x', 'y'],
    ];
    // Excel: TSV с CRLF и завершающим переводом строки, плюс HTML
    await copyFromSpreadsheet(page, { 'text/plain': excel.map((r) => r.join('\t')).join('\r\n') + '\r\n', 'text/html': toHtml(excel) });
    await pasteOnCanvas(page, await onCanvas(page, 0.35, 0.35));
    await expect(pasteDialog(page)).toBeVisible();
    await pasteDialog(page).getByRole('button', { name: 'Table', exact: true }).click();
    await expect(pasteDialog(page)).toHaveCount(0);
    await expect(tables(page)).toHaveCount(1);
    const t1 = (await tableIds(page))[0];
    await tableJson(page, owner.boardId, t1, (t) => expect(gridOf(t)).toEqual(excel));
    await expect.poll(() => domGrid(guest.page, t1)).toEqual(excel);
    // в видимой области
    const cv = await boxOf(canvas(page));
    const tb = await boxOf(obj(page, t1));
    expect(tb.x + tb.width > cv.x && tb.x < cv.x + cv.width && tb.y + tb.height > cv.y && tb.y < cv.y + cv.height).toBe(true);
    // Google Sheets: только HTML <table>
    const sheet = [
      ['k', 'v'],
      ['a', '1'],
    ];
    await copyFromSpreadsheet(page, { 'text/html': toHtml(sheet) });
    await pasteOnCanvas(page, await onCanvas(page, 0.75, 0.7));
    await expect(pasteDialog(page)).toBeVisible();
    await pasteDialog(page).getByRole('button', { name: 'Table', exact: true }).click();
    await expect(tables(page)).toHaveCount(2);
    const t2 = (await tableIds(page)).find((x) => x !== t1)!;
    await tableJson(page, owner.boardId, t2, (t) => expect(gridOf(t)).toEqual(sheet));
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TBL-06 round trip: board table → external spreadsheet → board keeps the data grid', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.3, 0.3);
    const values = [
      ['x', '', 'z'],
      ['', 'mid', ''],
      ['1', '2', '3'],
    ];
    await fillTable(page, tid, values);
    await clickCell(page, tid, (await domKeys(page, tid))[0][0]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+c');
    const got = await pasteIntoSpreadsheet(page);
    // внешняя таблица кладёт обратно только свои форматы (без внутреннего формата доски)
    const formats: Record<string, string>[] = [{ 'text/plain': got['text/plain'] }, { 'text/html': got['text/html'] }];
    for (const fmt of formats) {
      const before = new Set(await tableIds(page));
      await copyFromSpreadsheet(page, fmt);
      await pasteOnCanvas(page, await onCanvas(page, 0.7, 0.7));
      await expect(pasteDialog(page)).toBeVisible();
      await pasteDialog(page).getByRole('button', { name: 'Table', exact: true }).click();
      await expect.poll(async () => (await tableIds(page)).filter((x) => !before.has(x)).length).toBe(1);
      const nid = (await tableIds(page)).find((x) => !before.has(x))!;
      await tableJson(page, owner.boardId, nid, (t) => expect(gridOf(t)).toEqual(values));
    }
  } finally {
    await owner.close();
  }
});

test('TBL-06 boundaries: quoted cell with a newline (Excel), plain text without tabs pastes as text without the table dialog', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await copyFromSpreadsheet(page, { 'text/plain': 'a\t"line1\nline2"\r\nb\tc\r\n' });
    await pasteOnCanvas(page, await onCanvas(page, 0.35, 0.35));
    await expect(pasteDialog(page)).toBeVisible();
    await pasteDialog(page).getByRole('button', { name: 'Table', exact: true }).click();
    await expect(tables(page)).toHaveCount(1);
    const tid = (await tableIds(page))[0];
    const t = await tableJson(page, owner.boardId, tid);
    console.log(`наблюдение TBL-06: кавычки Excel — ${JSON.stringify(gridOf(t))}`);
    expect(gridOf(t)).toEqual([
      ['a', 'line1\nline2'],
      ['b', 'c'],
    ]);
    // обычный текст — без диалога, не таблица
    const before = new Set(await objectIds(page));
    await copyFromSpreadsheet(page, { 'text/plain': 'just a line' });
    await pasteOnCanvas(page, await onCanvas(page, 0.7, 0.75));
    await expect.poll(async () => (await objectIds(page)).filter((x) => !before.has(x)).length).toBe(1);
    await expect(pasteDialog(page)).toHaveCount(0);
    await expect(tables(page)).toHaveCount(1);
  } finally {
    await owner.close();
  }
});

test('TBL-06 SHR-04 participant by link pastes an external spreadsheet as a table', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const g = guest.page;
    const grid = [
      ['g1', 'g2'],
      ['g3', 'g4'],
    ];
    await copyFromSpreadsheet(g, { 'text/plain': toTsv(grid) });
    await pasteOnCanvas(g, await onCanvas(g, 0.4, 0.4));
    await pasteDialog(g).getByRole('button', { name: 'Table', exact: true }).click();
    await expect(tables(owner.page)).toHaveCount(1);
    const tid = (await tableIds(owner.page))[0];
    await expect.poll(() => domGrid(owner.page, tid)).toEqual(grid);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TBL-07 ----------

test('TBL-07 on paste the user chooses sticky notes: one sticky per value with its text, no table; second client sees them', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const grid = [
      ['Idea', 'Risk', 'Owner'],
      ['', 'Plan', 'Ann'],
    ];
    const before = new Set(await objectIds(page));
    await copyFromSpreadsheet(page, { 'text/plain': toTsv(grid), 'text/html': toHtml(grid) });
    await pasteOnCanvas(page, await onCanvas(page, 0.4, 0.4));
    await expect(pasteDialog(page)).toBeVisible();
    await expect(pasteDialog(page).getByRole('button', { name: 'Table', exact: true })).toBeVisible();
    await pasteDialog(page).getByRole('button', { name: 'Sticky notes', exact: true }).click();
    await expect(pasteDialog(page)).toHaveCount(0);
    await expect.poll(async () => (await objectIds(page)).filter((x) => !before.has(x)).length).toBe(5);
    await expect(tables(page)).toHaveCount(0);
    const raw = await untilRaw(page, owner.boardId, (o) => expect(Object.keys(o).length).toBe(5));
    const stickies = Object.values(raw);
    expect(stickies.every((s) => s.type === 'sticky')).toBe(true);
    expect(stickies.map((s) => String(s.text)).sort()).toEqual(['Ann', 'Idea', 'Owner', 'Plan', 'Risk']);
    // раскладка сеткой (наблюдение): Idea левее Risk, Risk выше Plan
    const by = (t: string) => stickies.find((s) => s.text === t)!;
    console.log(`наблюдение TBL-07: раскладка ${stickies.map((s) => `${String(s.text)}@${String(s.x)},${String(s.y)}`).join(' ')}`);
    expect(Number(by('Idea').x)).toBeLessThan(Number(by('Risk').x));
    expect(Number(by('Risk').y)).toBeLessThan(Number(by('Plan').y));
    for (const id of Object.keys(raw)) await expect(obj(guest.page, id)).toBeVisible();
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TBL-07 Cancel in the paste choice inserts nothing; choosing Table still gives a table', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await copyFromSpreadsheet(page, { 'text/plain': 'a\tb\nc\td' });
    await pasteOnCanvas(page, await onCanvas(page, 0.4, 0.4));
    await pasteDialog(page).getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.waitForTimeout(600);
    expect(await objectIds(page)).toEqual([]);
    await pasteOnCanvas(page, await onCanvas(page, 0.4, 0.4));
    await pasteDialog(page).getByRole('button', { name: 'Table', exact: true }).click();
    await expect(tables(page)).toHaveCount(1);
    expect((await objectIds(page)).length).toBe(1);
  } finally {
    await owner.close();
  }
});

// ---------- попутно ----------

test('COL-01 two clients edit different cells of one table at the same time; both edits survive on both', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const tid = await placeTable(owner.page, 0.35, 0.35);
    await expect(obj(guest.page, tid)).toBeVisible();
    const k = await domKeys(owner.page, tid);
    await clickCell(owner.page, tid, k[0][0]);
    await clickCell(guest.page, tid, k[2][2]);
    await owner.page.keyboard.press('Enter');
    await guest.page.keyboard.press('Enter');
    await Promise.all([owner.page.keyboard.type('owner text', { delay: 30 }), guest.page.keyboard.type('guest text', { delay: 30 })]);
    await owner.page.keyboard.press('Escape');
    await guest.page.keyboard.press('Escape');
    for (const pg of [owner.page, guest.page]) {
      await expect(cellText(pg, tid, k[0][0])).toHaveText('owner text');
      await expect(cellText(pg, tid, k[2][2])).toHaveText('guest text');
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 undo reverts adding a row and a cell edit; CVS-19 a locked table does not move', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const tid = await placeTable(page, 0.35, 0.35);
    const k = await domKeys(page, tid);
    await typeInCell(page, tid, k[0][0], 'keep');
    await typeInCell(page, tid, k[1][1], 'undo me');
    await clickCell(page, tid, k[1][1]);
    await barButton(page, 'Rows & columns').click();
    await rcGroup(page).getByRole('button', { name: 'Add row below', exact: true }).click();
    await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(12);
    await clickCell(page, tid, k[0][0]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(obj(page, tid).locator('[data-cell]')).toHaveCount(9);
    await page.keyboard.press('ControlOrMeta+z');
    await tableJson(page, owner.boardId, tid, (t) => expect(gridOf(t)[1][1]).toBe(''));
    await expect(cellText(page, tid, k[0][0])).toHaveText('keep');
    // блокировка
    await clickCell(page, tid, k[0][0]);
    await page.keyboard.press('Escape');
    await barButton(page, 'Lock').click();
    const b0 = await boxOf(obj(page, tid));
    await moveTable(page, tid, k[1][1], { x: 80, y: 60 });
    near(await boxOf(obj(page, tid)), b0, 1);
  } finally {
    await owner.close();
  }
});

test('MOB-06 on a phone a table is placed by tap and a cell is edited', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickFromAll(page, 'Table', true);
    const p = await onCanvas(page, 0.5, 0.4);
    await page.touchscreen.tap(p.x, p.y);
    await expect(tables(page)).toHaveCount(1);
    const tid = (await tableIds(page))[0];
    const k = await domKeys(page, tid);
    const c = await boxOf(cellEl(page, tid, k[0][0]));
    await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
    await expect(cellEl(page, tid, k[0][0])).toHaveAttribute('data-focus', 'true');
    await barButton(page, 'Edit cell').tap();
    await expect(cellEditor(page)).toBeFocused();
    await page.keyboard.type('phone');
    await page.keyboard.press('Escape');
    await tableJson(page, owner.boardId, tid, (t) => expect(gridOf(t)[0][0]).toBe('phone'));
  } finally {
    await owner.close();
  }
});
