// Приёмка T6.3 · фигуры и BPMN: SHP-01…SHP-04 (+ COL-01, CVS-07, UI-01…04 новых элементов, ARCH).
// Сценарии — docs/qa/reports/T6.3.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.3.
// Наблюдение: DOM холста (контур SVG фигуры, вычисленные стили), документ доски глазами позднего клиента
// по /api/ws, второй клиент. Код из apps/ не импортируется.
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, viewBar, type Opts, type Point } from './camera';
import { boxOf, centerOf, obj, objectIds, onCanvas, selectionBar, tool, tools } from './scene';
import { hsl, hueDist, rgba, signature, transparent } from './ui';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');
const optsOf = (f: Fx) => profileOpts(f);
const guestOf = (browser: Browser, o: Opts, token: string, name = 'QA Guest') => openGuest(browser, o, token, name);

test.beforeEach(() => test.setTimeout(240_000));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Object text' });
const shapesBar = (page: Page) => page.getByRole('toolbar', { name: 'Shapes' });
const setTab = (page: Page, name: string) => shapesBar(page).getByRole('tablist', { name: 'Shape sets' }).getByRole('tab', { name, exact: true });
const kindBtn = (page: Page, name: string) => shapesBar(page).getByRole('tabpanel').getByRole('button', { name, exact: true });
const combo = (page: Page, name: string) => selectionBar(page).getByRole('combobox', { name, exact: true });
const customGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Custom color' });
const styleGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Text style' });
const stickyPalette = (page: Page) => page.getByRole('toolbar', { name: 'Sticky note color' });
const outline = (page: Page, id: string) => obj(page, id).getByTestId('shape-outline').locator('path').first();
const marker = (page: Page, id: string) => obj(page, id).getByTestId('shape-marker');

// Минимальный состав наборов (сценарии T6.3, до чтения handoff)
const MIN_SETS: Record<string, string[]> = {
  Basic: ['Rectangle', 'Ellipse', 'Triangle', 'Diamond'],
  Callouts: [],
  Flowchart: ['Process', 'Decision', 'Terminator', 'Data'],
  BPMN: ['Task', 'Start event', 'Intermediate event', 'End event', 'Gateway'],
};

async function press(l: Locator, isMobile: boolean) {
  if (isMobile) await l.tap();
  else await l.click();
}

async function waitNew(page: Page, before: Set<string>): Promise<string> {
  let id = '';
  await expect(async () => {
    id = (await objectIds(page)).find((x) => !before.has(x)) ?? '';
    expect(id, 'новый объект на холсте').not.toBe('');
  }).toPass({ timeout: 5000 });
  return id;
}

