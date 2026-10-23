// Приёмка T6.5 · рисование: DRW-01…DRW-06, MOB-04, MOB-05; попутно COL-01, CVS-07, CVS-19, UI-04, ARCH.
// Сценарии — docs/qa/reports/T6.5.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.5.
// Наблюдение: геометрия SVG штриха на экране (getScreenCTM), DOM следа лазера, кадры канала доски,
// документ доски глазами позднего клиента по /api/ws, второй клиент. Код из apps/ не импортируется.
// Стилус — CDP Input.dispatchMouseEvent с pointerType 'pen'; пальцы и ладонь — CDP Input.dispatchTouchEvent
// (ладонь — большое пятно касания radiusX/radiusY). Настоящее устройство эмуляция не заменяет (см. отчёт).
import type { Browser, CDPSession, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, docState, handle, obj, objectIds, onCanvas, seed, selectionBar, tool, untilDoc, type Box, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- интерфейс (подписи из handoff T6.5) ----------

const drawPanel = (page: Page) => page.getByRole('toolbar', { name: 'Drawing', exact: true });
const drawBtn = (page: Page, name: string) => drawPanel(page).getByRole('button', { name, exact: true });
const presets = (page: Page, brush = 'Pen') => drawPanel(page).getByRole('group', { name: `${brush} presets`, exact: true }).getByRole('button');
const colorGroup = (page: Page, brush = 'Pen') => drawPanel(page).getByRole('group', { name: `${brush} color`, exact: true });
const thickness = (page: Page) => drawPanel(page).getByRole('combobox', { name: 'Thickness', exact: true });
const stylusSwitch = (page: Page) => drawPanel(page).getByRole('switch', { name: 'Stylus draws' });
const strokes = (page: Page) => page.locator('[data-object-id][data-type="drawing"]');
const strokeIds = async (page: Page) => (await strokes(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();

async function pickPen(page: Page) {
  await tool(page, 'Pen').click();
  await expect(drawPanel(page)).toBeVisible();
  await expect(drawBtn(page, 'Pen')).toHaveAttribute('aria-pressed', 'true');
}

async function pick(page: Page, name: 'Pen' | 'Marker' | 'Eraser' | 'Laser') {
  if (!(await drawPanel(page).isVisible())) await pickPen(page);
  await drawBtn(page, name).click();
  await expect(drawBtn(page, name)).toHaveAttribute('aria-pressed', 'true');
}

type Stroke = { pts: Point[]; width: number; stroke: string; opacity: number; brush: string; d: string };

/** Видимый штрих на экране: 200 отсчётов вдоль пути, толщина, цвет, прозрачность. */
async function strokeOf(page: Page, id: string): Promise<Stroke> {
  return obj(page, id)
    .locator('path[data-testid="drawing-stroke"]')
    .evaluate((p) => {
      const path = p as SVGPathElement;
      const m = path.getScreenCTM()!;
      const len = path.getTotalLength();
      const pts = [];
      for (let i = 0; i <= 200; i++) {
        const q = path.getPointAtLength((len * i) / 200);
        const s = new DOMPoint(q.x, q.y).matrixTransform(m);
        pts.push({ x: s.x, y: s.y });
      }
      const cs = getComputedStyle(path);
      return {
        pts,
        width: Number(path.getAttribute('stroke-width') ?? cs.strokeWidth.replace('px', '')),
        stroke: path.getAttribute('stroke') ?? cs.stroke,
        opacity: Number(cs.strokeOpacity),
        brush: path.getAttribute('data-brush') ?? '',
        d: path.getAttribute('d') ?? '',
      };
    });
}

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
const nearest = (pts: Point[], p: Point) => Math.min(...pts.map((q) => dist(p, q)));
/** Наибольшее отклонение точек от прямой через первую и последнюю точку. */
function deviation(pts: Point[]): number {
  const a = pts[0];
  const b = pts[pts.length - 1];
  const L = dist(a, b) || 1;
  return Math.max(...pts.map((p) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L));
}
function bounds(pts: Point[]): Box {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/** Зигзаг в долях холста — путь свободной линии. */
async function zigzag(page: Page, fx: number, fy: number, w = 0.3, h = 0.12): Promise<Point[]> {
  const out: Point[] = [];
  for (let i = 0; i <= 6; i++) out.push(await onCanvas(page, fx + (w * i) / 6, fy + (i % 2 ? h : 0)));
  return out;
}

/** Нарисовать мышью по точкам и вернуть id нового штриха. */
async function drawWithMouse(page: Page, pts: Point[], opts: { shift?: boolean } = {}): Promise<string> {
  const before = await strokeIds(page);
  if (opts.shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps: 6 });
  await page.mouse.up();
  if (opts.shift) await page.keyboard.up('Shift');
  let id = '';
  await expect(async () => {
    const fresh = (await strokeIds(page)).filter((x) => !before.includes(x));
    expect(fresh, 'должен появиться ровно один новый штрих').toHaveLength(1);
    id = fresh[0];
  }).toPass({ timeout: 10_000 });
  return id;
}

/** Провести мышью (ластик, лазер) без ожидания нового объекта. */
async function sweep(page: Page, pts: Point[], steps = 8) {
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps });
  await page.mouse.up();
}

/** Каждая точка жеста лежит на видимом штрихе (допуск в пикселях экрана). */
function followsPath(s: Stroke, path: Point[], tol = 8) {
  const dense: Point[] = [];
  for (let i = 1; i < path.length; i++)
    for (let k = 0; k <= 10; k++) dense.push({ x: path[i - 1].x + ((path[i].x - path[i - 1].x) * k) / 10, y: path[i - 1].y + ((path[i].y - path[i - 1].y) * k) / 10 });
  for (const p of path) expect(nearest(s.pts, p), `точка жеста ${JSON.stringify(p)} не на штрихе`).toBeLessThanOrEqual(tol);
  for (const q of s.pts) expect(nearest(dense, q), 'штрих уходит от пути жеста').toBeLessThanOrEqual(tol);
}

/** Сопоставимая форма штриха: точки в долях его рамки. */
const normalized = (pts: Point[]) => {
  const b = bounds(pts);
  return pts.map((p) => ({ x: (p.x - b.x) / (b.width || 1), y: (p.y - b.y) / (b.height || 1) }));
};

const STICKY: Obj = { type: 'sticky', x: 600, y: 330, width: 100, height: 100, text: 'ref' } as Obj;

async function ownerAndGuest(browser: Browser, f: Fx) {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  return { owner, guest, opts: o };
}

/** Запросы страницы к /api во время действия (кроме канала WebSocket). */
function watchApi(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    // /api/session — фоновая проверка сессии вкладки (ACC-05), к рисованию не относится.
    if (u.pathname.startsWith('/api') && !u.pathname.startsWith('/api/ws') && u.pathname !== '/api/session') seen.push(`${r.method()} ${u.pathname}`);
  });
  return seen;
}

