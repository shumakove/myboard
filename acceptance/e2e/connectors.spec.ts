// Приёмка T6.4 · соединительные линии: CON-01…CON-07, CVS-26; SHP-04 для палитры линии (Q-003, п. 3);
// попутно COL-01, CVS-07, UI-01…04 / MOB-06, ARCH.
// Сценарии — docs/qa/reports/T6.4.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.4.
// Наблюдение: геометрия SVG линии на экране (getScreenCTM), DOM подписей, документ доски глазами позднего
// клиента по /api/ws, второй клиент. Код из apps/ не импортируется.
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, centerOf, Finger, obj, objectIds, onCanvas, seed, selectionBar, tool, type Box, type Obj } from './scene';
import { hsl, hueDist, rgba, signature, transparent } from './ui';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');
const optsOf = (f: Fx) => profileOpts(f);
const guestOf = (browser: Browser, o: Opts, token: string, name = 'QA Guest') => openGuest(browser, o, token, name);

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

const combo = (page: Page, name: string) => selectionBar(page).getByRole('combobox', { name, exact: true });
const barButton = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const labelGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Label', exact: true });
const positionGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Label position', exact: true });
const customGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Custom color' });
const stickyPalette = (page: Page) => page.getByRole('toolbar', { name: 'Sticky note color' });
const objectText = (page: Page) => page.getByRole('textbox', { name: 'Object text' });
const labelEditor = (page: Page) => page.getByRole('textbox', { name: 'Line label' });
const lineHandle = (page: Page, name: string) => page.locator(`[data-handle="${name}"]`);
const labels = (page: Page, id: string) => obj(page, id).getByTestId('line-label');
const labelEl = (page: Page, id: string, labelId: string) => obj(page, id).locator(`[data-testid="line-label"][data-label-id="${labelId}"]`);

// Опорные объекты в локальных координатах тестов (FRAME, см. scene.ts)
const A: Obj = { type: 'shape', shape: 'rectangle', x: 40, y: 60, width: 120, height: 80 } as Obj;
const B: Obj = { type: 'sticky', x: 520, y: 260, width: 120, height: 120 } as Obj;

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
const deg = (p: Point, q: Point) => (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
const anchorOf = (b: Box, a: 'n' | 'e' | 's' | 'w'): Point =>
  ({ n: { x: b.x + b.width / 2, y: b.y }, s: { x: b.x + b.width / 2, y: b.y + b.height }, w: { x: b.x, y: b.y + b.height / 2 }, e: { x: b.x + b.width, y: b.y + b.height / 2 } })[a];
const nearestAnchor = (b: Box, p: Point) =>
  (['n', 'e', 's', 'w'] as const).map((a) => ({ a, d: dist(anchorOf(b, a), p) })).sort((x, y) => x.d - y.d)[0];

// ---------- наблюдение линии ----------

type Geom = {
  start: Point;
  end: Point;
  d: string;
  style: string;
  stroke: string;
  caps: Record<string, { cap: string; d: string; center: Point }>;
  /** Точки линии на экране (200 отсчётов по длине). */
  samples: Point[];
};

/** Геометрия линии на экране: концы, вид, наконечники, отсчёты вдоль линии. */
async function geom(page: Page, id: string): Promise<Geom> {
  return obj(page, id).evaluate((el) => {
    const stroke = el.querySelector('[data-testid="line-stroke"]') as SVGPathElement;
    const m = stroke.getScreenCTM()!;
    const map = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    const len = stroke.getTotalLength();
    const s = stroke.getPointAtLength(0);
    const e = stroke.getPointAtLength(len);
    const samples = Array.from({ length: 201 }, (_, i) => {
      const p = stroke.getPointAtLength((len * i) / 200);
      return map(p.x, p.y);
    });
    const caps: Record<string, { cap: string; d: string; center: { x: number; y: number } }> = {};
    for (const c of Array.from(el.querySelectorAll('[data-testid="line-cap"]'))) {
      const bb = (c as SVGGraphicsElement).getBBox();
      const cm = (c as SVGGraphicsElement).getScreenCTM()!;
      caps[c.getAttribute('data-end') ?? '?'] = {
        cap: c.getAttribute('data-cap') ?? '',
        d: c.getAttribute('d') ?? c.outerHTML,
        center: { x: cm.a * (bb.x + bb.width / 2) + cm.c * (bb.y + bb.height / 2) + cm.e, y: cm.b * (bb.x + bb.width / 2) + cm.d * (bb.y + bb.height / 2) + cm.f },
      };
    }
    return { start: map(s.x, s.y), end: map(e.x, e.y), d: stroke.getAttribute('d') ?? '', style: stroke.getAttribute('data-line-style') ?? '', stroke: (stroke.getAttribute('stroke') ?? '').toLowerCase(), caps, samples };
  });
}

/** Точка на линии (доля длины) — на экране. */
async function pointOn(page: Page, id: string, f: number): Promise<Point> {
  const g = await geom(page, id);
  return g.samples[Math.round(f * 200)];
}

/** Расстояние от точки до линии на экране. */
const distTo = (g: Geom, p: Point) => Math.min(...g.samples.map((s) => dist(s, p)));

/** Сколько изломов у ломаной в `d` (команды после M). */
const commands = (d: string) => (d.match(/[MLCQSAHVZ]/gi) ?? []).map((c) => c.toUpperCase());

type LineDoc = { fields: Record<string, unknown>; labels: Record<string, Record<string, unknown>> };
async function lineDoc(page: Page, boardId: string, id: string): Promise<LineDoc | null> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const o = doc.getMap('objects').get(id);
  if (o === undefined) return null;
  const fields = (o instanceof Y.Map ? o.toJSON() : o) as Record<string, unknown>;
  return { fields, labels: (fields.labels ?? {}) as Record<string, Record<string, unknown>> };
}

async function untilLine(page: Page, boardId: string, id: string, check: (o: LineDoc) => void) {
  await expect(async () => {
    const o = await lineDoc(page, boardId, id);
    expect(o, `линия ${id} в документе`).not.toBeNull();
    check(o!);
  }).toPass({ timeout: 15_000, intervals: [300, 600, 1000] });
}

const endObj = (o: LineDoc, end: 'start' | 'end') => ((o.fields[end] ?? {}) as Record<string, unknown>).object;

// ---------- действия ----------

async function press(l: Locator, isMobile: boolean) {
  if (isMobile) await l.tap();
  else await l.click();
}

async function waitNewLine(page: Page, before: Set<string>): Promise<string> {
  let id = '';
  await expect(async () => {
    for (const x of await objectIds(page)) {
      if (!before.has(x) && (await obj(page, x).getAttribute('data-type')) === 'line') id = x;
    }
    expect(id, 'новая линия на холсте').not.toBe('');
  }).toPass({ timeout: 5000 });
  return id;
}

/** Инструмент Line из полного списка инструментов. */
async function pickLine(page: Page, isMobile = false) {
  await press(tool(page, 'All tools'), isMobile);
  await press(page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Line', exact: true }), isMobile);
}

/** Провести линию протяжкой мышью; `shift` — зажать Shift во время протяжки (после нажатия кнопки). */
async function drawLine(page: Page, from: Point, to: Point, opts: { shift?: 'before' | 'during' } = {}): Promise<string> {
  const before = new Set(await objectIds(page));
  await pickLine(page);
  if (opts.shift === 'before') await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.1, from.y + (to.y - from.y) * 0.1, { steps: 2 });
  if (opts.shift === 'during') await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
  return waitNewLine(page, before);
}

/** Линия от объекта A к объекту B (протяжка из центра в центр). */
async function connect(page: Page, a: string, b: string): Promise<string> {
  return drawLine(page, centerOf(await boxOf(obj(page, a))), centerOf(await boxOf(obj(page, b))));
}

async function deselect(page: Page) {
  const sel = page.locator('[data-object-id][aria-selected="true"]');
  // поле панели (свой цвет, список) держит фокус — Escape уходит в него; фокус снимается
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 3 && (await sel.count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  await expect(sel).toHaveCount(0);
}

async function selectLine(page: Page, id: string, f = 0.3) {
  if ((await obj(page, id).getAttribute('aria-selected')) === 'true') return;
  await deselect(page);
  const p = await pointOn(page, id, f);
  await page.mouse.click(p.x, p.y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

/** Точка объекта, где сверху нет линии или её маркера (иначе щелчок достанется линии). */
async function freePointOf(page: Page, id: string): Promise<Point> {
  const b = await boxOf(obj(page, id));
  const pts = [0.5, 0.75, 0.25].flatMap((fy) => [0.5, 0.75, 0.25].map((fx) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy })));
  for (const p of pts) {
    const hit = await page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      if (!e || e.closest('[data-handle]')) return '';
      return e.closest('[data-object-id]')?.getAttribute('data-object-id') ?? '';
    }, p);
    if (hit === id) return p;
  }
  return pts[0];
}