async function exitEdit(page: Page) {
  for (let i = 0; i < 3 && (await editor(page).isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await expect(editor(page)).toBeHidden();
}

/** Открыть выбор фигур инструментом Shape и вкладку набора. */
async function openSet(page: Page, set: string, isMobile = false) {
  if (!(await shapesBar(page).isVisible())) await press(tool(page, 'Shape'), isMobile);
  await expect(shapesBar(page)).toBeVisible();
  await press(setTab(page, set), isMobile);
  await expect(setTab(page, set)).toHaveAttribute('aria-selected', 'true');
}

/** Поставить фигуру вида `kind` из набора `set` щелчком/касанием в точку `p`; id новой фигуры. */
async function placeShape(page: Page, set: string, kind: string, p: Point, isMobile = false): Promise<string> {
  const before = new Set(await objectIds(page));
  await openSet(page, set, isMobile);
  await press(kindBtn(page, kind), isMobile);
  await expect(kindBtn(page, kind)).toHaveAttribute('aria-pressed', 'true');
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  const id = await waitNew(page, before);
  if (await editor(page).isVisible()) await exitEdit(page);
  return id;
}

async function placeAt(page: Page, set: string, kind: string, fx: number, fy: number, isMobile = false) {
  return placeShape(page, set, kind, await onCanvas(page, fx, fy), isMobile);
}

/** Снять выделение: Escape, иначе щелчок по пустому низу холста (между выбором фигур и миникартой). */
async function clickEmpty(page: Page) {
  const sel = page.locator('[data-object-id][aria-selected="true"]');
  if (await editor(page).isVisible()) await exitEdit(page);
  if (await sel.count()) await page.keyboard.press('Escape');
  if (await sel.count()) {
    const p = await onCanvas(page, 0.62, 0.97);
    await page.mouse.click(p.x, p.y);
  }
  await expect(sel).toHaveCount(0);
}

async function selectObj(page: Page, id: string) {
  const b = await boxOf(obj(page, id));
  await page.mouse.click(b.x + b.width / 2, b.y + Math.min(b.height / 2, 14) + 2);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

async function setSel(page: Page, label: string, option: string) {
  let field = combo(page, label);
  if (!(await field.isVisible())) {
    const toggle = selectionBar(page).getByRole('button', { name: 'Text style', exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    field = styleGroup(page).getByRole('combobox', { name: label, exact: true });
  }
  await field.selectOption({ label: option });
}

async function zoomOut(page: Page, times: number) {
  for (let i = 0; i < times; i++) await viewBar(page).getByRole('button', { name: 'Zoom out' }).click();
  await page.waitForTimeout(300);
}

/** Контур фигуры: `d`, заливка, обводка, толщина. */
async function outlineOf(page: Page, id: string) {
  return outline(page, id).evaluate((p) => ({
    d: p.getAttribute('d') ?? '',
    fill: (p.getAttribute('fill') ?? '').toLowerCase(),
    stroke: (p.getAttribute('stroke') ?? '').toLowerCase(),
    strokeWidth: Number(p.getAttribute('stroke-width') ?? 'NaN'),
    computedFill: getComputedStyle(p).fill,
  }));
}

/** Весь рисунок фигуры (все линии контура и значки маркера) без цветов — «своя форма» вида. */
async function lookOf(page: Page, id: string): Promise<string> {
  return obj(page, id).evaluate((e) =>
    Array.from(e.querySelectorAll('svg path, svg circle, svg ellipse, svg rect, svg line, svg polyline, svg polygon'))
      .map((n) => `${n.tagName}:${['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'points', 'x1', 'y1', 'x2', 'y2', 'stroke-width', 'stroke-dasharray'].map((a) => n.getAttribute(a) ?? '').join(',')}`)
      .join(';'),
  );
}

type DocObj = { fields: Record<string, unknown>; text: string };
async function docObject(page: Page, boardId: string, id: string): Promise<DocObj | null> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const o = doc.getMap('objects').get(id);
  if (!(o instanceof Y.Map)) return null;
  const t = o.get('text');
  return { fields: o.toJSON() as Record<string, unknown>, text: t instanceof Y.Text ? t.toString() : String(t ?? '') };
}

async function untilObject(page: Page, boardId: string, id: string, check: (o: DocObj) => void) {
  await expect(async () => {
    const o = await docObject(page, boardId, id);
    expect(o, `объект ${id} в документе`).not.toBeNull();
    check(o!);
  }).toPass({ timeout: 15_000, intervals: [300, 600, 1000] });
}

/** Значения недавних своих цветов во всех списках цветов панели Selection. */
async function recentInSelection(page: Page): Promise<string[]> {
  const vals = await selectionBar(page)
    .locator('optgroup[label="Recent colors"] option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value.toLowerCase()));
  return [...new Set(vals)];
}

/** Недавние свои цвета в конкретном списке Selection (по порядку). */
async function recentIn(page: Page, label: string): Promise<string[]> {
  return combo(page, label)
    .locator('optgroup[label="Recent colors"] option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value.toLowerCase()));
}

/** Недавние свои цвета в палитре стикеров. */
async function recentInStickyPalette(page: Page): Promise<string[]> {
  const names = await stickyPalette(page).getByRole('button', { name: /^Custom #/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''));
  return names.map((n) => n.replace(/^Custom /, '').trim().toLowerCase());
}

/** Задать свой цвет полем группы Custom color (`Custom fill`, `Custom border`, `Custom text color`, `Custom background`). */
async function customColor(page: Page, field: string, hex: string) {
  const toggle = selectionBar(page).getByRole('button', { name: 'Custom color', exact: true });
  if (!(await customGroup(page).isVisible())) {
    await toggle.click();
    await expect(customGroup(page)).toBeVisible();
  }
  await customGroup(page).getByLabel(field, { exact: true }).fill(hex);
}

/** Текстовый блок с текстом инструментом Text. */
async function placeText(page: Page, fx: number, fy: number, text: string): Promise<string> {
  const before = new Set(await objectIds(page));
  await tool(page, 'Text').click();
  const p = await onCanvas(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  await expect(editor(page)).toBeVisible();
  const id = await waitNew(page, before);
  await page.keyboard.type(text);
  await exitEdit(page);
  return id;
}

/** Стикер (цвет по умолчанию) инструментом Sticky note. */
async function placeSticky(page: Page, fx: number, fy: number, text: string): Promise<string> {
  const before = new Set(await objectIds(page));
  await tool(page, 'Sticky note').click();
  await expect(stickyPalette(page)).toBeVisible();
  const p = await onCanvas(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  const id = await waitNew(page, before);
  await expect(editor(page)).toBeVisible();
  await page.keyboard.type(text);
  await exitEdit(page);
  return id;
}

// ---------- SHP-01 ----------

for (const set of ['Basic', 'Callouts', 'Flowchart', 'BPMN'] as const) {
  test(`${set === 'BPMN' ? 'SHP-02' : 'SHP-01'} every shape of the ${set} set is placed with its own outline, reaches another client live and survives reload`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
    const owner = await openOwner(browser, o);
    const guest = await guestOf(browser, o, owner.token);
    try {
      const page = owner.page;
      // все четыре набора — вкладки выбора фигур
      await openSet(page, set);
      for (const s of ['Basic', 'Callouts', 'Flowchart', 'BPMN']) await expect(setTab(page, s)).toBeVisible();
      const names = await shapesBar(page).getByRole('tabpanel').getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      for (const n of MIN_SETS[set]) expect(names, `в наборе ${set} есть ${n}`).toContain(n);
      expect(names.length, `в наборе ${set} есть фигуры`).toBeGreaterThanOrEqual(set === 'Callouts' ? 1 : 4);
      await page.keyboard.press('Escape');

      await zoomOut(page, 3);
      const cols = 6;
      const placed: { name: string; id: string; kind: string; d: string }[] = [];
      for (let i = 0; i < names.length; i++) {
        const fx = 0.1 + (i % cols) * 0.14;
        const fy = 0.08 + Math.floor(i / cols) * 0.18;
        const id = await placeShape(page, set, names[i], await onCanvas(page, fx, fy));
        const kind = (await obj(page, id).getAttribute('data-shape')) ?? '';
        expect(await obj(page, id).getAttribute('data-type')).toBe('shape');
        const d = await lookOf(page, id);
        expect(d, `${names[i]}: контур без NaN`).not.toMatch(/NaN|undefined/);
        placed.push({ name: names[i], id, kind, d });
        await clickEmpty(page);
      }
      expect(new Set(placed.map((p) => p.kind)).size, 'у каждой фигуры свой вид').toBe(placed.length);
      const dupes = placed.filter((p, i) => placed.findIndex((q) => q.d === p.d) !== i).map((p) => p.name);
      expect(dupes, 'у каждой фигуры набора свой вид (контур, линии, значки)').toEqual([]);

      for (const p of placed) await expect(obj(guest.page, p.id), `второй клиент видит ${p.name}`).toHaveAttribute('data-shape', p.kind);
      const doc = await docSeenByLateClient(page, `board=${owner.boardId}`);
      for (const p of placed) {
        const f = (doc.getMap('objects').get(p.id) as Y.Map<unknown>).toJSON() as Record<string, unknown>;
        expect(f.type, `${p.name}: тип в документе`).toBe('shape');
        expect(f.shape, `${p.name}: вид в документе`).toBe(p.kind);
      }
      await page.reload();
      await expect(canvas(page)).toBeVisible();
      for (const p of placed) {
        await expect(obj(page, p.id)).toHaveAttribute('data-shape', p.kind);
        expect(await lookOf(page, p.id), `${p.name}: вид после перезагрузки`).toBe(p.d);
      }
    } finally {
      await guest.close();
      await owner.close();
    }
  });
}

test('SHP-01 link participant places a shape from each set; the owner sees them without reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const g = guest.page;
    const items: [string, string, number, number][] = [
      ['Basic', 'Diamond', 0.2, 0.2],
      ['Callouts', (await (async () => { await openSet(g, 'Callouts'); const n = (await shapesBar(g).getByRole('tabpanel').getByRole('button').first().getAttribute('aria-label')) ?? ''; await g.keyboard.press('Escape'); return n; })()), 0.5, 0.2],
      ['Flowchart', 'Decision', 0.8, 0.2],
      ['BPMN', 'Gateway', 0.5, 0.55],
    ];
    for (const [set, kind, fx, fy] of items) {
      const id = await placeAt(g, set, kind, fx, fy);
      const k = await obj(g, id).getAttribute('data-shape');
      await expect(obj(owner.page, id)).toHaveAttribute('data-shape', k!);
      await clickEmpty(g);
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('SHP-01 negative: Escape after choosing a shape cancels placing; choosing a shape without a click creates nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await openSet(page, 'Basic');
    await kindBtn(page, 'Diamond').click();
    await page.waitForTimeout(500);
    expect(await objectIds(page), 'выбор вида объект не создаёт').toEqual([]);
    await page.keyboard.press('Escape');
    await expect(shapesBar(page)).toBeHidden();
    const p = await onCanvas(page, 0.5, 0.4);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
    expect(await objectIds(page), 'после Escape щелчок фигуру не ставит').toEqual([]);
    const doc = await docSeenByLateClient(page, `board=${owner.boardId}`);
    expect(doc.getMap('objects').size).toBe(0);
  } finally {
    await owner.close();
  }
});

test('SHP-01 boundary: a click gives a shape of a sensible default size; resizing stretches the outline to the new frame', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await placeAt(page, 'Basic', 'Diamond', 0.35, 0.3);
    const b0 = await boxOf(obj(page, id));
    expect(b0.width, 'ширина по умолчанию').toBeGreaterThanOrEqual(40);
    expect(b0.height, 'высота по умолчанию').toBeGreaterThanOrEqual(40);
    await selectObj(page, id);
    const se = page.locator('[data-handle="se"]');
    const from = centerOf(await boxOf(se));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 10, from.y + 5, { steps: 3 });
    await page.mouse.move(from.x + 160, from.y + 100, { steps: 10 });
    await page.mouse.up();
    await untilObject(page, owner.boardId, id, (d) => expect(Number(d.fields.width)).toBeGreaterThan(b0.width + 100));
    const b1 = await boxOf(obj(page, id));
    const pb = await boxOf(outline(page, id));
    expect(pb.width / b1.width, 'контур растянут по ширине').toBeGreaterThan(0.9);
    expect(pb.height / b1.height, 'контур растянут по высоте').toBeGreaterThan(0.9);
    expect(await obj(page, id).getAttribute('data-shape')).toBe('diamond');
  } finally {
    await owner.close();
  }
});

// ---------- SHP-02 ----------

test('SHP-02 every marker of every BPMN shape with markers draws differently; the marker reaches another client and survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    await openSet(page, 'BPMN');
    const names = await shapesBar(page).getByRole('tabpanel').getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
    await page.keyboard.press('Escape');
    await zoomOut(page, 2);
    const withMarkers: string[] = [];
    const finalMarker: Record<string, string> = {};
    for (let i = 0; i < names.length; i++) {
      const id = await placeAt(page, 'BPMN', names[i], 0.1 + (i % 6) * 0.14, 0.1 + Math.floor(i / 6) * 0.3);
      await selectObj(page, id);
      if (!(await combo(page, 'Marker').isVisible())) {
        await clickEmpty(page);
        continue;
      }
      withMarkers.push(names[i]);
      const options = await combo(page, 'Marker').locator('option').evaluateAll((els) => els.map((e) => ({ value: (e as HTMLOptionElement).value, label: e.textContent ?? '' })));
      expect(options.length, `${names[i]}: маркеров больше одного`).toBeGreaterThan(1);
      const drawings: Record<string, string> = {};
      for (const opt of options) {
        await combo(page, 'Marker').selectOption(opt.value);
        await expect(obj(page, id)).toHaveAttribute('data-marker', opt.value);
        drawings[opt.label] = (await marker(page, id).evaluateAll((gs) => gs.map((g) => g.innerHTML))).join('|');
        if (opt.label === 'None' && names[i] !== 'Sub-process') expect(drawings[opt.label], `${names[i]}: None без значка`).toBe('');
      }
      const uniq = new Set(Object.values(drawings));
      expect(uniq.size, `${names[i]}: каждый маркер рисуется по-своему (${Object.keys(drawings).join(', ')})`).toBe(options.length);
      // итог — второй маркер, проверяется у второго клиента и после перезагрузки
      await combo(page, 'Marker').selectOption(options[1].value);
      finalMarker[id] = options[1].value;
      await expect(obj(guest.page, id)).toHaveAttribute('data-marker', options[1].value);
      await clickEmpty(page);
    }
    for (const n of ['Task', 'Start event', 'Intermediate event', 'End event', 'Gateway']) expect(withMarkers, `у ${n} есть маркеры`).toContain(n);
    for (const [id, m] of Object.entries(finalMarker)) await untilObject(page, owner.boardId, id, (d) => expect(d.fields.marker).toBe(m));
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    for (const [id, m] of Object.entries(finalMarker)) await expect(obj(page, id)).toHaveAttribute('data-marker', m);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('SHP-02 negative: an ordinary shape has no BPMN marker list; changing one gateway marker leaves another gateway alone', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const rect = await placeAt(page, 'Basic', 'Rectangle', 0.25, 0.25);
    await selectObj(page, rect);
    await expect(combo(page, 'Marker')).toHaveCount(0);
    expect(await obj(page, rect).getAttribute('data-marker')).toBeNull();
    await clickEmpty(page);
    const g1 = await placeAt(page, 'BPMN', 'Gateway', 0.5, 0.25);
    await clickEmpty(page);
    const g2 = await placeAt(page, 'BPMN', 'Gateway', 0.75, 0.25);
    const m2 = await obj(page, g2).getAttribute('data-marker');
    await selectObj(page, g1);
    await setSel(page, 'Marker', 'Parallel');
    await expect(obj(page, g1)).not.toHaveAttribute('data-marker', m2!);
    await page.waitForTimeout(400);
    expect(await obj(page, g2).getAttribute('data-marker'), 'второй шлюз не изменился').toBe(m2);
    // смешанное выделение: обычная фигура и шлюз — списка маркеров нет
    await page.keyboard.down('Shift');
    const rb = await boxOf(obj(page, rect));
    await page.mouse.click(rb.x + rb.width / 2, rb.y + 10);
    await page.keyboard.up('Shift');
    await expect(selectionBar(page).getByText('2 selected')).toBeVisible();
    await expect(combo(page, 'Marker')).toHaveCount(0);
  } finally {
    await owner.close();
  }
});

test('SHP-02 SHP-03 link participant switches a marker, fill and text of the owner shape; the owner sees all of it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const g = guest.page;
    const task = await placeAt(page, 'BPMN', 'Task', 0.3, 0.3);
    await clickEmpty(page);
    await expect(obj(g, task)).toBeVisible();
    await selectObj(g, task);
    await setSel(g, 'Marker', 'User');
    await setSel(g, 'Fill', 'Green');
    await selectionBar(g).getByRole('button', { name: 'Edit text', exact: true }).click();
    await expect(editor(g)).toBeVisible();
    await g.keyboard.type('Approve order');
    await exitEdit(g);
    const want = (await obj(g, task).getAttribute('data-marker'))!;
    await expect(obj(page, task)).toHaveAttribute('data-marker', want);
    await expect.poll(async () => (await outlineOf(page, task)).fill).toBe('#a5d6a7');
    await expect(obj(page, task).locator('.shape-text')).toHaveText('Approve order');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- SHP-03 ----------

test('SHP-03 fill, border, border width, corners, text and line spacing reach another client and survive reload; another shape keeps its look', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const other = await placeAt(page, 'Basic', 'Rectangle', 0.7, 0.3);
    await clickEmpty(page);
    const otherBefore = await outlineOf(page, other);
    const id = await placeAt(page, 'Basic', 'Rectangle', 0.3, 0.3);
    await selectObj(page, id);
    await setSel(page, 'Corners', 'Square');
    await expect.poll(async () => (await outlineOf(page, id)).d).not.toMatch(/[QqAaCc]/);
    await setSel(page, 'Fill', 'Blue');
    await setSel(page, 'Border', 'Pink');
    await setSel(page, 'Border width', '6');
    await setSel(page, 'Corners', '24');
    await setSel(page, 'Font size', '24');
    await selectionBar(page).getByRole('button', { name: 'Edit text', exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('First line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Second line');
    await exitEdit(page);
    await selectObj(page, id);
    await setSel(page, 'Line spacing', '2');

    const check = async (p: Page) => {
      await expect.poll(async () => outlineOf(p, id)).toMatchObject({ fill: '#81d4fa', stroke: '#f48fb1', strokeWidth: 6 });
      expect((await outlineOf(p, id)).d, 'скругление 24 — кривые в контуре').toMatch(/[QqAaCc]/);
      const t = obj(p, id).locator('.shape-text');
      await expect(t).toContainText('First line');
      await expect(t).toContainText('Second line');
      const st = await t.evaluate((e) => ({ lh: parseFloat(getComputedStyle(e).lineHeight), fs: parseFloat(getComputedStyle(e).fontSize), h: e.getBoundingClientRect().height }));
      expect(st.fs).toBeCloseTo(24, 0);
      expect(st.lh / st.fs, 'межстрочный интервал 2').toBeCloseTo(2, 1);
      // две строки текста внутри фигуры
      const tb = await boxOf(t);
      const ob = await boxOf(obj(p, id));
      expect(tb.x).toBeGreaterThanOrEqual(ob.x - 1);
      expect(tb.x + tb.width).toBeLessThanOrEqual(ob.x + ob.width + 1);
    };
    await check(page);
    await check(guest.page);
    await untilObject(page, owner.boardId, id, (d) => {
      expect(String(d.fields.fill).toLowerCase()).toBe('#81d4fa');
      expect(d.text).toBe('First line\nSecond line');
    });
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await check(page);
    expect(await outlineOf(page, other), 'другая фигура не изменилась').toEqual(otherBefore);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('SHP-03 boundary: no fill, no border, the largest rounding and an empty text keep a valid shape', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await placeAt(page, 'Basic', 'Rectangle', 0.35, 0.3);
    await selectObj(page, id);
    const corners = await combo(page, 'Corners').locator('option').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    await setSel(page, 'Corners', corners[corners.length - 1]);
    await setSel(page, 'Fill', 'None');
    await setSel(page, 'Border width', 'None');
    const ol = await outlineOf(page, id);
    expect(ol.d).not.toMatch(/NaN|undefined/);
    expect(ol.fill === 'transparent' || ol.fill === 'none' || transparent(ol.computedFill), `прозрачная заливка: ${ol.fill}`).toBe(true);
    expect(ol.strokeWidth === 0 || ol.stroke === 'none' || ol.stroke === 'transparent', 'без обводки').toBe(true);
    await expect(obj(page, id)).toBeVisible();
    await untilObject(page, owner.boardId, id, (d) => {
      expect(d.fields.type).toBe('shape');
      expect(d.text).toBe('');
    });
    // эллипс: скругление недоступно или безвредно
    await clickEmpty(page);
    const el = await placeAt(page, 'Basic', 'Ellipse', 0.65, 0.3);
    await selectObj(page, el);
    if (await combo(page, 'Corners').isVisible()) {
      await setSel(page, 'Corners', '24');
      expect((await outlineOf(page, el)).d).not.toMatch(/NaN/);
    }
  } finally {
    await owner.close();
  }
});

// ---------- SHP-04 ----------

test('SHP-04 a custom shape color goes to the shape recent colors only: not to text or sticky note palettes; applied from the list; kept after reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const SHAPE = '#123456';
    const s1 = await placeAt(page, 'Basic', 'Rectangle', 0.25, 0.25);
    await selectObj(page, s1);
    await customColor(page, 'Custom fill', SHAPE);
    await expect.poll(async () => (await outlineOf(page, s1)).fill).toBe(SHAPE);
    await expect.poll(() => recentIn(page, 'Fill')).toContain(SHAPE);
    expect(await recentIn(page, 'Border'), 'недавние фигуры — во всех цветах фигуры').toContain(SHAPE);
    await clickEmpty(page);

    const text = await placeText(page, 0.55, 0.25, 'plain text');
    await selectObj(page, text);
    expect(await recentInSelection(page), 'цвет фигуры не в недавних текста').not.toContain(SHAPE);
    await clickEmpty(page);

    const sticky = await placeSticky(page, 0.8, 0.25, 'note');
    await tool(page, 'Sticky note').click();
    await expect(stickyPalette(page)).toBeVisible();
    expect(await recentInStickyPalette(page), 'цвет фигуры не в палитре стикеров').not.toContain(SHAPE);
    await page.keyboard.press('Escape');
    await selectObj(page, sticky);
    expect(await recentInSelection(page), 'цвет фигуры не в недавних стикера').not.toContain(SHAPE);
    await clickEmpty(page);

    // применить из списка недавних к другой фигуре — после перезагрузки
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    for (const id of [s1, text, sticky]) await expect(obj(page, id)).toBeVisible(); // документ загружен
    const s2 = await placeAt(page, 'Flowchart', 'Decision', 0.3, 0.6);
    await selectObj(page, s2);
    expect(await recentIn(page, 'Fill'), 'недавний цвет фигуры пережил перезагрузку').toContain(SHAPE);
    await combo(page, 'Fill').selectOption(SHAPE);
    await expect.poll(async () => (await outlineOf(page, s2)).fill).toBe(SHAPE);
    await untilObject(page, owner.boardId, s2, (d) => expect(String(d.fields.fill).toLowerCase()).toBe(SHAPE));
  } finally {
    await owner.close();
  }
});

test('SHP-04 custom sticky note and text colors stay in their own recent lists and do not appear for shapes', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const STICKY = '#654321';
    const TEXT = '#0a7f3c';
    // свой цвет стикера — из палитры до постановки
    await tool(page, 'Sticky note').click();
    await expect(stickyPalette(page)).toBeVisible();
    await stickyPalette(page).getByLabel('Custom color', { exact: true }).fill(STICKY);
    const before = new Set(await objectIds(page));
    const p = await onCanvas(page, 0.25, 0.25);
    await page.mouse.click(p.x, p.y);
    const sticky = await waitNew(page, before);
    await page.keyboard.type('custom');
    await exitEdit(page);
    await untilObject(page, owner.boardId, sticky, (d) => expect(String(d.fields.fill).toLowerCase()).toBe(STICKY));
    await tool(page, 'Sticky note').click();
    await expect.poll(() => recentInStickyPalette(page)).toContain(STICKY);
    await page.keyboard.press('Escape');
    await selectObj(page, sticky);
    expect(await recentInSelection(page), 'свой цвет стикера — в недавних стикера').toContain(STICKY);
    await clickEmpty(page);

    // свой цвет текста
    const text = await placeText(page, 0.55, 0.25, 'colored text');
    await selectObj(page, text);
    await customColor(page, 'Custom text color', TEXT);
    await expect.poll(() => recentInSelection(page)).toContain(TEXT);
    expect(await recentInSelection(page), 'цвет стикера не в недавних текста').not.toContain(STICKY);
    await clickEmpty(page);

    await tool(page, 'Sticky note').click();
    expect(await recentInStickyPalette(page), 'цвет текста не в палитре стикеров').not.toContain(TEXT);
    await page.keyboard.press('Escape');

    const shape = await placeAt(page, 'Basic', 'Rectangle', 0.3, 0.6);
    await selectObj(page, shape);
    const shapeRecent = await recentInSelection(page);
    expect(shapeRecent, 'цвет стикера не в недавних фигуры').not.toContain(STICKY);
    expect(shapeRecent, 'цвет текста не в недавних фигуры').not.toContain(TEXT);
  } finally {
    await owner.close();
  }
});

test('SHP-04 boundary: recent shape colors are limited, the newest comes first and a repeated color is not duplicated', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await placeAt(page, 'Basic', 'Rectangle', 0.3, 0.3);
    await selectObj(page, id);
    const colors = Array.from({ length: 10 }, (_, i) => `#${(0x102030 + i * 0x0a0b0c).toString(16).padStart(6, '0')}`);
    for (const c of colors) {
      await customColor(page, 'Custom fill', c);
      await expect.poll(async () => (await outlineOf(page, id)).fill).toBe(c);
    }
    let recent = await recentIn(page, 'Fill');
    expect(recent[0], 'последний — первым').toBe(colors[colors.length - 1]);
    expect(recent.length, 'список ограничен').toBeLessThan(colors.length);
    expect(recent.length).toBeGreaterThanOrEqual(5);
    // повтор цвета из середины списка поднимает его наверх без дубля
    const again = colors[colors.length - 3];
    await customColor(page, 'Custom fill', again);
    await expect.poll(async () => (await recentIn(page, 'Fill'))[0]).toBe(again);
    recent = await recentIn(page, 'Fill');
    expect(recent.filter((c) => c === again).length, 'без дубля').toBe(1);
    expect(new Set(recent).size).toBe(recent.length);
  } finally {
    await owner.close();
  }
});

test('SHP-04 link participant: a custom shape color goes to the participant shape recent colors, not to the sticky note palette', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const g = guest.page;
    const C = '#7a1f5c';
    const id = await placeAt(g, 'Flowchart', 'Process', 0.3, 0.3);
    await selectObj(g, id);
    await customColor(g, 'Custom border', C);
    await expect.poll(async () => (await outlineOf(g, id)).stroke).toBe(C);
    await expect.poll(() => recentIn(g, 'Border')).toContain(C);
    await expect.poll(async () => (await outlineOf(owner.page, id)).stroke, 'владелец видит обводку').toBe(C);
    await clickEmpty(g);
    await tool(g, 'Sticky note').click();
    await expect(stickyPalette(g)).toBeVisible();
    expect(await recentInStickyPalette(g)).not.toContain(C);
    // у владельца в другом браузере недавних цветов участника нет (наблюдение: хранение — браузер)
    await selectObj(owner.page, id);
    const ownerRecent = await recentInSelection(owner.page);
    test.info().annotations.push({ type: 'наблюдение', description: `недавние владельца после правки участника: ${JSON.stringify(ownerRecent)}` });
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- COL-01, CVS-07 ----------

test('COL-01 two clients change different properties and type into one shape at the same time; both edits survive on both sides', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const g = guest.page;
    const id = await placeAt(page, 'Flowchart', 'Process', 0.35, 0.35);
    await expect(obj(g, id)).toBeVisible();
    await selectObj(page, id);
    await selectObj(g, id);
    await Promise.all([setSel(page, 'Fill', 'Yellow'), setSel(g, 'Border', 'Purple')]);
    for (const p of [page, g]) await expect.poll(async () => outlineOf(p, id)).toMatchObject({ fill: '#fff176', stroke: '#ce93d8' });
    await selectionBar(page).getByRole('button', { name: 'Edit text', exact: true }).click();
    await selectionBar(g).getByRole('button', { name: 'Edit text', exact: true }).click();
    await expect(editor(page)).toBeVisible();
    await expect(editor(g)).toBeVisible();
    for (let i = 0; i < 4; i++) {
      await page.keyboard.type('a');
      await g.keyboard.type('b');
    }
    await exitEdit(page);
    await exitEdit(g);
    await expect.poll(async () => (await obj(page, id).locator('.shape-text').textContent()) ?? '').toMatch(/^(?=(?:.*a){4})(?=(?:.*b){4}).{8}$/);
    const t1 = await obj(page, id).locator('.shape-text').textContent();
    await expect(obj(g, id).locator('.shape-text')).toHaveText(t1!);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 undo and redo of own shape creation, fill and BPMN marker leave the other client shape alone', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const theirs = await placeAt(guest.page, 'Basic', 'Star', 0.75, 0.6);
    await clickEmpty(guest.page);
    await expect(obj(page, theirs)).toBeVisible();
    const gw = await placeAt(page, 'BPMN', 'Gateway', 0.3, 0.3);
    await selectObj(page, gw);
    const m0 = (await obj(page, gw).getAttribute('data-marker'))!;
    const f0 = (await outlineOf(page, gw)).fill;
    await setSel(page, 'Fill', 'Orange');
    await setSel(page, 'Marker', 'Parallel');
    const m1 = (await obj(page, gw).getAttribute('data-marker'))!;
    expect(m1).not.toBe(m0);
    await clickEmpty(page);
    const undo = tools(page).getByRole('button', { name: 'Undo', exact: true });
    const redo = tools(page).getByRole('button', { name: 'Redo', exact: true });
    await undo.click();
    await expect(obj(page, gw), 'Undo возвращает маркер').toHaveAttribute('data-marker', m0);
    await undo.click();
    await expect.poll(async () => (await outlineOf(page, gw)).fill, 'Undo возвращает заливку').toBe(f0);
    let steps = 2;
    while ((await obj(page, gw).count()) > 0 && steps < 8) {
      await undo.click();
      await page.waitForTimeout(200);
      steps++;
    }
    await expect(obj(page, gw)).toHaveCount(0);
    await expect(obj(guest.page, gw)).toHaveCount(0);
    for (const p of [page, guest.page]) await expect(obj(p, theirs)).toHaveAttribute('data-shape', 'star');
    for (let i = 0; i < steps; i++) {
      await redo.click();
      await page.waitForTimeout(200);
    }
    await expect(obj(guest.page, gw)).toHaveAttribute('data-marker', m1);
    await expect.poll(async () => (await outlineOf(guest.page, gw)).fill).toBe('#ffb74d');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- UI, MOB ----------

async function expectFloatingPanel(root: Locator, what: string) {
  const st = await root.evaluate((e) => {
    let n: Element | null = e;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)) return { bg: cs.backgroundColor, radius: parseFloat(cs.borderTopLeftRadius), shadow: cs.boxShadow };
      n = n.parentElement;
    }
    return null;
  });
  expect(st, `${what}: подложка`).not.toBeNull();
  expect.soft(st!.bg, `${what}: белая подложка`).toBe('rgb(255, 255, 255)');
  expect.soft(st!.radius, `${what}: скругление`).toBeGreaterThan(0);
  expect.soft(st!.shadow, `${what}: тень`).not.toBe('none');
}