// =====================================================================
// DRW-01 · перо и маркер, цвет, толщина
// =====================================================================

test('DRW-01 pen draws a freehand line along the gesture; the second client sees it live and it survives a reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const path = await zigzag(page, 0.25, 0.35);
    const id = await drawWithMouse(page, path);
    const s = await strokeOf(page, id);
    expect(s.brush).toBe('pen');
    followsPath(s, path);
    expect(deviation(s.pts), 'свободная линия, а не отрезок').toBeGreaterThan(30);
    // Второй клиент без перезагрузки: тот же штрих (форма в долях рамки совпадает).
    await expect(obj(guest.page, id)).toBeAttached({ timeout: 10_000 });
    const g = await strokeOf(guest.page, id);
    const n1 = normalized(s.pts);
    const n2 = normalized(g.pts);
    for (let i = 0; i < n1.length; i += 20) expect(dist(n1[i], n2[i])).toBeLessThan(0.05);
    expect(g.stroke).toBe(s.stroke);
    // Документ: объект с дискриминатором type.
    const d = await untilDoc(page, owner.boardId, (x) => x.objects[id], (v) => expect(v).toBeTruthy());
    expect(typeof d.type).toBe('string');
    // Перезагрузка.
    await page.reload();
    await expect(obj(page, id)).toBeAttached();
    const r = await strokeOf(page, id);
    expect(deviation(r.pts)).toBeGreaterThan(30);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-01 marker draws a stroke distinct from the pen (brush, transparency or width)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const pen = await strokeOf(page, await drawWithMouse(page, await zigzag(page, 0.2, 0.3)));
    await pick(page, 'Marker');
    const mpath = await zigzag(page, 0.2, 0.6);
    const mid = await drawWithMouse(page, mpath);
    const marker = await strokeOf(page, mid);
    followsPath(marker, mpath, 12);
    expect(marker.brush).toBe('marker');
    expect(marker.opacity < pen.opacity || marker.width > pen.width, 'маркер отличается от пера').toBe(true);
    expect(marker.opacity).toBeLessThan(1);
    await expect(obj(guest.page, mid)).toBeAttached({ timeout: 10_000 });
    expect((await strokeOf(guest.page, mid)).opacity).toBeLessThan(1);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-01 palette colour, custom colour and thickness apply to the next stroke only', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const first = await drawWithMouse(page, await zigzag(page, 0.2, 0.2, 0.2));
    const s1 = await strokeOf(page, first);
    // Цвет из палитры: образец, отличный от текущего.
    const swatches = colorGroup(page).getByRole('button');
    expect(await swatches.count()).toBeGreaterThan(2);
    let chosen = -1;
    for (let i = 0; i < (await swatches.count()); i++) {
      if ((await swatches.nth(i).getAttribute('aria-pressed')) !== 'true') {
        chosen = i;
        break;
      }
    }
    await swatches.nth(chosen).click();
    await expect(swatches.nth(chosen)).toHaveAttribute('aria-pressed', 'true');
    const second = await drawWithMouse(page, await zigzag(page, 0.2, 0.4, 0.2));
    const s2 = await strokeOf(page, second);
    expect(s2.stroke.toLowerCase()).not.toBe(s1.stroke.toLowerCase());
    expect((await strokeOf(page, first)).stroke).toBe(s1.stroke);
    // Свой цвет.
    await colorGroup(page).locator('input[type="color"]').fill('#12ab34');
    await expect(colorGroup(page).getByRole('button', { name: 'Custom #12ab34' })).toBeVisible();
    // Толщина.
    await thickness(page).selectOption('16');
    const third = await drawWithMouse(page, await zigzag(page, 0.2, 0.6, 0.2));
    const s3 = await strokeOf(page, third);
    expect(s3.stroke.toLowerCase()).toBe('#12ab34');
    expect(s3.width).toBe(16);
    expect(s2.width).not.toBe(16);
    // Прежние штрихи не изменились.
    expect((await strokeOf(page, second)).stroke).toBe(s2.stroke);
    expect((await strokeOf(page, second)).width).toBe(s2.width);
    await expect(obj(guest.page, third)).toBeAttached({ timeout: 10_000 });
    const g3 = await strokeOf(guest.page, third);
    expect(g3.stroke.toLowerCase()).toBe('#12ab34');
    expect(g3.width).toBe(16);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-01 a link participant draws with the pen and the owner sees the stroke', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    await pickPen(guest.page);
    const id = await drawWithMouse(guest.page, await zigzag(guest.page, 0.3, 0.4));
    await expect(obj(owner.page, id)).toBeAttached({ timeout: 10_000 });
    expect(deviation((await strokeOf(owner.page, id)).pts)).toBeGreaterThan(30);
    await owner.page.reload();
    await expect(obj(owner.page, id)).toBeAttached();
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-01 MOB-06 on a phone a finger draws with the pen and the desktop owner sees the stroke', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = guest.page;
    await pickPen(page);
    const path = await zigzag(page, 0.2, 0.35, 0.5, 0.1);
    const f = await Fingers.of(page);
    const before = await strokeIds(page);
    await f.path([path]);
    let id = '';
    await expect(async () => {
      const fresh = (await strokeIds(page)).filter((x) => !before.includes(x));
      expect(fresh).toHaveLength(1);
      id = fresh[0];
    }).toPass({ timeout: 10_000 });
    followsPath(await strokeOf(page, id), path, 10);
    await expect(obj(owner.page, id)).toBeAttached({ timeout: 10_000 });
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// DRW-02 · три пресета толщины пера
// =====================================================================

test('DRW-02 the pen has three thickness presets giving three widths; choice and edited value survive a reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickPen(page);
    await expect(presets(page)).toHaveCount(3);
    const widths: number[] = [];
    for (let i = 0; i < 3; i++) {
      await presets(page).nth(i).click();
      await expect(presets(page).nth(i)).toHaveAttribute('aria-pressed', 'true');
      const id = await drawWithMouse(page, await zigzag(page, 0.15, 0.15 + i * 0.2, 0.25));
      widths.push((await strokeOf(page, id)).width);
    }
    expect(new Set(widths).size, `ширины пресетов ${widths}`).toBe(3);
    // Выбор хранится.
    await presets(page).nth(2).click();
    await thickness(page).selectOption('6');
    await expect(presets(page).nth(2)).toHaveAccessibleName(/6$/);
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await pickPen(page);
    await expect(presets(page)).toHaveCount(3);
    await expect(presets(page).nth(2)).toHaveAttribute('aria-pressed', 'true');
    await expect(presets(page).nth(2)).toHaveAccessibleName(/6$/);
    const id = await drawWithMouse(page, await zigzag(page, 0.5, 0.7, 0.2));
    expect((await strokeOf(page, id)).width).toBe(6);
    // Другие пресеты сохранили свои значения.
    await presets(page).nth(0).click();
    const id0 = await drawWithMouse(page, await zigzag(page, 0.5, 0.5, 0.2));
    expect((await strokeOf(page, id0)).width).toBe(widths[0]);
  } finally {
    await owner.close();
  }
});