/** Перетащить объект мышью на `d` пикселей экрана. */
async function moveObject(page: Page, id: string, d: Point) {
  await deselect(page);
  const from = await freePointOf(page, id);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 6 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/** Перетащить маркер выделенной линии в точку `to`. */
async function dragHandle(page: Page, name: string, to: Point, opts: { shift?: boolean; hold?: (p: Page) => Promise<void> } = {}) {
  const from = centerOf(await boxOf(lineHandle(page, name)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.2, from.y + (to.y - from.y) * 0.2, { steps: 3 });
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(to.x, to.y, { steps: 10 });
  if (opts.hold) await opts.hold(page);
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(200);
}

/** Двойной щелчок по маркеру линии; маркер не закрыт панелью. */
async function dblHandle(page: Page, name: string) {
  const p = centerOf(await boxOf(lineHandle(page, name)));
  const top = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-handle]')?.getAttribute('data-handle') ?? '', p);
  expect(top, `маркер ${name} не закрыт другими элементами`).toBe(name);
  await page.mouse.dblclick(p.x, p.y);
}

async function setCombo(page: Page, name: string, label: string) {
  await combo(page, name).selectOption({ label });
}

/** Свой цвет полем группы Custom color. */
async function customColor(page: Page, field: string, hex: string) {
  const toggle = barButton(page, 'Custom color');
  if (!(await customGroup(page).isVisible())) {
    await toggle.click();
    await expect(customGroup(page)).toBeVisible();
  }
  await customGroup(page).getByLabel(field, { exact: true }).fill(hex);
}

async function recentIn(page: Page, name: string): Promise<string[]> {
  return combo(page, name)
    .locator('optgroup[label="Recent colors"] option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value.toLowerCase()));
}

async function allOptionsIn(page: Page, name: string): Promise<string[]> {
  return combo(page, name).locator('option').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value.toLowerCase()));
}

async function recentInSelection(page: Page): Promise<string[]> {
  const vals = await selectionBar(page)
    .locator('optgroup[label="Recent colors"] option')
    .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value.toLowerCase()));
  return [...new Set(vals)];
}

async function recentInStickyPalette(page: Page): Promise<string[]> {
  const names = await stickyPalette(page).getByRole('button', { name: /^Custom #/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''));
  return names.map((n) => n.replace(/^Custom /, '').trim().toLowerCase());
}

async function selectObj(page: Page, id: string) {
  await deselect(page);
  const at = await freePointOf(page, id);
  await page.mouse.click(at.x, at.y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

/** Ввести текст подписи в открытое поле `Line label` и закончить правку. */
async function typeLabel(page: Page, text: string) {
  await expect(labelEditor(page)).toBeVisible();
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(labelEditor(page)).toBeHidden();
}

async function labelIds(page: Page, id: string): Promise<string[]> {
  return labels(page, id).evaluateAll((els) => els.map((e) => e.getAttribute('data-label-id') ?? ''));
}

/** Щелчок мышью по подписи (выбирает её). */
async function clickLabel(page: Page, id: string, labelId: string) {
  const c = (await labelGeom(page, id, labelId)).center;
  await page.mouse.click(c.x, c.y);
  // BUG-022: первый щелчок по подписи невыделенной линии выделяет линию, но не эту подпись
  if ((await labelEl(page, id, labelId).getAttribute('data-active')) !== 'true') {
    await page.waitForTimeout(400);
    await page.mouse.click(c.x, c.y);
  }
  await expect(labelEl(page, id, labelId)).toHaveAttribute('data-active', 'true');
}

/** Центр подписи на экране и её поворот (градусы) по вычисленному transform. */
async function labelGeom(page: Page, id: string, labelId: string) {
  return labelEl(page, id, labelId).evaluate((e) => {
    const r = e.getBoundingClientRect();
    const t = getComputedStyle(e).transform;
    const m = t && t !== 'none' ? new DOMMatrix(t) : new DOMMatrix();
    const cs = getComputedStyle(e);
    return {
      center: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
      angle: (Math.atan2(m.b, m.a) * 180) / Math.PI,
      text: (e as HTMLElement).innerText,
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      color: cs.color,
      align: cs.textAlign,
      height: (e as HTMLElement).offsetHeight,
    };
  });
}

/** Стенд: владелец с объектами A и B на доске. */
async function ownerWithAB(browser: Browser, o: Opts) {
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, { a: A, b: B });
  return owner;
}

// ---------- CON-01 ----------

test('CON-01 CVS-26 a line drawn from one object to another joins them; straight, elbow and curved draw differently, reach another client live and survive reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await expect(obj(page, id)).toHaveAttribute('data-type', 'line');
    // концы на точках объектов A и B
    const g = await geom(page, id);
    const ba = await boxOf(obj(page, 'a'));
    const bb = await boxOf(obj(page, 'b'));
    expect(nearestAnchor(ba, g.start).d, 'начало — на точке объекта A').toBeLessThanOrEqual(2);
    expect(nearestAnchor(bb, g.end).d, 'конец — на точке объекта B').toBeLessThanOrEqual(2);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(d.fields.type).toBe('line');
      expect(endObj(d, 'start'), 'начало привязано к A').toBe('a');
      expect(endObj(d, 'end'), 'конец привязан к B').toBe('b');
    });
    await expect(obj(guest.page, id), 'второй клиент видит линию').toBeAttached();

    const looks: Record<string, string> = {};
    for (const [label, style] of [['Elbow', 'elbow'], ['Curved', 'curved'], ['Straight', 'straight']] as const) {
      await selectLine(page, id);
      await setCombo(page, 'Line type', label);
      await expect(obj(page, id).getByTestId('line-stroke')).toHaveAttribute('data-line-style', style);
      const gl = await geom(page, id);
      looks[style] = gl.d;
      const cmds = commands(gl.d).slice(1);
      if (style === 'straight') expect(cmds, 'прямая — один отрезок').toEqual(['L']);
      if (style === 'elbow') {
        expect(cmds.every((c) => c === 'L' || c === 'H' || c === 'V'), `ломаная — отрезки: ${gl.d}`).toBe(true);
        expect(cmds.length, 'ломаная между несоосными объектами — с изломами').toBeGreaterThanOrEqual(2);
        // отрезки ломаной — горизонтальные или вертикальные
        const pts = gl.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
        for (let i = 2; i + 1 < pts.length; i += 2) {
          const dx = Math.abs(pts[i] - pts[i - 2]);
          const dy = Math.abs(pts[i + 1] - pts[i - 1]);
          expect(Math.min(dx, dy), `отрезок ломаной под прямым углом: ${gl.d}`).toBeLessThan(0.5);
        }
      }
      if (style === 'curved') expect(cmds.some((c) => c === 'C' || c === 'Q' || c === 'S'), `кривая — гладкая: ${gl.d}`).toBe(true);
      // концы остаются на объектах
      expect(nearestAnchor(ba, gl.start).d).toBeLessThanOrEqual(2);
      expect(nearestAnchor(bb, gl.end).d).toBeLessThanOrEqual(2);
      await expect(obj(guest.page, id).getByTestId('line-stroke'), `второй клиент видит вид ${style}`).toHaveAttribute('data-line-style', style);
      await untilLine(page, owner.boardId, id, (d) => expect(d.fields.lineStyle).toBe(style));
    }
    expect(new Set(Object.values(looks)).size, 'три вида рисуются по-разному').toBe(3);

    await setCombo(page, 'Line type', 'Curved');
    await expect(obj(page, id).getByTestId('line-stroke')).toHaveAttribute('data-line-style', 'curved');
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(obj(page, id).getByTestId('line-stroke'), 'после перезагрузки — кривая').toHaveAttribute('data-line-style', 'curved');
    expect((await geom(page, id)).d).toBe(looks.curved);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-01 the start and the end arrowheads are chosen independently; every arrowhead draws differently and reaches another client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    const options = await combo(page, 'End').locator('option').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(options.length, 'выбор наконечников больше одного').toBeGreaterThanOrEqual(2);
    expect(options).toEqual(expect.arrayContaining(['None', 'Arrow']));
    const startOptions = await combo(page, 'Start').locator('option').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(startOptions, 'у начала тот же выбор').toEqual(options);

    // каждый наконечник у конца рисуется по-своему, начало при этом не меняется
    await setCombo(page, 'Start', 'None');
    const ends: Record<string, string> = {};
    for (const label of options.filter((x) => x !== 'None')) {
      await setCombo(page, 'End', label);
      await expect.poll(async () => (await geom(page, id)).caps.end?.cap ?? '').toBe(label.toLowerCase());
      const g = await geom(page, id);
      expect(g.caps.start, `${label}: начало без наконечника`).toBeUndefined();
      expect(dist(g.caps.end.center, g.end), `${label}: наконечник у конца`).toBeLessThan(20);
      ends[label] = g.caps.end.d;
    }
    expect(new Set(Object.values(ends)).size, 'каждый наконечник рисуется по-своему').toBe(Object.keys(ends).length);

    // независимый выбор: начало — круг, конец — треугольник
    await setCombo(page, 'Start', 'Circle');
    await setCombo(page, 'End', 'Triangle');
    await expect.poll(async () => { const c = (await geom(page, id)).caps; return `${c.start?.cap}/${c.end?.cap}`; }).toBe('circle/triangle');
    const g = await geom(page, id);
    expect(dist(g.caps.start.center, g.start), 'круг у начала').toBeLessThan(20);
    expect(dist(g.caps.end.center, g.end), 'треугольник у конца').toBeLessThan(20);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(d.fields.startCap).toBe('circle');
      expect(d.fields.endCap).toBe('triangle');
    });
    await expect.poll(async () => { const c = (await geom(guest.page, id)).caps; return `${c.start?.cap}/${c.end?.cap}`; }, { message: 'второй клиент' }).toBe('circle/triangle');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-01 negative: the type and the arrowhead of one line do not change another line; Escape after choosing Line draws nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    // Escape снимает инструмент: протяжка по пустому месту линию не проводит
    await pickLine(page);
    await page.keyboard.press('Escape');
    const before = new Set(await objectIds(page));
    const p = await onCanvas(page, 0.5, 0.75);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 200, p.y + 40, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const added = (await objectIds(page)).filter((x) => !before.has(x));
    expect(added, 'после Escape линия не появилась').toEqual([]);

    const l1 = await connect(page, 'a', 'b');
    await deselect(page);
    const q = await onCanvas(page, 0.3, 0.8);
    const l2 = await drawLine(page, q, { x: q.x + 250, y: q.y - 60 });
    await deselect(page);
    const g2 = await geom(page, l2);
    await selectLine(page, l1);
    await setCombo(page, 'Line type', 'Elbow');
    await setCombo(page, 'Start', 'Diamond');
    await setCombo(page, 'End', 'None');
    await expect(obj(page, l1).getByTestId('line-stroke')).toHaveAttribute('data-line-style', 'elbow');
    await page.waitForTimeout(400);
    const g2after = await geom(page, l2);
    expect(g2after.d, 'другая линия не изменилась').toBe(g2.d);
    expect(g2after.style).toBe(g2.style);
    expect(Object.fromEntries(Object.entries(g2after.caps).map(([k, v]) => [k, v.cap]))).toEqual(Object.fromEntries(Object.entries(g2.caps).map(([k, v]) => [k, v.cap])));
  } finally {
    await owner.close();
  }
});