async function expectNeutralOrAccent(root: Locator, accent: string, what: string) {
  const styles = await root.evaluate((r) =>
    [r, ...Array.from(r.querySelectorAll('*'))].flatMap((e) => {
      const rect = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (rect.width < 1 || rect.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') return [];
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return [];
      if (e.tagName === 'OPTION' || e.tagName === 'INPUT') return [];
      const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0) || e.tagName === 'SELECT';
      const bw = Math.max(...['top', 'right', 'bottom', 'left'].map((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`))));
      const out: { label: string; c: string }[] = [];
      const label = (e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()).slice(0, 30);
      if (own) out.push({ label: `текст ${label}`, c: cs.color });
      if (bw > 0) out.push({ label: `рамка ${label}`, c: cs.borderTopColor });
      return out;
    }));
  const ah = hsl(accent).h;
  for (const s of styles) {
    const v = rgba(s.c);
    const ok = !v || transparent(s.c) || (v[0] === v[1] && v[1] === v[2]) || (hsl(s.c).s > 0.25 && hueDist(hsl(s.c).h, ah) <= 12);
    expect.soft(ok, `${what}: ${s.label} ${s.c} — чистый серый или акцент`).toBe(true);
  }
}

test('UI-01 UI-03 shape picker, its tabs and the custom color group follow the common style; tabs show keyboard focus', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const accent = (await signature(page, page.getByRole('button', { name: 'Share', exact: true })))['background-color'];
    await openSet(page, 'Basic');
    await expectFloatingPanel(shapesBar(page), 'выбор фигур Shapes');
    await expectNeutralOrAccent(shapesBar(page), accent, 'выбор фигур Shapes');
    await setTab(page, 'Basic').focus();
    await page.keyboard.press('ArrowRight');
    const focused = page.locator(':focus');
    const fo = await focused.evaluate((e) => { const cs = getComputedStyle(e); return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`; });
    expect.soft(/none\|0px\|none/.test(fo), `видимый фокус вкладки: ${fo}`).toBe(false);
    await page.keyboard.press('Escape');
    const id = await placeAt(page, 'BPMN', 'Gateway', 0.4, 0.35);
    await selectObj(page, id);
    await selectionBar(page).getByRole('button', { name: 'Custom color', exact: true }).click();
    await expect(customGroup(page)).toBeVisible();
    await expectNeutralOrAccent(selectionBar(page), accent, 'панель Selection фигуры');
  } finally {
    await owner.close();
  }
});

test('UI-04 MOB-06 on a phone the shape picker fits the screen with 44x44 targets; a shape of the chosen kind is placed by tap and its marker changed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const vw = viewport!.width;
    const small: string[] = [];
    const checkTargets = async (root: Locator, what: string) => {
      const b = await boxOf(root);
      expect.soft(b.x, `${what} в пределах экрана слева`).toBeGreaterThanOrEqual(-0.5);
      expect.soft(b.x + b.width, `${what} в пределах экрана справа`).toBeLessThanOrEqual(vw + 0.5);
      // поля выбора своего цвета меряет тест «UI-04 BUG-019 …»
      for (const t of await root.locator('button, select, input:not([type="color"]), [role="tab"]').all()) {
        if (!(await t.isVisible())) continue;
        const tb = await boxOf(t);
        if (Math.round(tb.width) < 44 || Math.round(tb.height) < 44) small.push(`${what}: ${(await t.getAttribute('aria-label')) ?? (await t.textContent())?.trim()} ${Math.round(tb.width)}×${Math.round(tb.height)}`);
      }
    };
    await press(tool(page, 'Shape'), true);
    await expect(shapesBar(page)).toBeVisible();
    for (const s of ['Basic', 'Callouts', 'Flowchart', 'BPMN']) {
      await press(setTab(page, s), true);
      await checkTargets(shapesBar(page), `Shapes/${s}`);
    }
    const id = await placeAt(page, 'BPMN', 'Start event', 0.5, 0.35, true);
    await expect(obj(page, id)).toHaveAttribute('data-shape', /.+/);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await combo(page, 'Marker').selectOption({ label: 'Timer' });
    await expect(obj(page, id)).not.toHaveAttribute('data-marker', 'none');
    const m = (await obj(page, id).getAttribute('data-marker'))!;
    await untilObject(page, owner.boardId, id, (d) => expect(d.fields.marker).toBe(m));
    const mb = await boxOf(combo(page, 'Marker'));
    if (Math.round(mb.width) < 44 || Math.round(mb.height) < 44) small.push(`Marker ${Math.round(mb.width)}×${Math.round(mb.height)}`);
    // группа своих цветов (SHP-04) на телефоне
    await press(selectionBar(page).getByRole('button', { name: 'Custom color', exact: true }), true);
    await expect(customGroup(page)).toBeVisible();
    await customGroup(page).scrollIntoViewIfNeeded();
    await checkTargets(customGroup(page), 'Custom color');
    expect(await customGroup(page).locator('input[type="color"]').count(), 'в группе есть поля своего цвета').toBeGreaterThan(0);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(sw, 'нет горизонтальной прокрутки').toBeLessThanOrEqual(vw + 1);
    expect.soft(small, 'цели меньше 44×44').toEqual([]);
  } finally {
    await owner.close();
  }
});