// =====================================================================
// DRW-03 · ластик и блокировка
// =====================================================================

/** Горизонтальный штрих пера в доле холста по высоте fy. */
async function hLine(page: Page, fy: number, fx = 0.25, w = 0.3) {
  return drawWithMouse(page, [await onCanvas(page, fx, fy), await onCanvas(page, fx + w / 2, fy + 0.01), await onCanvas(page, fx + w, fy)]);
}

async function lockById(page: Page, id: string, lock = true) {
  await page.keyboard.press('Escape');
  const s = await strokeOf(page, id);
  const p = s.pts[Math.floor(s.pts.length / 2)];
  await page.mouse.click(p.x, p.y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
  await selectionBar(page).getByRole('button', { name: lock ? 'Lock' : 'Unlock', exact: true }).click();
  if (lock) await expect(obj(page, id)).toHaveAttribute('data-locked', 'true');
  else await expect(obj(page, id)).not.toHaveAttribute('data-locked', 'true');
  await page.keyboard.press('Escape');
}

test('DRW-03 the eraser removes a stroke it crosses; the second client and a reload agree; a miss erases nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const a = await hLine(page, 0.3);
    const b = await hLine(page, 0.6);
    await expect(obj(guest.page, a)).toBeAttached({ timeout: 10_000 });
    await pick(page, 'Eraser');
    // Проход мимо (далеко от обоих) ничего не стирает.
    await sweep(page, [await onCanvas(page, 0.75, 0.2), await onCanvas(page, 0.75, 0.8)]);
    await sleep(800);
    expect(await strokeIds(page)).toEqual([a, b].sort());
    // Проход через первый штрих.
    await sweep(page, [await onCanvas(page, 0.4, 0.2), await onCanvas(page, 0.4, 0.42)]);
    await expect(obj(page, a)).toHaveCount(0);
    await expect(obj(page, b)).toHaveCount(1);
    await expect(obj(guest.page, a)).toHaveCount(0, { timeout: 10_000 });
    await expect(obj(guest.page, b)).toHaveCount(1);
    const d = await untilDoc(page, owner.boardId, (x) => x, (x) => expect(x.objects[a]).toBeUndefined());
    expect(d.objects[b]).toBeTruthy();
    await page.reload();
    await expect(obj(page, b)).toBeAttached();
    await expect(obj(page, a)).toHaveCount(0);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-03 the eraser does not delete stickies, shapes or text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, {
      'qa-sticky': { type: 'sticky', x: 40, y: 40, width: 120, height: 120, text: 'keep' } as Obj,
      'qa-shape': { type: 'shape', shape: 'rectangle', x: 220, y: 40, width: 140, height: 100 } as Obj,
      'qa-text': { type: 'text', x: 420, y: 60, width: 160, height: 40, text: 'keep text' } as Obj,
    });
    await pickPen(page);
    await pick(page, 'Eraser');
    for (const id of ['qa-sticky', 'qa-shape', 'qa-text']) {
      const b = await boxOf(obj(page, id));
      await sweep(page, [{ x: b.x + 5, y: b.y + b.height / 2 }, { x: b.x + b.width - 5, y: b.y + b.height / 2 }, { x: b.x + b.width / 2, y: b.y + 5 }]);
    }
    await sleep(1000);
    for (const id of ['qa-sticky', 'qa-shape', 'qa-text']) await expect(obj(page, id)).toHaveCount(1);
    const d = await docState(page, owner.boardId);
    expect(Object.keys(d.objects).sort()).toEqual(['qa-shape', 'qa-sticky', 'qa-text']);
  } finally {
    await owner.close();
  }
});