test('CON-01 link participant draws a line between objects and changes its type; the owner sees it without reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const g = guest.page;
    await expect(obj(g, 'b')).toBeVisible();
    const id = await connect(g, 'a', 'b');
    await selectLine(g, id);
    await setCombo(g, 'Line type', 'Elbow');
    await setCombo(g, 'Start', 'Arrow');
    await expect(obj(owner.page, id).getByTestId('line-stroke')).toHaveAttribute('data-line-style', 'elbow');
    await expect.poll(async () => (await geom(owner.page, id)).caps.start?.cap).toBe('arrow');
    await untilLine(owner.page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start')).toBe('a');
      expect(endObj(d, 'end')).toBe('b');
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CON-02 ----------

test('CON-02 Swap ends turns the line around in one step: the arrow points at the other object, both ends stay attached, a second swap restores it; the other client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await setCombo(page, 'Start', 'Circle');
    await setCombo(page, 'End', 'Arrow');
    await expect.poll(async () => { const c = (await geom(page, id)).caps; return `${c.start?.cap}/${c.end?.cap}`; }).toBe('circle/arrow');
    const ba = await boxOf(obj(page, 'a'));
    const bb = await boxOf(obj(page, 'b'));
    const nearA = (p: Point) => nearestAnchor(ba, p).d < nearestAnchor(bb, p).d;
    let g = await geom(page, id);
    expect(nearA(g.caps.end.center), 'до: стрелка у B').toBe(false);
    expect(nearA(g.caps.start.center), 'до: круг у A').toBe(true);

    await barButton(page, 'Swap ends').click();
    await expect.poll(async () => nearA((await geom(page, id)).caps.end.center), { message: 'после: стрелка указывает на A' }).toBe(true);
    g = await geom(page, id);
    expect(nearA(g.caps.start.center), 'после: круг у B').toBe(false);
    expect(g.caps.end.cap).toBe('arrow');
    expect(nearestAnchor(bb, g.start).d, 'начало теперь у B').toBeLessThanOrEqual(2);
    expect(nearestAnchor(ba, g.end).d, 'конец теперь у A').toBeLessThanOrEqual(2);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start'), 'начало привязано к B').toBe('b');
      expect(endObj(d, 'end'), 'конец привязан к A').toBe('a');
    });
    await expect.poll(async () => nearA((await geom(guest.page, id)).caps.end.center), { message: 'второй клиент: стрелка у A' }).toBe(true);

    // привязки сохранены: линия следует за обоими объектами
    await moveObject(page, 'a', { x: 0, y: 120 });
    const ba2 = await boxOf(obj(page, 'a'));
    await expect.poll(async () => nearestAnchor(ba2, (await geom(page, id)).end).d, { message: 'конец следует за A' }).toBeLessThanOrEqual(2);

    await selectLine(page, id);
    await barButton(page, 'Swap ends').click();
    await expect.poll(async () => nearA((await geom(page, id)).caps.end.center), { message: 'повторный обмен: стрелка снова у B' }).toBe(false);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start')).toBe('a');
      expect(endObj(d, 'end')).toBe('b');
      expect(d.fields.startCap).toBe('circle');
      expect(d.fields.endCap).toBe('arrow');
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-02 boundary: swapping a free line with bend points keeps its shape and reverses its direction', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const p = await onCanvas(page, 0.25, 0.4);
    const id = await drawLine(page, p, { x: p.x + 400, y: p.y }, { shift: 'before' });
    await selectLine(page, id);
    await setCombo(page, 'Line type', 'Curved');
    const add = centerOf(await boxOf(lineHandle(page, 'line-add-0')));
    await dragHandle(page, 'line-add-0', { x: add.x - 60, y: add.y + 120 });
    await expect(lineHandle(page, 'line-point-0')).toBeVisible();
    const g0 = await geom(page, id);
    await barButton(page, 'Swap ends').click();
    await expect.poll(async () => dist((await geom(page, id)).start, g0.end)).toBeLessThan(2);
    const g1 = await geom(page, id);
    expect(dist(g1.end, g0.start)).toBeLessThan(2);
    // та же форма: отсчёты в обратном порядке совпадают
    const rev = [...g1.samples].reverse();
    const worst = Math.max(...g0.samples.map((s) => Math.min(...rev.map((r) => dist(r, s)))));
    expect(worst, 'форма линии не изменилась').toBeLessThan(3);
    expect(dist(g1.caps.end.center, g0.start), 'стрелка — у прежнего начала').toBeLessThan(20);
  } finally {
    await owner.close();
  }
});

// ---------- CON-03, CON-04 ----------