// BUG-019 исправлен в T6.3 (3986998): пометка test.fail снята, тест — в наборе навсегда
test('UI-04 BUG-019 on a phone the custom color fields of the sticky note palette and of the Custom color group are at least 44x44', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const small: string[] = [];
    const measure = async (root: Locator, what: string) => {
      const fields = await root.locator('input[type="color"]').all();
      expect(fields.length, `${what}: есть поля своего цвета`).toBeGreaterThan(0);
      for (const f of fields) {
        if (!(await f.isVisible())) continue;
        const b = await boxOf(f);
        if (Math.round(b.width) < 44 || Math.round(b.height) < 44) small.push(`${what}: ${(await f.getAttribute('aria-label')) ?? ''} ${Math.round(b.width)}×${Math.round(b.height)}`);
      }
    };
    await press(tool(page, 'Sticky note'), true);
    await expect(stickyPalette(page)).toBeVisible();
    await measure(stickyPalette(page), 'палитра Sticky note color');
    await page.keyboard.press('Escape');
    await placeAt(page, 'Basic', 'Rectangle', 0.5, 0.35, true);
    await press(selectionBar(page).getByRole('button', { name: 'Custom color', exact: true }), true);
    await expect(customGroup(page)).toBeVisible();
    await customGroup(page).scrollIntoViewIfNeeded();
    await measure(customGroup(page), 'группа Custom color');
    expect(small, 'поля своего цвета меньше 44×44').toEqual([]);
  } finally {
    await owner.close();
  }
});