test('DRW-03 CVS-19 a locked stroke survives the eraser while the unlocked one next to it is erased; after unlock it is erased', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const locked = await hLine(page, 0.3);
    const free = await hLine(page, 0.36);
    await lockById(page, locked);
    await pick(page, 'Eraser');
    await sweep(page, [await onCanvas(page, 0.35, 0.2), await onCanvas(page, 0.36, 0.5)]);
    await expect(obj(page, free)).toHaveCount(0);
    await sleep(600);
    await expect(obj(page, locked)).toHaveCount(1);
    await expect(obj(guest.page, free)).toHaveCount(0, { timeout: 10_000 });
    await expect(obj(guest.page, locked)).toHaveCount(1);
    await page.reload();
    await expect(obj(page, locked)).toBeAttached();
    expect((await docState(page, owner.boardId)).objects[locked]).toBeTruthy();
    // Снятие блокировки — штрих стирается.
    await lockById(page, locked, false);
    await pick(page, 'Eraser');
    await sweep(page, [await onCanvas(page, 0.35, 0.2), await onCanvas(page, 0.36, 0.5)]);
    await expect(obj(page, locked)).toHaveCount(0);
    await expect(obj(guest.page, locked)).toHaveCount(0, { timeout: 10_000 });
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-03 a link participant cannot erase a stroke the owner locked but erases an unlocked one, and the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    await pickPen(owner.page);
    const locked = await hLine(owner.page, 0.3);
    const free = await hLine(owner.page, 0.36);
    await lockById(owner.page, locked);
    await expect(obj(guest.page, locked)).toHaveAttribute('data-locked', 'true', { timeout: 10_000 });
    await expect(obj(guest.page, free)).toBeAttached();
    const g = guest.page;
    await pickPen(g);
    await pick(g, 'Eraser');
    // Камеры одинаковы по умолчанию? Берём координаты штрихов на экране участника.
    const lb = bounds((await strokeOf(g, locked)).pts);
    const fb = bounds((await strokeOf(g, free)).pts);
    const x = lb.x + lb.width / 2;
    await sweep(g, [{ x, y: Math.min(lb.y, fb.y) - 40 }, { x, y: Math.max(lb.y, fb.y) + 40 }]);
    await expect(obj(g, free)).toHaveCount(0);
    await expect(obj(owner.page, free)).toHaveCount(0, { timeout: 10_000 });
    await sleep(600);
    await expect(obj(g, locked)).toHaveCount(1);
    await expect(obj(owner.page, locked)).toHaveCount(1);
    expect((await docState(owner.page, owner.boardId)).objects[locked]).toBeTruthy();
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// DRW-04 · прямой штрих с Shift
// =====================================================================

test('DRW-04 with Shift held a wavy gesture draws a straight stroke; without Shift it stays freehand', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const path = await zigzag(page, 0.2, 0.3, 0.35, 0.15);
    const straight = await drawWithMouse(page, path, { shift: true });
    const s = await strokeOf(page, straight);
    expect(deviation(s.pts), 'прямой штрих').toBeLessThanOrEqual(1.5);
    expect(dist(s.pts[0], path[0])).toBeLessThan(8);
    expect(dist(s.pts[s.pts.length - 1], path[path.length - 1])).toBeLessThan(8);
    const free = await drawWithMouse(page, await zigzag(page, 0.2, 0.6, 0.35, 0.15));
    expect(deviation((await strokeOf(page, free)).pts)).toBeGreaterThan(30);
    // Маркер с Shift — тоже прямой.
    await pick(page, 'Marker');
    const m = await drawWithMouse(page, await zigzag(page, 0.6, 0.6, 0.2, 0.1), { shift: true });
    expect(deviation((await strokeOf(page, m)).pts)).toBeLessThanOrEqual(1.5);
    await expect(obj(guest.page, straight)).toBeAttached({ timeout: 10_000 });
    expect(deviation((await strokeOf(guest.page, straight)).pts)).toBeLessThanOrEqual(1.5);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-04 a link participant draws a straight stroke with Shift', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    await pickPen(guest.page);
    const id = await drawWithMouse(guest.page, await zigzag(guest.page, 0.3, 0.3, 0.3, 0.2), { shift: true });
    expect(deviation((await strokeOf(guest.page, id)).pts)).toBeLessThanOrEqual(1.5);
    await expect(obj(owner.page, id)).toBeAttached({ timeout: 10_000 });
    expect(deviation((await strokeOf(owner.page, id)).pts)).toBeLessThanOrEqual(1.5);
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// DRW-05 · лазерная указка
// =====================================================================

test('DRW-05 the owner laser is seen by the participant and fades for both within a few seconds; it is never a board object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-ref': STICKY });
    const before = Object.keys((await docState(page, owner.boardId)).objects).sort();
    await pickPen(page);
    await pick(page, 'Laser');
    const api = watchApi(page);
    const syncBefore = owner.wire.syncSent;
    const sentBefore = owner.wire.sent.length;
    await sweep(page, await zigzag(page, 0.2, 0.3, 0.3, 0.15), 10);
    const t0 = Date.now();
    const mine = page.getByRole('img', { name: 'Your laser' });
    const theirs = guest.page.getByRole('img', { name: `${owner.name}'s laser` });
    await expect(theirs).toBeVisible({ timeout: 3000 });
    await expect(mine).toBeVisible();
    const seenAt = Date.now() - t0;
    await expect(theirs).toBeHidden({ timeout: 10_000 });
    await expect(mine).toBeHidden({ timeout: 10_000 });
    const goneAt = Date.now() - t0;
    test.info().annotations.push({ type: 'DRW-05', description: `след виден у участника через ${seenAt} мс, исчез через ${goneAt} мс после конца жеста` });
    expect(goneAt).toBeLessThanOrEqual(10_500);
    // След шёл кадрами awareness, документ не менялся.
    expect(owner.wire.syncSent - syncBefore, 'лазер не пишет в документ').toBe(0);
    expect(owner.wire.sent.slice(sentBefore).some((st) => st.laser), 'след уходит в awareness').toBe(true);
    expect(api, 'лазер не ходит в HTTP /api').toEqual([]);
    expect(Object.keys((await docState(page, owner.boardId)).objects).sort()).toEqual(before);
    expect(await objectIds(guest.page)).toEqual(['qa-ref']);
    // Перезагрузка — следа нет.
    await guest.page.reload();
    await expect(canvas(guest.page)).toBeVisible();
    await expect(guest.page.getByRole('img', { name: /laser/ })).toHaveCount(0);
    expect(await objectIds(guest.page)).toEqual(['qa-ref']);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-05 the participant laser reaches the owner; the selection rectangle and the eraser do not find it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    await pickPen(guest.page);
    await pick(guest.page, 'Laser');
    const path = await zigzag(guest.page, 0.25, 0.4, 0.3, 0.1);
    await sweep(guest.page, path, 10);
    const trail = owner.page.getByRole('img', { name: "QA Guest's laser" });
    await expect(trail).toBeVisible({ timeout: 3000 });
    // Рамка выделения у владельца по месту следа ничего не выделяет.
    await owner.page.keyboard.press('Escape');
    const tb = await boxOf(trail);
    await sweep(owner.page, [{ x: tb.x - 20, y: tb.y - 20 }, { x: tb.x + tb.width + 20, y: tb.y + tb.height + 20 }]);
    await expect(owner.page.locator('[data-object-id][aria-selected="true"]')).toHaveCount(0);
    await expect(trail).toBeHidden({ timeout: 10_000 });
    expect(Object.keys((await docState(owner.page, owner.boardId)).objects)).toEqual([]);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-05 COL-03 the laser of another participant is visible while cursors are hidden (observation)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const hide = guest.page.getByRole('button', { name: /hide cursors/i });
    if ((await hide.count()) === 0) test.skip(true, 'кнопка скрытия курсоров не найдена по подписи');
    await hide.first().click();
    await pickPen(owner.page);
    await pick(owner.page, 'Laser');
    await sweep(owner.page, await zigzag(owner.page, 0.25, 0.4, 0.3, 0.1), 10);
    const visible = await guest.page
      .getByRole('img', { name: `${owner.name}'s laser` })
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    test.info().annotations.push({ type: 'DRW-05 COL-03', description: `при скрытых курсорах след ${visible ? 'виден' : 'не виден'}` });
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// DRW-06 · масштаб штриха
// =====================================================================

test('DRW-06 a drawn stroke is selected and scaled by a handle; its shape scales with the frame; second client and reload agree', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await pickPen(page);
    const id = await drawWithMouse(page, await zigzag(page, 0.2, 0.3, 0.2, 0.12));
    const s0 = await strokeOf(page, id);
    const b0 = bounds(s0.pts);
    await page.keyboard.press('Escape');
    const p = s0.pts[100];
    await page.mouse.click(p.x, p.y);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    const h = await boxOf(handle(page, 'se'));
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await sweep(page, [from, { x: from.x + 120, y: from.y + 60 }]);
    const s1 = await strokeOf(page, id);
    const b1 = bounds(s1.pts);
    test.info().annotations.push({ type: 'DRW-06', description: `рамка ${Math.round(b0.width)}×${Math.round(b0.height)} → ${Math.round(b1.width)}×${Math.round(b1.height)}; толщина ${s0.width} → ${s1.width}` });
    expect(Math.abs(b1.width - (b0.width + 120))).toBeLessThan(14);
    expect(Math.abs(b1.height - (b0.height + 60))).toBeLessThan(14);
    // Форма сохранена (в долях рамки), штрих не обрезан.
    const n0 = normalized(s0.pts);
    const n1 = normalized(s1.pts);
    for (let i = 0; i < n0.length; i += 10) expect(dist(n0[i], n1[i])).toBeLessThan(0.06);
    await expect
      .poll(async () => bounds((await strokeOf(guest.page, id)).pts).width, { timeout: 10_000 })
      .toBeGreaterThan(b0.width + 100);
    await page.reload();
    await expect(obj(page, id)).toBeAttached();
    const r = bounds((await strokeOf(page, id)).pts);
    expect(Math.abs(r.width - b1.width)).toBeLessThan(6);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('DRW-06 shrinking a stroke a lot keeps it visible and non-degenerate', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickPen(page);
    const id = await drawWithMouse(page, await zigzag(page, 0.2, 0.3, 0.3, 0.2));
    const s0 = await strokeOf(page, id);
    await page.keyboard.press('Escape');
    await page.mouse.click(s0.pts[100].x, s0.pts[100].y);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    const h = await boxOf(handle(page, 'se'));
    const b0 = bounds(s0.pts);
    const from = { x: h.x + h.width / 2, y: h.y + h.height / 2 };
    await sweep(page, [from, { x: from.x - b0.width * 0.85, y: from.y - b0.height * 0.85 }]);
    const s1 = await strokeOf(page, id);
    const b1 = bounds(s1.pts);
    expect(b1.width).toBeGreaterThan(2);
    expect(b1.width).toBeLessThan(b0.width * 0.5);
    await expect(obj(page, id).locator('path[data-testid="drawing-stroke"]')).toBeVisible();
  } finally {
    await owner.close();
  }
});