test('CON-03 several labels sit on one line with their own text; they survive reload and reach another client; deleting one keeps the other', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'first');
    // вторая подпись — двойным щелчком по линии ближе к концу
    const p = await pointOn(page, id, 0.8);
    await page.mouse.dblclick(p.x, p.y);
    await typeLabel(page, 'second');
    // третья — снова кнопкой
    await selectLine(page, id, 0.15);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'third');
    await expect(labels(page, id)).toHaveCount(3);
    const ids = await labelIds(page, id);
    const texts = await Promise.all(ids.map(async (l) => (await labelGeom(page, id, l)).text));
    expect([...texts].sort()).toEqual(['first', 'second', 'third']);
    const g = await geom(page, id);
    for (const l of ids) expect(distTo(g, (await labelGeom(page, id, l)).center), 'подпись — на линии').toBeLessThan(4);
    await untilLine(page, owner.boardId, id, (d) => expect(Object.values(d.labels).map((x) => x.text).sort()).toEqual(['first', 'second', 'third']));
    await expect(labels(guest.page, id), 'второй клиент видит три подписи').toHaveCount(3);
    await expect(obj(guest.page, id)).toContainText('second');

    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(labels(page, id), 'после перезагрузки').toHaveCount(3);

    // удалить одну подпись
    // удалить подпись second (first и third — обе посередине, third поверх first)
    const secondId = (await labels(page, id).evaluateAll((els) => els.map((e) => [e.getAttribute('data-label-id'), (e as HTMLElement).innerText]))).find(([, t]) => t === 'second')![0]!;
    await selectLine(page, id);
    await clickLabel(page, id, secondId);
    await labelGroup(page).getByRole('button', { name: 'Delete label', exact: true }).click();
    await expect(labels(page, id)).toHaveCount(2);
    await expect(labels(guest.page, id)).toHaveCount(2);
    await expect(obj(guest.page, id)).not.toContainText('second');
    await expect(obj(guest.page, id)).toContainText('first');
    await expect(obj(guest.page, id)).toContainText('third');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-03 a label is dragged along the line, stays on it, does not leave its ends and moves with the line', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'drag me');
    const [lid] = await labelIds(page, id);
    const g = await geom(page, id);
    const c0 = (await labelGeom(page, id, lid)).center;
    // тянем подпись к точке 25 % длины, но со сдвигом вбок на 60 px
    const target = g.samples[50];
    const nx = -(g.end.y - g.start.y) / dist(g.start, g.end);
    const ny = (g.end.x - g.start.x) / dist(g.start, g.end);
    await selectLine(page, id);
    await page.mouse.move(c0.x, c0.y);
    await page.mouse.down();
    await page.mouse.move(c0.x + (target.x - c0.x) / 2, c0.y + (target.y - c0.y) / 2, { steps: 6 });
    await page.mouse.move(target.x + nx * 60, target.y + ny * 60, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const c1 = (await labelGeom(page, id, lid)).center;
    expect(distTo(g, c1), 'подпись осталась на линии').toBeLessThan(4);
    expect(dist(c1, target), 'подпись переехала к точке 25 % длины').toBeLessThan(25);
    expect(dist(c1, c0), 'подпись сдвинулась').toBeGreaterThan(40);
    await untilLine(page, owner.boardId, id, (d) => {
      const pos = Number(Object.values(d.labels)[0].position);
      expect(pos).toBeGreaterThan(0.15);
      expect(pos).toBeLessThan(0.35);
    });
    await expect.poll(async () => dist((await labelGeom(guest.page, id, lid)).center, (await pointOn(guest.page, id, 0.25))), { message: 'второй клиент видит подпись на новом месте' }).toBeLessThan(25);

    // за конец линии подпись не уходит
    const beyond = { x: g.end.x + (g.end.x - g.start.x) * 0.5, y: g.end.y + (g.end.y - g.start.y) * 0.5 };
    await selectLine(page, id);
    await page.mouse.move(c1.x, c1.y);
    await page.mouse.down();
    await page.mouse.move(beyond.x, beyond.y, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const c2 = (await labelGeom(page, id, lid)).center;
    expect(distTo(g, c2), 'подпись на линии у конца').toBeLessThan(4);
    expect(dist(c2, g.end), 'подпись не дальше конца').toBeLessThanOrEqual(dist(g.start, g.end) * 0.15 + 4);
    expect(dist(c2, g.start)).toBeLessThanOrEqual(dist(g.start, g.end) + 1);

    // объект двигается — линия и подпись едут вместе
    await moveObject(page, 'b', { x: 0, y: 160 });
    const g2 = await geom(page, id);
    await expect.poll(async () => distTo(await geom(page, id), (await labelGeom(page, id, lid)).center), { message: 'подпись осталась на линии после перемещения объекта' }).toBeLessThan(4);
    expect(dist(g2.end, g.end)).toBeGreaterThan(100);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-03 label position Start / Center / End and label align Left / Center / Right; both reach the document and the other client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await expect(labelEditor(page)).toBeVisible();
    await page.keyboard.type('a long first line');
    await page.keyboard.press('Enter');
    await page.keyboard.type('short');
    await page.keyboard.press('Escape');
    await expect(labelEditor(page)).toBeHidden();
    const [lid] = await labelIds(page, id);
    const g = await geom(page, id);
    const L = dist(g.start, g.end);
    const select = async () => {
      await selectLine(page, id);
      if ((await labelEl(page, id, lid).getAttribute('data-active')) !== 'true') await clickLabel(page, id, lid);
      await expect(labelGroup(page)).toBeVisible();
    };
    const expectAt = async (f: number, what: string) => {
      await expect.poll(async () => dist((await labelGeom(page, id, lid)).center, g.samples[Math.round(f * 200)]), { message: what }).toBeLessThan(L * 0.06 + 4);
    };
    await select();
    await positionGroup(page).getByRole('button', { name: 'Start', exact: true }).click();
    await expectAt(0.1, 'Start — у начала линии');
    expect(dist((await labelGeom(page, id, lid)).center, g.start)).toBeLessThan(dist((await labelGeom(page, id, lid)).center, g.end));
    await expect(positionGroup(page).getByRole('button', { name: 'Start', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await select();
    await positionGroup(page).getByRole('button', { name: 'End', exact: true }).click();
    await expectAt(0.9, 'End — у конца линии');
    await select();
    await positionGroup(page).getByRole('button', { name: 'Center', exact: true }).click();
    await expectAt(0.5, 'Center — середина линии');
    await expect.poll(async () => dist((await labelGeom(guest.page, id, lid)).center, await pointOn(guest.page, id, 0.5)), { message: 'второй клиент — середина' }).toBeLessThan(L * 0.06 + 4);

    for (const [label, css] of [['Left', 'left'], ['Right', 'right'], ['Center', 'center']] as const) {
      await select();
      await setCombo(page, 'Label align', label);
      await expect.poll(async () => (await labelGeom(page, id, lid)).align, { message: `выравнивание ${label}` }).toBe(css);
      await expect.poll(async () => (await labelGeom(guest.page, id, lid)).align, { message: `второй клиент: ${label}` }).toBe(css);
    }
    // выравнивание строк видно: короткая строка смещается
    await select();
    await setCombo(page, 'Label align', 'Left');
    const leftX = await labelEl(page, id, lid).evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); const rects = Array.from(r.getClientRects()); return rects[rects.length - 1].x; });
    await setCombo(page, 'Label align', 'Right');
    await expect.poll(async () => labelEl(page, id, lid).evaluate((e) => { const r = document.createRange(); r.selectNodeContents(e); const rects = Array.from(r.getClientRects()); return rects[rects.length - 1].x; }), { message: 'короткая строка уходит вправо' }).toBeGreaterThan(leftX + 10);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-03 label direction: Horizontal keeps the text level, Along line turns it to the line angle on a sloped line', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    for (const angle of [30, 150, -60]) {
      const p = await onCanvas(page, 0.45, 0.45);
      const r = 220;
      const from = { x: p.x - (r / 2) * Math.cos((angle * Math.PI) / 180), y: p.y - (r / 2) * Math.sin((angle * Math.PI) / 180) };
      const to = { x: p.x + (r / 2) * Math.cos((angle * Math.PI) / 180), y: p.y + (r / 2) * Math.sin((angle * Math.PI) / 180) };
      const id = await drawLine(page, from, to, { shift: 'during' });
      const g = await geom(page, id);
      const lineAngle = deg(g.start, g.end);
      await selectLine(page, id);
      await barButton(page, 'Add label').click();
      await typeLabel(page, `angle ${angle}`);
      const [lid] = await labelIds(page, id);
      expect(Math.abs((await labelGeom(page, id, lid)).angle), 'Horizontal — без поворота').toBeLessThan(0.5);
      await selectLine(page, id);
      if ((await labelEl(page, id, lid).getAttribute('data-active')) !== 'true') await clickLabel(page, id, lid);
      await setCombo(page, 'Label direction', 'Along line');
      await expect(labelEl(page, id, lid)).toHaveAttribute('data-orientation', 'along');
      const a = (await labelGeom(page, id, lid)).angle;
      // вдоль линии: угол текста совпадает с направлением линии (по модулю 180°), текст не вверх ногами
      const diff = Math.abs((((a - lineAngle) % 180) + 270) % 180 - 90);
      expect(diff, `угол подписи ${a} вдоль линии ${lineAngle}`).toBeLessThan(2);
      expect(Math.abs(a), 'текст не перевёрнут').toBeLessThanOrEqual(90);
      await expect.poll(async () => (await labelGeom(guest.page, id, lid)).angle, { message: 'второй клиент' }).toBeCloseTo(a, 0);
      await page.keyboard.press('Delete').catch(() => undefined);
      await deselect(page);
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-04 a label gets its font, size, color and several lines; another label of the same line is unchanged; the other client and reload see it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'plain');
    await selectLine(page, id);
    await positionGroup(page).getByRole('button', { name: 'Start', exact: true }).click();
    const p = await pointOn(page, id, 0.75);
    await page.mouse.dblclick(p.x, p.y);
    await expect(labelEditor(page)).toBeVisible();
    await page.keyboard.type('line one');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line two');
    await page.keyboard.press('Enter');
    await page.keyboard.type('line three');
    await page.keyboard.press('Escape');
    await expect(labelEditor(page)).toBeHidden();
    const all = await labels(page, id).evaluateAll((els) => els.map((e) => [e.getAttribute('data-label-id') ?? '', (e as HTMLElement).innerText]));
    const plain = all.find(([, t]) => t === 'plain')![0];
    const multi = all.find(([, t]) => t.includes('line one'))![0];
    const before = await labelGeom(page, id, plain);
    let m = await labelGeom(page, id, multi);
    expect(m.text.split('\n').map((x) => x.trim()), 'три строки').toEqual(['line one', 'line two', 'line three']);
    expect(m.height, 'три строки по высоте').toBeGreaterThan(Number.parseFloat(m.fontSize) * 2.5);

    await selectLine(page, id);
    if ((await labelEl(page, id, multi).getAttribute('data-active')) !== 'true') await clickLabel(page, id, multi);
    await expect(labelEl(page, id, multi)).toHaveAttribute('data-active', 'true');
    const fonts = await combo(page, 'Label font').locator('option').evaluateAll((els) => els.map((e) => e.textContent ?? ''));
    expect(fonts.length, 'выбор шрифта').toBeGreaterThanOrEqual(2);
    const font = fonts.find((f) => /serif/i.test(f) && !/sans/i.test(f)) ?? fonts[1];
    await setCombo(page, 'Label font', font);
    await setCombo(page, 'Label size', '32');
    const colors = await combo(page, 'Label color').locator('option').evaluateAll((els) => els.map((e) => [(e as HTMLOptionElement).value, e.textContent ?? '']));
    const [hex, name] = colors.find(([v]) => v.toLowerCase() !== '#1f2937' && v.toLowerCase() !== '#ffffff')!;
    await setCombo(page, 'Label color', name);
    const expectColor = rgba(`rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`);
    await expect.poll(async () => (await labelGeom(page, id, multi)).fontSize).toBe('32px');
    m = await labelGeom(page, id, multi);
    expect(m.fontFamily, 'шрифт сменился').not.toBe(before.fontFamily);
    expect(rgba(m.color)?.slice(0, 3)).toEqual(expectColor?.slice(0, 3));
    expect(m.text.split('\n').length, 'строки сохранились').toBe(3);
    const plainAfter = await labelGeom(page, id, plain);
    expect([plainAfter.fontFamily, plainAfter.fontSize, plainAfter.color], 'другая подпись не изменилась').toEqual([before.fontFamily, before.fontSize, before.color]);

    await expect.poll(async () => (await labelGeom(guest.page, id, multi)).fontSize, { message: 'второй клиент: размер' }).toBe('32px');
    const gm = await labelGeom(guest.page, id, multi);
    expect([gm.fontFamily, gm.color, gm.text.split('\n').length]).toEqual([m.fontFamily, m.color, 3]);
    await untilLine(page, owner.boardId, id, (d) => {
      const lab = d.labels[multi];
      expect(lab.fontSize).toBe(32);
      expect(String(lab.text).split('\n')).toHaveLength(3);
    });
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(labelEl(page, id, multi)).toBeVisible();
    const r = await labelGeom(page, id, multi);
    expect([r.fontFamily, r.fontSize, r.color, r.text.split('\n').length], 'после перезагрузки').toEqual([m.fontFamily, m.fontSize, m.color, 3]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-04 BUG-022 a single click on a label of an unselected line selects that label for editing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  test.fail(true, 'BUG-022 (minor): первый щелчок оставляет активной прежнюю подпись');
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'first');
    const p = await pointOn(page, id, 0.8);
    await page.mouse.dblclick(p.x, p.y);
    await typeLabel(page, 'second');
    const first = (await labels(page, id).evaluateAll((els) => els.map((e) => [e.getAttribute('data-label-id') ?? '', (e as HTMLElement).innerText]))).find(([, t]) => t === 'first')![0];
    await deselect(page);
    const c = (await labelGeom(page, id, first)).center;
    await page.mouse.click(c.x, c.y);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await expect(labelEl(page, id, first), 'щёлкнутая подпись выбрана').toHaveAttribute('data-active', 'true', { timeout: 3000 });
  } finally {
    await owner.close();
  }
});