// ---------- ARCH ----------

test('ARCH shapes are scene objects of the board document: creating and styling them sends no HTTP requests to /api and no localhost', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const api: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      // фоновая проверка сессии ACC-05 (GET /api/session) идёт по таймеру и к правке не относится
      if (u.pathname.startsWith('/api') && u.pathname !== '/api/ws' && u.pathname !== '/api/session' && r.resourceType() !== 'websocket') api.push(`${r.method()} ${u.pathname}`);
      expect(r.url()).not.toContain('localhost');
    });
    const id = await placeAt(page, 'BPMN', 'Task', 0.3, 0.3);
    await selectObj(page, id);
    await setSel(page, 'Marker', 'Service');
    await setSel(page, 'Fill', 'Blue');
    await customColor(page, 'Custom border', '#335577');
    await selectionBar(page).getByRole('button', { name: 'Edit text', exact: true }).click();
    await page.keyboard.type('arch');
    await exitEdit(page);
    await page.waitForTimeout(500);
    expect(api, 'нет HTTP-запросов к /api при работе с фигурами').toEqual([]);
    await untilObject(page, owner.boardId, id, (d) => {
      expect(d.fields.type).toBe('shape');
      expect(d.text).toBe('arch');
    });
    const doc = await docSeenByLateClient(page, `board=${owner.boardId}`);
    const top = [...doc.share.keys()];
    expect(top.some((k) => /recent|color/i.test(k)), `недавние цвета не в документе: ${top.join(',')}`).toBe(false);
  } finally {
    await owner.close();
  }
});