// =====================================================================
// CVS-07 · отмена своего штриха и стирания; ARCH — без HTTP
// =====================================================================

test('CVS-07 undo and redo of an own stroke and of erasing; the participant stroke is not undone by the owner', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const api = watchApi(page);
    await pickPen(guest.page);
    const theirs = await drawWithMouse(guest.page, await zigzag(guest.page, 0.55, 0.5, 0.2, 0.05));
    await expect(obj(page, theirs)).toBeAttached({ timeout: 10_000 });
    await pickPen(page);
    const mine = await drawWithMouse(page, await zigzag(page, 0.2, 0.3, 0.2, 0.1));
    await page.keyboard.press('Control+z');
    await expect(obj(page, mine)).toHaveCount(0);
    await expect(obj(guest.page, mine)).toHaveCount(0, { timeout: 10_000 });
    await page.keyboard.press('Control+Shift+z');
    await expect(obj(page, mine)).toHaveCount(1);
    await expect(obj(page, theirs)).toHaveCount(1);
    await pick(page, 'Eraser');
    const b = bounds((await strokeOf(page, mine)).pts);
    await sweep(page, [{ x: b.x + b.width / 2, y: b.y - 30 }, { x: b.x + b.width / 2, y: b.y + b.height + 30 }]);
    await expect(obj(page, mine)).toHaveCount(0);
    await page.keyboard.press('Control+z');
    await expect(obj(page, mine)).toHaveCount(1);
    await expect(obj(guest.page, mine)).toHaveCount(1, { timeout: 10_000 });
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+z');
    await sleep(500);
    await expect(obj(page, theirs)).toHaveCount(1);
    expect(api, 'рисование и стирание не ходят в HTTP /api').toEqual([]);
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// MOB-04 · отсев ладони; MOB-05 · стилус сразу рисует (эмуляция)
// =====================================================================

/** Стилус: события мыши CDP с pointerType 'pen'. */
class Stylus {
  private constructor(private cdp: CDPSession) {}
  static async of(page: Page) {
    return new Stylus(await page.context().newCDPSession(page));
  }
  private send(type: string, p: Point, buttons: number) {
    return this.cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', buttons, clickCount: 1, pointerType: 'pen', force: 0.5 } as never);
  }
  down(p: Point) {
    return this.send('mousePressed', p, 1);
  }
  move(p: Point) {
    return this.send('mouseMoved', p, 1);
  }
  up(p: Point) {
    return this.send('mouseReleased', p, 0);
  }
  async path(pts: Point[], perSeg = 6, between?: (i: number) => Promise<void>) {
    await this.down(pts[0]);
    let n = 0;
    for (let i = 1; i < pts.length; i++)
      for (let k = 1; k <= perSeg; k++) {
        await this.move({ x: pts[i - 1].x + ((pts[i].x - pts[i - 1].x) * k) / perSeg, y: pts[i - 1].y + ((pts[i].y - pts[i - 1].y) * k) / perSeg });
        if (between) await between(n++);
        await sleep(16);
      }
    await this.up(pts[pts.length - 1]);
  }
}

type TP = { x: number; y: number; id: number; radiusX: number; radiusY: number; force: number };
/** Касания CDP: пальцы (пятно 4 px) и ладонь (пятно `palmRadius`). */
class Fingers {
  private constructor(private cdp: CDPSession) {}
  static async of(page: Page) {
    return new Fingers(await page.context().newCDPSession(page));
  }
  send(type: string, pts: TP[]) {
    return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts } as never);
  }
  static finger(p: Point, id = 1): TP {
    return { x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 };
  }
  static palm(p: Point, id = 9): TP {
    return { x: p.x, y: p.y, id, radiusX: 35, radiusY: 45, force: 1 };
  }
  /** Один палец по пути (несколько точек). */
  async path(paths: Point[][], perSeg = 6) {
    const p = paths[0];
    await this.send('touchStart', [Fingers.finger(p[0])]);
    for (let i = 1; i < p.length; i++)
      for (let k = 1; k <= perSeg; k++) {
        await this.send('touchMove', [Fingers.finger({ x: p[i - 1].x + ((p[i].x - p[i - 1].x) * k) / perSeg, y: p[i - 1].y + ((p[i].y - p[i - 1].y) * k) / perSeg })]);
        await sleep(16);
      }
    await this.send('touchEnd', []);
  }
}