// ---------- CON-05 ----------

for (const shift of ['during', 'before'] as const) {
  test(`CON-05 with Shift held ${shift === 'during' ? 'while drawing' : 'from the start'} a free line is straight at any angle, not snapped to 45 degrees`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    try {
      const page = owner.page;
      const results: string[] = [];
      for (const angle of [30, 10, 80, 2, 44, 137, -22]) {
        const c = await onCanvas(page, 0.45, 0.45);
        const r = 300;
        const from = { x: c.x - (r / 2) * Math.cos((angle * Math.PI) / 180), y: c.y - (r / 2) * Math.sin((angle * Math.PI) / 180) };
        const to = { x: c.x + (r / 2) * Math.cos((angle * Math.PI) / 180), y: c.y + (r / 2) * Math.sin((angle * Math.PI) / 180) };
        const id = await drawLine(page, from, to, { shift });
        const g = await geom(page, id);
        const a = deg(g.start, g.end);
        results.push(`${angle}→${a.toFixed(1)}`);
        expect(Math.abs(a - angle), `угол ${angle}°: получилось ${a.toFixed(2)}°`).toBeLessThan(1.5);
        expect(g.style, 'прямая').toBe('straight');
        expect(commands(g.d).slice(1), 'один отрезок').toEqual(['L']);
        await untilLine(page, owner.boardId, id, (d) => expect(d.fields.points ?? []).toEqual([]));
        await selectLine(page, id);
        await barButton(page, 'Delete').click();
        await expect(obj(page, id)).toHaveCount(0);
      }
      test.info().annotations.push({ type: 'углы с Shift', description: results.join(', ') });
    } finally {
      await owner.close();
    }
  });
}

test('CON-05 dragging the end of an existing line with Shift gives any angle; the observation without Shift is recorded', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const c = await onCanvas(page, 0.35, 0.45);
    const id = await drawLine(page, c, { x: c.x + 300, y: c.y }, { shift: 'during' });
    await selectLine(page, id);
    const s = (await geom(page, id)).start;
    const to = { x: s.x + 300 * Math.cos((20 * Math.PI) / 180), y: s.y + 300 * Math.sin((20 * Math.PI) / 180) };
    await dragHandle(page, 'line-end', to, { shift: true });
    const g = await geom(page, id);
    expect(Math.abs(deg(g.start, g.end) - 20), `угол с Shift: ${deg(g.start, g.end).toFixed(2)}`).toBeLessThan(1.5);
    expect(g.style).toBe('straight');
    // без Shift — наблюдение (требование поведение без Shift не задаёт)
    await selectLine(page, id);
    const to2 = { x: s.x + 300 * Math.cos((-33 * Math.PI) / 180), y: s.y + 300 * Math.sin((-33 * Math.PI) / 180) };
    await dragHandle(page, 'line-end', to2);
    const g2 = await geom(page, id);
    test.info().annotations.push({ type: 'наблюдение', description: `без Shift жест −33° дал ${deg(g2.start, g2.end).toFixed(1)}°` });
  } finally {
    await owner.close();
  }
});

test('CON-05 boundary: with the elbow or curved type chosen for the previous line, Shift still builds a straight line', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const c = await onCanvas(page, 0.3, 0.3);
    const first = await drawLine(page, c, { x: c.x + 200, y: c.y + 120 });
    await selectLine(page, first);
    await setCombo(page, 'Line type', 'Curved');
    await deselect(page);
    const c2 = await onCanvas(page, 0.3, 0.6);
    const to = { x: c2.x + 300 * Math.cos((25 * Math.PI) / 180), y: c2.y + 300 * Math.sin((25 * Math.PI) / 180) };
    const id = await drawLine(page, c2, to, { shift: 'during' });
    const g = await geom(page, id);
    test.info().annotations.push({ type: 'наблюдение', description: `новая линия после кривой: ${g.style}` });
    expect(Math.abs(deg(g.start, g.end) - 25)).toBeLessThan(1.5);
    expect(g.samples.every((p) => Math.abs(((p.x - g.start.x) * (g.end.y - g.start.y) - (p.y - g.start.y) * (g.end.x - g.start.x)) / dist(g.start, g.end)) < 1.5), 'линия с Shift — прямая').toBe(true);
  } finally {
    await owner.close();
  }
});

test('CON-05 link participant builds a straight line at an arbitrary angle with Shift; the owner sees the same angle', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const g = guest.page;
    const c = await onCanvas(g, 0.3, 0.5);
    const to = { x: c.x + 300 * Math.cos((-17 * Math.PI) / 180), y: c.y + 300 * Math.sin((-17 * Math.PI) / 180) };
    const id = await drawLine(g, c, to, { shift: 'during' });
    const gg = await geom(g, id);
    expect(Math.abs(deg(gg.start, gg.end) + 17)).toBeLessThan(1.5);
    await expect(obj(owner.page, id)).toBeAttached();
    const og = await geom(owner.page, id);
    expect(Math.abs(deg(og.start, og.end) + 17), 'у владельца тот же угол').toBeLessThan(1.5);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CON-06 ----------

test('CON-06 a double click on a bend point of a curve removes only that point; the line and its attached ends stay; the other client sees it; undo returns the point', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await setCombo(page, 'Line type', 'Curved');
    // две промежуточные точки
    let h = centerOf(await boxOf(lineHandle(page, 'line-add-0')));
    await dragHandle(page, 'line-add-0', { x: h.x - 40, y: h.y + 140 });
    await expect(lineHandle(page, 'line-point-0')).toBeVisible();
    h = centerOf(await boxOf(lineHandle(page, 'line-add-1')));
    await dragHandle(page, 'line-add-1', { x: h.x + 60, y: h.y + 80 });
    await expect(lineHandle(page, 'line-point-1')).toBeVisible();
    await untilLine(page, owner.boardId, id, (d) => expect((d.fields.points as unknown[]).length).toBe(2));
    const pts2 = ((await lineDoc(page, owner.boardId, id))!.fields.points as Point[]).map((p) => ({ ...p }));
    const d2 = (await geom(page, id)).d;
    await expect.poll(async () => (await geom(guest.page, id)).d, { message: 'второй клиент — две точки' }).toBe(d2);

    // двойной щелчок по первой точке
    await dblHandle(page, 'line-point-0');
    await untilLine(page, owner.boardId, id, (d) => {
      const pts = d.fields.points as Point[];
      expect(pts, 'осталась одна точка').toHaveLength(1);
      expect(pts[0], 'осталась вторая точка').toEqual(pts2[1]);
      expect(d.fields.lineStyle).toBe('curved');
      expect(endObj(d, 'start')).toBe('a');
      expect(endObj(d, 'end')).toBe('b');
    });
    const d1 = (await geom(page, id)).d;
    expect(d1, 'форма изменилась').not.toBe(d2);
    await expect(obj(page, id)).toBeAttached();
    await expect.poll(async () => (await geom(guest.page, id)).d, { message: 'второй клиент видит удаление точки' }).toBe(d1);

    // отмена возвращает точку
    await page.keyboard.press('Control+z');
    await untilLine(page, owner.boardId, id, (d) => expect((d.fields.points as Point[]).length).toBe(2));
    await expect.poll(async () => (await geom(page, id)).d).toBe(d2);
    await page.keyboard.press('Control+Shift+z');
    await untilLine(page, owner.boardId, id, (d) => expect((d.fields.points as Point[]).length).toBe(1));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CON-06 negative and boundary: a double click on an end removes neither the end nor the line; removing the last bend point leaves a curve with two ends', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await setCombo(page, 'Line type', 'Curved');
    const h = centerOf(await boxOf(lineHandle(page, 'line-add-0')));
    await dragHandle(page, 'line-add-0', { x: h.x - 60, y: h.y + 120 });
    await expect(lineHandle(page, 'line-point-0')).toBeVisible();
    await untilLine(page, owner.boardId, id, (d) => expect((d.fields.points as unknown[]).length).toBe(1));
    const g0 = await geom(page, id);

    for (const end of ['line-start', 'line-end']) {
      await selectLine(page, id, 0.6);
      await dblHandle(page, end);
      await page.waitForTimeout(500);
      await expect(obj(page, id), `${end}: линия на месте`).toBeAttached();
      const g = await geom(page, id);
      expect(dist(g.start, g0.start), `${end}: начало на месте`).toBeLessThan(2);
      expect(dist(g.end, g0.end), `${end}: конец на месте`).toBeLessThan(2);
      await untilLine(page, owner.boardId, id, (d) => {
        expect((d.fields.points as unknown[]).length, `${end}: точка изгиба на месте`).toBe(1);
        expect(endObj(d, 'start')).toBe('a');
        expect(endObj(d, 'end')).toBe('b');
      });
      if (await labelEditor(page).isVisible()) await page.keyboard.press('Escape');
    }

    await selectLine(page, id, 0.6);
    await dblHandle(page, 'line-point-0');
    await untilLine(page, owner.boardId, id, (d) => {
      expect(d.fields.points, 'точек изгиба не осталось').toEqual([]);
      expect(d.fields.lineStyle).toBe('curved');
    });
    await expect(obj(page, id)).toBeAttached();
    const g = await geom(page, id);
    expect(dist(g.start, g0.start)).toBeLessThan(2);
    expect(dist(g.end, g0.end)).toBeLessThan(2);
    await expect(obj(page, id).getByTestId('line-stroke')).toHaveAttribute('data-line-style', 'curved');
  } finally {
    await owner.close();
  }
});

// ---------- CON-07 ----------

test('CON-07 a line without arrowheads at both ends; None at one end keeps the other; reload and the other client see it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await setCombo(page, 'Start', 'Arrow');
    await setCombo(page, 'End', 'Arrow');
    await expect(obj(page, id).getByTestId('line-cap')).toHaveCount(2);
    await setCombo(page, 'Start', 'None');
    await expect(obj(page, id).getByTestId('line-cap'), 'None у начала — стрелка у конца осталась').toHaveCount(1);
    expect(Object.keys((await geom(page, id)).caps)).toEqual(['end']);
    await setCombo(page, 'End', 'None');
    await expect(obj(page, id).getByTestId('line-cap'), 'без наконечников').toHaveCount(0);
    // и никаких маркеров SVG на концах
    expect(await obj(page, id).locator('svg [marker-start], svg [marker-end], marker').count()).toBe(0);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(d.fields.startCap).toBe('none');
      expect(d.fields.endCap).toBe('none');
    });
    await expect(obj(guest.page, id).getByTestId('line-cap'), 'второй клиент').toHaveCount(0);
    await expect(obj(guest.page, id).getByTestId('line-stroke')).toBeAttached();
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(obj(page, id).getByTestId('line-stroke')).toBeAttached();
    await expect(obj(page, id).getByTestId('line-cap'), 'после перезагрузки').toHaveCount(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-26 ----------

test('CVS-26 an end released next to an object snaps to its point; the line follows the moved and resized object, also for the other client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const ba = await boxOf(obj(page, 'a'));
    const bb = await boxOf(obj(page, 'b'));
    // начало — на A, конец отпускаем в 8 px слева от B (не на объекте)
    const wB = anchorOf(bb, 'w');
    const id = await drawLine(page, anchorOf(ba, 'e'), { x: wB.x - 8, y: wB.y + 10 });
    let g = await geom(page, id);
    expect(dist(g.end, wB), 'конец притянут к точке B').toBeLessThanOrEqual(2);
    expect(dist(g.start, anchorOf(ba, 'e')), 'начало — на точке A').toBeLessThanOrEqual(2);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start')).toBe('a');
      expect(endObj(d, 'end')).toBe('b');
    });

    // точки привязки видны, пока тянут конец
    await selectLine(page, id);
    const eh = centerOf(await boxOf(lineHandle(page, 'line-end')));
    await page.mouse.move(eh.x, eh.y);
    await page.mouse.down();
    await page.mouse.move(eh.x + 4, eh.y + 30, { steps: 4 });
    await expect(page.getByTestId('connect-point').first(), 'точки привязки объекта видны').toBeVisible();
    expect(await page.getByTestId('connect-point').count()).toBeGreaterThanOrEqual(4);
    await page.mouse.move(eh.x, eh.y, { steps: 4 });
    await page.mouse.up();
    await untilLine(page, owner.boardId, id, (d) => expect(endObj(d, 'end')).toBe('b'));

    // перемещение B — конец следует
    await moveObject(page, 'b', { x: 60, y: 150 });
    const bb2 = await boxOf(obj(page, 'b'));
    expect(bb2.y - bb.y).toBeGreaterThan(100);
    await expect.poll(async () => dist((await geom(page, id)).end, nearestAnchorPoint(bb2, (await geom(page, id)).end)), { message: 'конец на точке передвинутого B' }).toBeLessThanOrEqual(2);
    g = await geom(page, id);
    expect(dist(g.start, anchorOf(ba, 'e')), 'начало осталось на A').toBeLessThanOrEqual(2);
    // второй клиент
    const gbb = await boxOf(obj(guest.page, 'b'));
    await expect.poll(async () => { const gb = await boxOf(obj(guest.page, 'b')); return nearestAnchor(gb, (await geom(guest.page, id)).end).d; }, { message: 'у второго клиента линия следует за B' }).toBeLessThanOrEqual(2);
    void gbb;

    // перемещение A — начало следует
    await moveObject(page, 'a', { x: -30, y: 200 });
    const ba2 = await boxOf(obj(page, 'a'));
    await expect.poll(async () => nearestAnchor(ba2, (await geom(page, id)).start).d, { message: 'начало следует за A' }).toBeLessThanOrEqual(2);

    // изменение размера A (фигура) — начало следует
    await selectObj(page, 'a');
    const se = centerOf(await boxOf(page.locator('[data-handle="se"]')));
    await page.mouse.move(se.x, se.y);
    await page.mouse.down();
    await page.mouse.move(se.x + 120, se.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const ba3 = await boxOf(obj(page, 'a'));
    expect(ba3.width, 'размер A изменён').toBeGreaterThan(ba2.width + 50);
    await expect.poll(async () => nearestAnchor(ba3, (await geom(page, id)).start).d, { message: 'начало следует за изменённым A' }).toBeLessThanOrEqual(2);
    expect(dist((await geom(page, id)).start, anchorOf(ba2, 'e')), 'точка привязки сместилась вместе с правой стороной').toBeGreaterThan(50);

    // после перезагрузки привязка сохраняется
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(obj(page, id)).toBeAttached();
    await moveObject(page, 'b', { x: -100, y: -60 });
    const bb4 = await boxOf(obj(page, 'b'));
    await expect.poll(async () => nearestAnchor(bb4, (await geom(page, id)).end).d, { message: 'после перезагрузки линия следует за B' }).toBeLessThanOrEqual(2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

function nearestAnchorPoint(b: Box, p: Point): Point {
  return anchorOf(b, nearestAnchor(b, p).a);
}

test('CVS-26 an end dragged away from its object is detached and no longer follows; the other end stays attached; Detach frees both ends in place', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    // начало оттягиваем в пустое место
    const s0 = (await geom(page, id)).start;
    const free = { x: s0.x - 60, y: s0.y + 260 };
    await dragHandle(page, 'line-start', free, { shift: true }); // Shift — без привязки угла к 45° (CON-05)
    let g = await geom(page, id);
    expect(dist(g.start, free), 'начало в пустом месте').toBeLessThan(6);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start'), 'начало отвязано').toBeUndefined();
      expect(endObj(d, 'end'), 'конец привязан').toBe('b');
    });
    const startFree = g.start;
    await moveObject(page, 'a', { x: 80, y: 40 });
    g = await geom(page, id);
    expect(dist(g.start, startFree), 'отвязанное начало не следует за A').toBeLessThan(1);
    await moveObject(page, 'b', { x: 0, y: 100 });
    const bb = await boxOf(obj(page, 'b'));
    await expect.poll(async () => nearestAnchor(bb, (await geom(page, id)).end).d, { message: 'конец по-прежнему следует за B' }).toBeLessThanOrEqual(2);

    // вторая линия — кнопка Detach
    const id2 = await connect(page, 'a', 'b');
    await selectLine(page, id2);
    const before = await geom(page, id2);
    await barButton(page, 'Detach').click();
    await untilLine(page, owner.boardId, id2, (d) => {
      expect(endObj(d, 'start')).toBeUndefined();
      expect(endObj(d, 'end')).toBeUndefined();
    });
    const after = await geom(page, id2);
    expect(dist(after.start, before.start), 'Detach: начало на месте').toBeLessThan(1);
    expect(dist(after.end, before.end), 'Detach: конец на месте').toBeLessThan(1);
    await moveObject(page, 'a', { x: -40, y: 120 });
    await moveObject(page, 'b', { x: 70, y: -50 });
    const moved = await geom(page, id2);
    expect(dist(moved.start, before.start), 'после Detach не следует за A').toBeLessThan(1);
    expect(dist(moved.end, before.end), 'после Detach не следует за B').toBeLessThan(1);
    const gm = await geom(guest.page, id2);
    const gs = await geom(guest.page, id2);
    expect(dist(gm.start, gs.start)).toBeLessThan(1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-26 negative: an end released far from any object is not attached and does not follow objects', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const ba = await boxOf(obj(page, 'a'));
    const bb = await boxOf(obj(page, 'b'));
    const from = { x: ba.x + ba.width + 120, y: ba.y + 30 };
    const to = { x: bb.x - 150, y: bb.y + bb.height / 2 }; // вдали от края холста: у края вид сдвигается (CVS-13)
    const id = await drawLine(page, from, to);
    const g = await geom(page, id);
    expect(dist(g.start, from), `начало ${JSON.stringify(g.start)} нажатие ${JSON.stringify(from)} конец ${JSON.stringify(g.end)} отпускание ${JSON.stringify(to)}`).toBeLessThan(25);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start')).toBeUndefined();
      expect(endObj(d, 'end')).toBeUndefined();
    });
    await moveObject(page, 'a', { x: 60, y: 60 });
    await moveObject(page, 'b', { x: -60, y: 60 });
    const g2 = await geom(page, id);
    expect(dist(g2.start, g.start)).toBeLessThan(1);
    expect(dist(g2.end, g.end)).toBeLessThan(1);
  } finally {
    await owner.close();
  }
});