async function newStrokes(page: Page, before: string[]) {
  await sleep(800);
  return (await strokeIds(page)).filter((x) => !before.includes(x));
}

test('MOB-04 while a stylus draws, a resting palm neither draws, nor pans or zooms the view, nor cuts the stylus stroke', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-ref': STICKY });
    await pickPen(page);
    const ref0 = await boxOf(obj(page, 'qa-ref'));
    const path = await zigzag(page, 0.15, 0.3, 0.5, 0.1);
    const pen = await Stylus.of(page);
    const touch = await Fingers.of(page);
    const palmAt = await onCanvas(page, 0.6, 0.75);
    const before = await strokeIds(page);
    await pen.path(path, 6, async (i) => {
      // Ладонь ложится на третьем шаге и ползёт вместе с рукой.
      if (i === 2) await touch.send('touchStart', [Fingers.palm(palmAt)]);
      else if (i > 2) await touch.send('touchMove', [Fingers.palm({ x: palmAt.x + i * 3, y: palmAt.y - i * 2 })]);
    });
    await touch.send('touchEnd', []);
    const fresh = await newStrokes(page, before);
    expect(fresh, 'один штрих стилуса, ладонь не рисует').toHaveLength(1);
    const s = await strokeOf(page, fresh[0]);
    followsPath(s, path, 10);
    const ref1 = await boxOf(obj(page, 'qa-ref'));
    expect(Math.abs(ref1.x - ref0.x) + Math.abs(ref1.y - ref0.y) + Math.abs(ref1.width - ref0.width), 'вид не сдвинут и не масштабирован').toBeLessThan(2);
  } finally {
    await owner.close();
  }
});

test('MOB-04 while a finger draws with the pen, a palm touch is ignored and the finger stroke is not cut', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-ref': STICKY });
    await pickPen(page);
    const ref0 = await boxOf(obj(page, 'qa-ref'));
    const path = await zigzag(page, 0.15, 0.3, 0.5, 0.1);
    const palmAt = await onCanvas(page, 0.6, 0.75);
    const t = await Fingers.of(page);
    const before = await strokeIds(page);
    await t.send('touchStart', [Fingers.finger(path[0])]);
    let n = 0;
    for (let i = 1; i < path.length; i++)
      for (let k = 1; k <= 6; k++) {
        const f = Fingers.finger({ x: path[i - 1].x + ((path[i].x - path[i - 1].x) * k) / 6, y: path[i - 1].y + ((path[i].y - path[i - 1].y) * k) / 6 });
        n++;
        if (n < 6) await t.send('touchMove', [f]);
        else if (n === 6) await t.send('touchStart', [f, Fingers.palm(palmAt)]);
        else await t.send('touchMove', [f, Fingers.palm({ x: palmAt.x - n * 2, y: palmAt.y + n })]);
        await sleep(16);
      }
    await t.send('touchEnd', []);
    const fresh = await newStrokes(page, before);
    expect(fresh, 'один штрих пальца, ладонь не рисует').toHaveLength(1);
    followsPath(await strokeOf(page, fresh[0]), path, 10);
    const ref1 = await boxOf(obj(page, 'qa-ref'));
    expect(Math.abs(ref1.x - ref0.x) + Math.abs(ref1.y - ref0.y) + Math.abs(ref1.width - ref0.width)).toBeLessThan(2);
  } finally {
    await owner.close();
  }
});