test('CVS-26 link participant moves an attached object; the owner sees the line follow', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await connect(page, 'a', 'b');
    await deselect(page);
    await expect(obj(guest.page, id)).toBeAttached();
    const before = await geom(page, id);
    await moveObject(guest.page, 'a', { x: 40, y: 220 });
    await expect.poll(async () => dist((await geom(page, id)).start, before.start), { message: 'у владельца начало сдвинулось' }).toBeGreaterThan(100);
    const ba = await boxOf(obj(page, 'a'));
    await expect.poll(async () => nearestAnchor(ba, (await geom(page, id)).start).d, { message: 'начало на точке A у владельца' }).toBeLessThanOrEqual(2);
    // и участник отвязывает — у владельца линия больше не следует
    await selectLine(guest.page, id);
    await barButton(guest.page, 'Detach').click();
    await untilLine(page, owner.boardId, id, (d) => expect(endObj(d, 'start')).toBeUndefined());
    const g1 = await geom(page, id);
    await moveObject(page, 'a', { x: 100, y: -80 });
    expect(dist((await geom(page, id)).start, g1.start)).toBeLessThan(1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- SHP-04 (палитра линии, Q-003 п. 3) ----------

async function placeText(page: Page, fx: number, fy: number, text: string) {
  const before = new Set(await objectIds(page));
  await tool(page, 'Text').click();
  const p = await onCanvas(page, fx, fy);
  await page.mouse.click(p.x, p.y);
  await expect(objectText(page)).toBeVisible();
  let id = '';
  await expect(async () => {
    id = (await objectIds(page)).find((x) => !before.has(x)) ?? '';
    expect(id).not.toBe('');
  }).toPass({ timeout: 5000 });
  await page.keyboard.type(text);
  await page.keyboard.press('Escape');
  await expect(objectText(page)).toBeHidden();
  return id;
}

test('SHP-04 recent custom colors of text, sticky note and shape do not appear in the line palette; a custom line color goes to the line recent colors only, is applied from the list and survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const TEXT = '#0a7f3c';
    const STICKY = '#654321';
    const SHAPE = '#123456';
    const LINE = '#cc3300';
    // свой цвет текста
    const text = await placeText(page, 0.8, 0.15, 'colored');
    await selectObj(page, text);
    await customColor(page, 'Custom text color', TEXT);
    await expect.poll(() => recentInSelection(page)).toContain(TEXT);
    // свой цвет стикера (B — стикер)
    await deselect(page);
    await tool(page, 'Sticky note').click();
    await expect(stickyPalette(page)).toBeVisible();
    await stickyPalette(page).getByLabel('Custom color', { exact: true }).fill(STICKY);
    const sp = await onCanvas(page, 0.85, 0.45);
    await page.mouse.click(sp.x, sp.y);
    await expect(objectText(page)).toBeVisible();
    await page.keyboard.type('custom');
    await page.keyboard.press('Escape');
    await expect(objectText(page)).toBeHidden();
    // свой цвет фигуры (A — фигура)
    await selectObj(page, 'a');
    await customColor(page, 'Custom fill', SHAPE);
    await expect.poll(() => recentIn(page, 'Fill')).toContain(SHAPE);
    await deselect(page);
    await tool(page, 'Sticky note').click();
    await expect.poll(() => recentInStickyPalette(page), { message: 'свой цвет стикера сохранён' }).toContain(STICKY);
    await page.keyboard.press('Escape');

    // линия: в палитре нет чужих недавних
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    const lineAll = await allOptionsIn(page, 'Line color');
    for (const c of [TEXT, STICKY, SHAPE]) expect(lineAll, `${c} нет в палитре линии`).not.toContain(c);
    expect(await recentInSelection(page), 'нет чужих недавних нигде в панели линии').toEqual(expect.not.arrayContaining([TEXT, STICKY, SHAPE]));
    // свой цвет линии
    await customColor(page, 'Custom line color', LINE);
    await expect.poll(async () => (await geom(page, id)).stroke).toBe(LINE);
    await expect.poll(() => recentIn(page, 'Line color')).toEqual([LINE]);
    await untilLine(page, owner.boardId, id, (d) => expect(String(d.fields.stroke).toLowerCase()).toBe(LINE));
    // цвет линии не попадает в недавние текста, стикера и фигуры
    await selectObj(page, text);
    expect(await recentInSelection(page), 'цвет линии не в недавних текста').not.toContain(LINE);
    await selectObj(page, 'a');
    expect(await recentInSelection(page), 'цвет линии не в недавних фигуры').not.toContain(LINE);
    await selectObj(page, 'b');
    expect(await recentInSelection(page), 'цвет линии не в недавних стикера').not.toContain(LINE);
    await deselect(page);
    await tool(page, 'Sticky note').click();
    expect(await recentInStickyPalette(page), 'цвет линии не в палитре стикеров').not.toContain(LINE);
    await page.keyboard.press('Escape');

    // после перезагрузки: применить из недавних к новой линии
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(obj(page, id)).toBeAttached();
    const c = await onCanvas(page, 0.3, 0.85);
    const id2 = await drawLine(page, c, { x: c.x + 250, y: c.y });
    await selectLine(page, id2);
    expect(await recentIn(page, 'Line color'), 'недавний цвет линии пережил перезагрузку').toEqual([LINE]);
    await combo(page, 'Line color').selectOption(LINE);
    await expect.poll(async () => (await geom(page, id2)).stroke).toBe(LINE);
    await untilLine(page, owner.boardId, id2, (d) => expect(String(d.fields.stroke).toLowerCase()).toBe(LINE));
    expect(await recentIn(page, 'Line color')).not.toEqual(expect.arrayContaining([TEXT, STICKY, SHAPE]));
  } finally {
    await owner.close();
  }
});

test('SHP-04 boundary: recent line colors are limited, the newest comes first and a repeated color is not duplicated', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const c = await onCanvas(page, 0.3, 0.4);
    const id = await drawLine(page, c, { x: c.x + 300, y: c.y + 100 });
    await selectLine(page, id);
    const colors = Array.from({ length: 10 }, (_, i) => `#${(0x203040 + i * 0x0b0a09).toString(16).padStart(6, '0')}`);
    for (const col of colors) {
      await customColor(page, 'Custom line color', col);
      await expect.poll(async () => (await geom(page, id)).stroke).toBe(col);
    }
    let recent = await recentIn(page, 'Line color');
    expect(recent[0], 'последний — первым').toBe(colors[colors.length - 1]);
    expect(recent.length, 'список ограничен').toBeLessThan(colors.length);
    expect(recent.length).toBeGreaterThanOrEqual(5);
    const again = colors[colors.length - 3];
    await customColor(page, 'Custom line color', again);
    await expect.poll(async () => (await recentIn(page, 'Line color'))[0]).toBe(again);
    recent = await recentIn(page, 'Line color');
    expect(recent.filter((x) => x === again)).toHaveLength(1);
    expect(new Set(recent).size).toBe(recent.length);
  } finally {
    await owner.close();
  }
});