test('MOB-04 a palm resting alone with the pen tool does not draw', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickPen(page);
    const t = await Fingers.of(page);
    const a = await onCanvas(page, 0.5, 0.6);
    const before = await strokeIds(page);
    await t.send('touchStart', [Fingers.palm(a)]);
    for (let i = 1; i <= 10; i++) {
      await t.send('touchMove', [Fingers.palm({ x: a.x + i * 6, y: a.y - i * 3 })]);
      await sleep(16);
    }
    await t.send('touchEnd', []);
    expect(await newStrokes(page, before)).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('MOB-04 MOB-02 with the pen tool a two-finger pinch before drawing still zooms and draws nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-ref': STICKY });
    await pickPen(page);
    const ref0 = await boxOf(obj(page, 'qa-ref'));
    const c = await onCanvas(page, 0.5, 0.5);
    const t = await Fingers.of(page);
    const before = await strokeIds(page);
    await t.send('touchStart', [Fingers.finger({ x: c.x - 30, y: c.y }, 1), Fingers.finger({ x: c.x + 30, y: c.y }, 2)]);
    for (let i = 1; i <= 10; i++) {
      await t.send('touchMove', [Fingers.finger({ x: c.x - 30 - i * 8, y: c.y }, 1), Fingers.finger({ x: c.x + 30 + i * 8, y: c.y }, 2)]);
      await sleep(16);
    }
    await t.send('touchEnd', []);
    expect(await newStrokes(page, before)).toEqual([]);
    const ref1 = await boxOf(obj(page, 'qa-ref'));
    expect(ref1.width / ref0.width, 'щипок масштабирует').toBeGreaterThan(1.3);
  } finally {
    await owner.close();
  }
});

test('MOB-05 with Stylus draws on a stylus draws with the Select tool while a finger pans; off — the stylus does not draw', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-ref': STICKY });
    await pickPen(page);
    await expect(stylusSwitch(page)).toBeVisible();
    await expect(stylusSwitch(page)).not.toBeChecked();
    await stylusSwitch(page).click();
    await expect(stylusSwitch(page)).toBeChecked();
    // Вернуться к выделению.
    await tool(page, 'Select').click();
    await expect(drawPanel(page)).toBeHidden();
    const pen = await Stylus.of(page);
    const path = await zigzag(page, 0.15, 0.3, 0.5, 0.1);
    let before = await strokeIds(page);
    await pen.path(path);
    let fresh = await newStrokes(page, before);
    expect(fresh, 'стилус рисует сразу').toHaveLength(1);
    followsPath(await strokeOf(page, fresh[0]), path, 10);
    // Палец в этом режиме не рисует, а двигает холст.
    const ref0 = await boxOf(obj(page, 'qa-ref'));
    const f = await Fingers.of(page);
    before = await strokeIds(page);
    await f.path([[await onCanvas(page, 0.3, 0.75), await onCanvas(page, 0.6, 0.75)]], 10);
    expect(await newStrokes(page, before), 'палец не рисует').toEqual([]);
    const ref1 = await boxOf(obj(page, 'qa-ref'));
    expect(Math.abs(ref1.x - ref0.x), 'палец двигает холст').toBeGreaterThan(20);
    // Режим переживает перезагрузку (наблюдение).
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await pickPen(page);
    const persisted = await stylusSwitch(page).isChecked();
    test.info().annotations.push({ type: 'MOB-05', description: `режим после перезагрузки: ${persisted ? 'включён' : 'выключен'}` });
    if (!persisted) await stylusSwitch(page).click();
    // Выключить — стилус больше не рисует с Select.
    await stylusSwitch(page).click();
    await expect(stylusSwitch(page)).not.toBeChecked();
    await tool(page, 'Select').click();
    before = await strokeIds(page);
    await (await Stylus.of(page)).path(await zigzag(page, 0.15, 0.55, 0.4, 0.05));
    expect(await newStrokes(page, before), 'режим выключен — стилус не рисует').toEqual([]);
  } finally {
    await owner.close();
  }
});

test('MOB-05 a link participant on a phone turns on Stylus draws and draws; the owner sees the stroke', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const g = guest.page;
    await pickPen(g);
    await stylusSwitch(g).click();
    await expect(stylusSwitch(g)).toBeChecked();
    await tool(g, 'Select').click();
    const before = await strokeIds(g);
    await (await Stylus.of(g)).path(await zigzag(g, 0.2, 0.35, 0.4, 0.1));
    const fresh = await newStrokes(g, before);
    expect(fresh).toHaveLength(1);
    await expect(obj(owner.page, fresh[0])).toBeAttached({ timeout: 10_000 });
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('UI-04 BUG-023 on a phone the drawing panel controls are at least 44×44 px and fit the screen', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  test.fail(true, 'BUG-023 (minor): кнопки «Preset 1: 2» и «Preset 2: 4» уже 44 px');
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await pickPen(page);
    const panel = await boxOf(drawPanel(page));
    const vw = page.viewportSize()!.width;
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(vw + 1);
    const small: string[] = [];
    const controls: Locator = drawPanel(page).locator('button, [role="switch"], select');
    for (let i = 0; i < (await controls.count()); i++) {
      const c = controls.nth(i);
      if (!(await c.isVisible())) continue;
      const b = await boxOf(c);
      if (b.width < 44 - 0.5 || b.height < 44 - 0.5) small.push(`${(await c.getAttribute('aria-label')) ?? (await c.innerText())}: ${Math.round(b.width)}×${Math.round(b.height)}`);
    }
    expect(small, 'элементы меньше 44×44').toEqual([]);
  } finally {
    await owner.close();
  }
});