test('SHP-04 link participant: a custom line color goes to the participant line recent colors, not to the shape colors', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const g = guest.page;
    const C = '#5c1f7a';
    await expect(obj(g, 'b')).toBeVisible();
    const id = await connect(g, 'a', 'b');
    await selectLine(g, id);
    await customColor(g, 'Custom line color', C);
    await expect.poll(async () => (await geom(g, id)).stroke).toBe(C);
    await expect.poll(() => recentIn(g, 'Line color')).toContain(C);
    await expect.poll(async () => (await geom(owner.page, id)).stroke, { message: 'владелец видит цвет' }).toBe(C);
    await selectObj(g, 'a');
    expect(await recentInSelection(g), 'не в недавних фигуры участника').not.toContain(C);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- COL-01, CVS-07 ----------

test('COL-01 two clients change one line at the same time (type, arrowhead, label text); both see the same result with both edits', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const g = guest.page;
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'base');
    await expect(labels(g, id)).toHaveCount(1);
    await selectLine(page, id);
    await selectLine(g, id);
    await Promise.all([
      setCombo(page, 'Line type', 'Curved'),
      setCombo(g, 'End', 'Diamond'),
    ]);
    await Promise.all([setCombo(page, 'Start', 'Circle'), setCombo(g, 'Line width', '6')]);
    for (const p of [page, g]) {
      await expect(obj(p, id).getByTestId('line-stroke')).toHaveAttribute('data-line-style', 'curved');
      await expect(obj(p, id).getByTestId('line-stroke')).toHaveAttribute('stroke-width', '6');
      await expect.poll(async () => { const c = (await geom(p, id)).caps; return `${c.start?.cap}/${c.end?.cap}`; }).toBe('circle/diamond');
    }
    await untilLine(page, owner.boardId, id, (d) => {
      expect(d.fields.lineStyle).toBe('curved');
      expect(d.fields.endCap).toBe('diamond');
      expect(d.fields.startCap).toBe('circle');
      expect(d.fields.strokeWidth).toBe(6);
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 undo and redo of own line creation, type, arrowhead and swap leave the other client line alone', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await ownerWithAB(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const g = guest.page;
    const c = await onCanvas(g, 0.4, 0.85);
    const other = await drawLine(g, c, { x: c.x + 200, y: c.y });
    await selectLine(g, other);
    await setCombo(g, 'Line type', 'Elbow');
    await expect(obj(page, other)).toBeAttached();

    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await setCombo(page, 'Line type', 'Curved');
    await setCombo(page, 'Start', 'Circle');
    await barButton(page, 'Swap ends').click();
    await untilLine(page, owner.boardId, id, (d) => expect(endObj(d, 'start')).toBe('b'));
    await deselect(page);
    const undo = () => page.keyboard.press('Control+z');
    await undo();
    await untilLine(page, owner.boardId, id, (d) => expect(endObj(d, 'start'), 'отмена обмена').toBe('a'));
    await undo();
    await untilLine(page, owner.boardId, id, (d) => expect(d.fields.startCap, 'отмена наконечника').toBe('none'));
    await undo();
    await untilLine(page, owner.boardId, id, (d) => expect(d.fields.lineStyle, 'отмена вида').toBe('straight'));
    await undo();
    await expect(obj(page, id), 'отмена создания').toHaveCount(0);
    await expect(obj(g, id)).toHaveCount(0);
    await expect(obj(page, other).getByTestId('line-stroke'), 'линия участника не тронута').toHaveAttribute('data-line-style', 'elbow');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Control+Shift+z');
    await untilLine(page, owner.boardId, id, (d) => {
      expect(d.fields.lineStyle).toBe('curved');
      expect(d.fields.startCap).toBe('circle');
      expect(endObj(d, 'start')).toBe('b');
    });
    await expect(obj(g, id)).toBeAttached();
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- UI ----------

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

test('UI-01 UI-03 the line Selection panel with its label group and custom color follows the common style; the Line tool has the C shortcut', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const accent = (await signature(page, page.getByRole('button', { name: 'Share', exact: true })))['background-color'];
    // клавиша C выбирает инструмент Line
    await canvas(page).click({ position: { x: 5, y: 5 } }).catch(() => undefined);
    await deselect(page);
    await page.keyboard.press('c');
    const before = new Set(await objectIds(page));
    const p = await onCanvas(page, 0.4, 0.8);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move(p.x + 200, p.y - 30, { steps: 8 });
    await page.mouse.up();
    const id = await waitNewLine(page, before);
    await selectLine(page, id);
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'styled');
    await selectLine(page, id);
    await clickLabel(page, id, (await labelIds(page, id))[0]);
    await expect(labelGroup(page)).toBeVisible();
    await barButton(page, 'Custom color').click();
    await expect(customGroup(page)).toBeVisible();
    await expectFloatingPanel(selectionBar(page), 'панель Selection линии');
    await expectNeutralOrAccent(selectionBar(page), accent, 'панель Selection линии');
    await barButton(page, 'Swap ends').focus();
    await page.keyboard.press('Tab');
    const fo = await page.locator(':focus').evaluate((e) => { const cs = getComputedStyle(e); return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`; });
    expect.soft(/none\|0px\|none/.test(fo), `видимый фокус: ${fo}`).toBe(false);
  } finally {
    await owner.close();
  }
});

test('UI-04 MOB-06 on a phone a line is drawn by finger from one object to another and attached; its panel fits the screen with 44x44 targets', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const vw = viewport!.width;
    await seed(page, owner.boardId, {
      a: { type: 'shape', shape: 'rectangle', x: 150, y: 120, width: 80, height: 60 } as Obj,
      b: { type: 'sticky', x: 300, y: 330, width: 90, height: 90 } as Obj,
    });
    const ba = await boxOf(obj(page, 'a'));
    const bb = await boxOf(obj(page, 'b'));
    const before = new Set(await objectIds(page));
    await pickLine(page, true);
    const f = await Finger.of(page);
    await f.down(centerOf(ba));
    await f.moveTo(centerOf(ba), centerOf(bb), 12);
    await f.up();
    const id = await waitNewLine(page, before);
    await untilLine(page, owner.boardId, id, (d) => {
      expect(endObj(d, 'start'), 'палец: начало привязано к A').toBe('a');
      expect(endObj(d, 'end'), 'палец: конец привязан к B').toBe('b');
    });
    if ((await obj(page, id).getAttribute('aria-selected')) !== 'true') {
      const p = await pointOn(page, id, 0.3);
      await page.touchscreen.tap(p.x, p.y);
    }
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    const bar = selectionBar(page);
    await expect(bar).toBeVisible();
    const b = await boxOf(bar);
    expect.soft(b.x, 'панель в пределах экрана слева').toBeGreaterThanOrEqual(-0.5);
    expect.soft(b.x + b.width, 'панель в пределах экрана справа').toBeLessThanOrEqual(vw + 0.5);
    const small: string[] = [];
    for (const t of await bar.locator('button, select').all()) {
      if (!(await t.isVisible())) continue;
      const tb = await boxOf(t);
      if (Math.round(tb.width) < 44 || Math.round(tb.height) < 44) small.push(`${(await t.textContent())?.trim().slice(0, 20)} ${Math.round(tb.width)}×${Math.round(tb.height)}`);
    }
    // маркеры концов: видимый кружок меньше, область нажатия (::after) — не меньше 44×44
    for (const h of ['line-start', 'line-end']) {
      const hit = await lineHandle(page, h).evaluate((e) => {
        const r = e.getBoundingClientRect();
        const a = getComputedStyle(e, '::after');
        const w = a.content !== 'none' ? parseFloat(a.width) : 0;
        const ht = a.content !== 'none' ? parseFloat(a.height) : 0;
        return { w: Math.max(r.width, w), h: Math.max(r.height, ht) };
      });
      if (Math.round(hit.w) < 44 || Math.round(hit.h) < 44) small.push(`маркер ${h} ${Math.round(hit.w)}×${Math.round(hit.h)}`);
    }
    expect(small, 'цели панели линии ≥ 44×44').toEqual([]);
    // смена вида касанием
    await combo(page, 'Line type').selectOption({ label: 'Elbow' });
    await expect(obj(page, id).getByTestId('line-stroke')).toHaveAttribute('data-line-style', 'elbow');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(sw, 'нет горизонтальной прокрутки').toBeLessThanOrEqual(vw + 1);
  } finally {
    await owner.close();
  }
});

// ---------- ARCH ----------

test('ARCH lines are scene objects of the board document: drawing and editing them sends no HTTP requests to /api and no localhost; a late client gets type "line"', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await ownerWithAB(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const api: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api') && u.pathname !== '/api/ws' && u.pathname !== '/api/session' && r.resourceType() !== 'websocket') api.push(`${r.method()} ${u.pathname}`);
      expect(r.url()).not.toContain('localhost');
    });
    const id = await connect(page, 'a', 'b');
    await selectLine(page, id);
    await setCombo(page, 'Line type', 'Elbow');
    await setCombo(page, 'Start', 'Diamond');
    await barButton(page, 'Swap ends').click();
    await barButton(page, 'Add label').click();
    await typeLabel(page, 'arch');
    await customColor(page, 'Custom line color', '#336699');
    await moveObject(page, 'a', { x: 30, y: 60 });
    await page.waitForTimeout(500);
    expect(api, 'правка линии не идёт через HTTP /api').toEqual([]);
    const d = (await lineDoc(page, owner.boardId, id))!;
    expect(d.fields.type).toBe('line');
    const doc = await docSeenByLateClient(page, `board=${owner.boardId}`);
    const raw = JSON.stringify(doc.toJSON());
    expect(raw, 'недавние цвета не в документе').not.toContain('recent');
  } finally {
    await owner.close();
  }
});
