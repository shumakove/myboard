// Приёмка T6.6 · фреймы: FRM-01…FRM-05; попутно CVS-19, CON-01 / CVS-26, COL-01, CVS-07, ARCH.
// Сценарии — docs/qa/reports/T6.6.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.6.
// Наблюдение: DOM холста (рамки элементов, вычисленные стили), документ доски глазами позднего клиента
// по /api/ws, второй клиент. Код из apps/ не импортируется.
import type { Browser, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, centerOf, docState, handle, obj, objectIds, objectMenu, onCanvas, seed, selectionBar, tool, tools, untilDoc, type Box, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- интерфейс (подписи из handoff T6.6) ----------

const frames = (page: Page) => page.locator('[data-object-id][data-type="frame"]');
const frameIds = async (page: Page) => (await frames(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();
const barButton = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const lockGroup = (page: Page) => page.getByRole('group', { name: 'Lock frame', exact: true });
const keepSwitch = (page: Page) => selectionBar(page).getByRole('switch', { name: 'Keep proportions' });

// Опорные объекты (локальные координаты тестов, FRAME в scene.ts). Модель фрейма — из handoff T6.6.
const FR: Obj = { type: 'frame', x: 40, y: 40, width: 360, height: 240, appearance: 'fill', fill: '#ffffff' } as Obj;
const IN: Obj = { type: 'sticky', x: 80, y: 80, width: 80, height: 80, text: 'in' } as Obj;
const OUT: Obj = { type: 'sticky', x: 520, y: 80, width: 80, height: 80, text: 'out' } as Obj;

const dist = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);

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

async function deselect(page: Page) {
  const sel = page.locator('[data-object-id][aria-selected="true"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 3 && (await sel.count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  await expect(sel).toHaveCount(0);
}

/** Точка объекта, где сверху именно он (не дочерний объект, не маркер). */
async function freePointOf(page: Page, id: string): Promise<Point> {
  const b = await boxOf(obj(page, id));
  const fr = [0.5, 0.92, 0.08, 0.75, 0.25];
  const pts = fr.flatMap((fy) => fr.map((fx) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy })));
  for (const p of pts) {
    const hit = await page.evaluate(({ x, y }) => {
      const e = document.elementFromPoint(x, y);
      if (!e || e.closest('[data-handle]')) return '';
      return e.closest('[data-object-id]')?.getAttribute('data-object-id') ?? '';
    }, p);
    if (hit === id) return p;
  }
  throw new Error(`у объекта ${id} нет свободной точки`);
}

async function select(page: Page, id: string) {
  if ((await obj(page, id).getAttribute('aria-selected')) === 'true' && (await page.locator('[aria-selected="true"]').count()) === 1) return;
  await deselect(page);
  const p = await freePointOf(page, id);
  await page.mouse.click(p.x, p.y);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
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
  await page.waitForTimeout(300);
}

/** Перетащить объект так, чтобы его центр оказался в точке экрана `to`. */
async function moveCenterTo(page: Page, id: string, to: Point) {
  const c = centerOf(await boxOf(obj(page, id)));
  await moveObject(page, id, { x: to.x - c.x, y: to.y - c.y });
}

const offset = (a: Box, b: Box): Point => ({ x: a.x - b.x, y: a.y - b.y });
function near(p: Point, q: Point, tol = 3) {
  expect(Math.abs(p.x - q.x), `x: ${p.x} против ${q.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(p.y - q.y), `y: ${p.y} против ${q.y}`).toBeLessThanOrEqual(tol);
}

/** Объект в документе (сырое значение, без сдвига FRAME — для полей parent и локальных координат). */
async function rawObjects(page: Page, boardId: string): Promise<Record<string, Record<string, unknown>>> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const out: Record<string, Record<string, unknown>> = {};
  doc.getMap('objects').forEach((v, k) => {
    out[k] = (v instanceof Y.Map ? v.toJSON() : v) as Record<string, unknown>;
  });
  return out;
}

async function untilRaw(page: Page, boardId: string, check: (o: Record<string, Record<string, unknown>>) => void) {
  let last: Record<string, Record<string, unknown>> = {};
  await expect(async () => {
    last = await rawObjects(page, boardId);
    check(last);
  }).toPass({ timeout: 15_000, intervals: [300, 600, 1000] });
  return last;
}

/** Ссылка объекта на родителя — любое поле, равное id фрейма (имя поля архитектурой не задано). */
const parentOf = (o: Record<string, unknown> | undefined) => (o ? (o.parent ?? o.parentId ?? o.parent_id ?? null) : null);

/** Видим ли элемент глазами пользователя (есть в DOM, не скрыт, не прозрачен, ненулевой размер). */
async function isShown(page: Page, id: string): Promise<boolean> {
  const l = obj(page, id);
  if ((await l.count()) === 0) return false;
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e: Element | null = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    }
    return true;
  });
}

async function newObjectId(page: Page, before: string[], type: string): Promise<string> {
  let id = '';
  await expect(async () => {
    for (const x of await objectIds(page)) if (!before.includes(x) && (await obj(page, x).getAttribute('data-type')) === type) id = x;
    expect(id, `новый объект ${type}`).not.toBe('');
  }).toPass({ timeout: 10_000 });
  return id;
}

/** Поставить фрейм инструментом щелчком в точку холста. */
async function placeFrame(page: Page, at: Point, isMobile = false): Promise<string> {
  const before = await objectIds(page);
  await pickFromAll(page, 'Frame', isMobile);
  if (isMobile) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  return newObjectId(page, before, 'frame');
}

/** Блокировка через выбор FRM-05 у выделенного фрейма. */
async function lockFrame(page: Page, id: string, mode: 'Frame only' | 'Frame and content') {
  await select(page, id);
  await barButton(page, 'Lock').click();
  await expect(lockGroup(page)).toBeVisible();
  await lockGroup(page).getByRole('button', { name: mode, exact: true }).click();
  await expect(obj(page, id)).toHaveAttribute('data-locked', 'true');
}

async function unlock(page: Page, id: string) {
  await select(page, id);
  await barButton(page, 'Unlock').click();
  await expect(obj(page, id)).not.toHaveAttribute('data-locked', 'true');
}

/** Вычисленные фон и граница видимой рамки фрейма (элемент или его самый крупный потомок с оформлением). */
async function look(page: Page, id: string) {
  return obj(page, id).evaluate((el) => {
    const cands = [el, ...Array.from(el.querySelectorAll('*'))].filter((e) => !(e as HTMLElement).closest('[data-handle]'));
    const pick = (f: (cs: CSSStyleDeclaration) => boolean) => {
      for (const e of cands) {
        const cs = getComputedStyle(e);
        if (f(cs)) return cs;
      }
      return null;
    };
    const solid = (c: string) => c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c);
    const bg = pick((cs) => solid(cs.backgroundColor));
    const bd = pick((cs) => parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none' && solid(cs.borderTopColor));
    const ol = pick((cs) => parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none');
    return {
      background: bg ? bg.backgroundColor : 'transparent',
      border: bd ? `${bd.borderTopWidth} ${bd.borderTopColor}` : ol ? `${ol.outlineWidth} ${ol.outlineColor}` : 'none',
      appearance: el.getAttribute('data-appearance') ?? '',
    };
  });
}

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** Запросы страницы к /api во время действия (кроме канала WebSocket и фоновой проверки сессии). */
function watchApi(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api') && !u.pathname.startsWith('/api/ws') && u.pathname !== '/api/session') seen.push(`${r.method()} ${u.pathname}`);
  });
  return seen;
}

// =====================================================================
// FRM-01 · фрейм, содержимое, линия к фрейму
// =====================================================================

test('FRM-01 the Frame tool places a frame; the second client sees it live and it survives a reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    const id = await placeFrame(page, await onCanvas(page, 0.45, 0.5));
    expect(await isShown(page, id)).toBe(true);
    await expect(obj(guest.page, id)).toBeAttached({ timeout: 10_000 });
    await expect(obj(guest.page, id)).toHaveAttribute('data-type', 'frame');
    const raw = await untilRaw(page, owner.boardId, (o) => expect(o[id]).toBeTruthy());
    expect(raw[id].type).toBe('frame');
    await page.reload();
    await expect(obj(page, id)).toBeAttached();
    expect(await isShown(page, id)).toBe(true);
    // клавиша F (горячая клавиша инструмента) — второй фрейм
    await deselect(page);
    const p = await onCanvas(page, 0.08, 0.92); // мимо фрейма и миникарты
    await page.mouse.click(p.x, p.y);
    await deselect(page);
    const before = await objectIds(page);
    await page.keyboard.press('f');
    await page.mouse.click(p.x, p.y);
    await newObjectId(page, before, 'frame');
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-01 a sticky dragged into a frame moves with it; the second client and a reload agree; an outside sticky stays', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj, 'qa-out': OUT });
    // стикер qa-a перетаскивается внутрь фрейма
    const fb = await boxOf(obj(page, 'qa-frame'));
    await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width * 0.35, y: fb.y + fb.height * 0.5 });
    const raw = await untilRaw(page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBe('qa-frame'));
    // по архитектуре координаты ребёнка — относительно родителя
    const f0 = raw['qa-frame'];
    const a0 = raw['qa-a'];
    expect(Number(a0.x)).toBeGreaterThanOrEqual(0);
    expect(Number(a0.x)).toBeLessThan(Number(f0.width));
    expect(Number(a0.y)).toBeGreaterThanOrEqual(0);
    expect(Number(a0.y)).toBeLessThan(Number(f0.height));
    const rel = offset(await boxOf(obj(page, 'qa-a')), await boxOf(obj(page, 'qa-frame')));
    const out0 = await boxOf(obj(page, 'qa-out'));
    // фрейм двигается — стикер внутри едет с ним, внешний стоит
    await moveObject(page, 'qa-frame', { x: 120, y: 90 });
    const fb1 = await boxOf(obj(page, 'qa-frame'));
    near({ x: fb1.x, y: fb1.y }, { x: fb.x + 120, y: fb.y + 90 }, 12);
    near(offset(await boxOf(obj(page, 'qa-a')), fb1), rel);
    near(await boxOf(obj(page, 'qa-out')), out0, 1);
    // второй клиент
    await expect(async () => {
      near(offset(await boxOf(obj(guest.page, 'qa-a')), await boxOf(obj(guest.page, 'qa-frame'))), rel);
    }).toPass({ timeout: 10_000 });
    // перезагрузка
    await page.reload();
    await expect(obj(page, 'qa-a')).toBeAttached();
    near(offset(await boxOf(obj(page, 'qa-a')), await boxOf(obj(page, 'qa-frame'))), rel);
    const d = await docState(page, owner.boardId);
    expect(parentOf(d.objects['qa-out'] as Record<string, unknown>)).toBeFalsy();
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-01 a sticky dragged out of the frame no longer moves with it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj });
    const fb = await boxOf(obj(page, 'qa-frame'));
    await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width * 0.3, y: fb.y + fb.height * 0.5 });
    await untilRaw(page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBe('qa-frame'));
    // вынести наружу
    await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width + 160, y: fb.y + fb.height + 60 });
    await untilRaw(page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBeFalsy());
    const a0 = await boxOf(obj(page, 'qa-a'));
    await moveObject(page, 'qa-frame', { x: -30, y: 60 });
    near(await boxOf(obj(page, 'qa-a')), a0, 1);
  } finally {
    await owner.close();
  }
});

test('FRM-01 a sticky placed with the tool inside a frame belongs to it and moves with it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR });
    const fb = await boxOf(obj(page, 'qa-frame'));
    const before = await objectIds(page);
    await tool(page, 'Sticky note').click();
    await page.mouse.click(fb.x + fb.width * 0.3, fb.y + fb.height * 0.45);
    const id = await newObjectId(page, before, 'sticky');
    await untilRaw(page, owner.boardId, (o) => expect(parentOf(o[id])).toBe('qa-frame'));
    await page.keyboard.press('Escape');
    await deselect(page);
    const rel = offset(await boxOf(obj(page, id)), fb);
    await moveObject(page, 'qa-frame', { x: 80, y: 50 });
    near(offset(await boxOf(obj(page, id)), await boxOf(obj(page, 'qa-frame'))), rel);
  } finally {
    await owner.close();
  }
});

test('FRM-01 boundary: a sticky that only partly overlaps the frame (observation of the inside rule)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj, 'qa-b': { ...OUT, x: 620, y: 340 } as Obj });
    const fb = await boxOf(obj(page, 'qa-frame'));
    const ab = await boxOf(obj(page, 'qa-a'));
    // центр внутри у правого края, часть стикера снаружи
    await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width - ab.width * 0.3, y: fb.y + fb.height / 2 });
    // центр снаружи, часть стикера внутри
    await moveCenterTo(page, 'qa-b', { x: fb.x + fb.width + ab.width * 0.3, y: fb.y + fb.height / 3 });
    await sleep(800);
    const raw = await rawObjects(page, owner.boardId);
    test.info().annotations.push({ type: 'наблюдение', description: `частичное перекрытие: центр внутри → parent=${parentOf(raw['qa-a'])}; центр снаружи → parent=${parentOf(raw['qa-b'])}` });
    // объект, целиком лежащий внутри, обязан быть содержимым — проверено в других тестах
  } finally {
    await owner.close();
  }
});

test('FRM-01 CON-01 CVS-26 a line drawn to the frame is bound to it and follows the frame on both clients', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-s': { ...OUT, x: 560, y: 360 } as Obj });
    const fb = await boxOf(obj(page, 'qa-frame'));
    const before = await objectIds(page);
    await pickFromAll(page, 'Line');
    const from = centerOf(await boxOf(obj(page, 'qa-s')));
    const to = { x: fb.x + fb.width * 0.6, y: fb.y + fb.height * 0.6 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (to.x - from.x) * 0.1, from.y + (to.y - from.y) * 0.1, { steps: 2 });
    await page.mouse.move(to.x, to.y, { steps: 12 });
    await page.mouse.up();
    const line = await newObjectId(page, before, 'line');
    const raw = await untilRaw(page, owner.boardId, (o) => {
      const l = o[line];
      const ends = [l?.start, l?.end].map((e) => (e as Record<string, unknown> | undefined)?.object);
      expect(ends).toContain('qa-frame');
      expect(ends).toContain('qa-s');
    });
    const endKey = ((raw[line].end as Record<string, unknown>)?.object === 'qa-frame' ? 'end' : 'start') as 'start' | 'end';
    // конец линии у фрейма на экране
    const endPoint = async (p: Page) =>
      obj(p, line).evaluate((el, key) => {
        const path = el.querySelector('path') as SVGPathElement;
        const m = path.getScreenCTM()!;
        const len = path.getTotalLength();
        const q = path.getPointAtLength(key === 'end' ? len : 0);
        const s = new DOMPoint(q.x, q.y).matrixTransform(m);
        return { x: s.x, y: s.y };
      }, endKey);
    const e0 = await endPoint(page);
    await deselect(page);
    await moveObject(page, 'qa-frame', { x: -60, y: -40 });
    const fb1 = await boxOf(obj(page, 'qa-frame'));
    near({ x: fb1.x, y: fb1.y }, { x: fb.x - 60, y: fb.y - 40 }, 12);
    await expect(async () => {
      const e1 = await endPoint(page);
      expect(dist(e1, { x: e0.x - 60, y: e0.y - 40 }), 'конец линии следует за фреймом').toBeLessThanOrEqual(25);
      expect(dist(e1, e0)).toBeGreaterThan(30);
    }).toPass({ timeout: 5000 });
    // второй клиент: конец у сдвинутого фрейма
    await expect(async () => {
      const g = await endPoint(guest.page);
      const gb = await boxOf(obj(guest.page, 'qa-frame'));
      const inside = g.x >= gb.x - 6 && g.x <= gb.x + gb.width + 6 && g.y >= gb.y - 6 && g.y <= gb.y + gb.height + 6;
      expect(inside, 'у второго клиента конец линии на фрейме').toBe(true);
      near({ x: gb.x, y: gb.y }, { x: (await boxOf(obj(guest.page, 'qa-s'))).x + (fb1.x - (await boxOf(obj(page, 'qa-s'))).x), y: (await boxOf(obj(guest.page, 'qa-s'))).y + (fb1.y - (await boxOf(obj(page, 'qa-s'))).y) }, 4);
    }).toPass({ timeout: 10_000 });
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-01 a link participant places a frame, drops a sticky in and moves the frame; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const g = guest.page;
    await seed(owner.page, owner.boardId, { 'qa-a': { ...OUT, x: 600, y: 380 } as Obj });
    await expect(obj(g, 'qa-a')).toBeAttached({ timeout: 10_000 });
    const id = await placeFrame(g, await onCanvas(g, 0.35, 0.4));
    await deselect(g);
    const fb = await boxOf(obj(g, id));
    await moveCenterTo(g, 'qa-a', { x: fb.x + fb.width * 0.3, y: fb.y + fb.height * 0.5 });
    await untilRaw(owner.page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBe(id));
    const rel = offset(await boxOf(obj(g, 'qa-a')), await boxOf(obj(g, id)));
    await moveObject(g, id, { x: 70, y: 40 });
    near(offset(await boxOf(obj(g, 'qa-a')), await boxOf(obj(g, id))), rel);
    const p = owner.page;
    await expect(obj(p, id)).toBeAttached({ timeout: 10_000 });
    await expect(async () => near(offset(await boxOf(obj(p, 'qa-a')), await boxOf(obj(p, id))), rel)).toPass({ timeout: 10_000 });
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-01 on a phone a link participant places a frame with the tool; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const g = guest.page;
    const id = await placeFrame(g, await onCanvas(g, 0.5, 0.5), true);
    await expect(obj(owner.page, id)).toBeAttached({ timeout: 10_000 });
    await expect(obj(owner.page, id)).toHaveAttribute('data-type', 'frame');
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// FRM-02 · оформление
// =====================================================================

test('FRM-02 frame style: three looks, palette and custom color; the second client and a reload agree', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR });
    await select(page, 'qa-frame');
    const style = selectionBar(page).getByRole('group', { name: 'Frame style' }).or(selectionBar(page).getByRole('combobox', { name: 'Frame style' })).or(selectionBar(page).getByRole('radiogroup', { name: 'Frame style' }));
    await expect(style.first()).toBeVisible();
    const setStyle = async (name: 'Fill' | 'Border only' | 'No background') => {
      await select(page, 'qa-frame');
      const s = style.first();
      if ((await s.evaluate((e) => e.tagName)) === 'SELECT') await s.selectOption({ label: name });
      else await s.getByRole(await s.getByRole('radio', { name, exact: true }).count() ? 'radio' : 'button', { name, exact: true }).click();
    };
    const colorBox = selectionBar(page).getByRole('combobox', { name: 'Frame color', exact: true });
    // Fill + цвет из палитры
    await setStyle('Fill');
    await expect(colorBox).toBeVisible();
    expect(await colorBox.locator('option').count(), 'палитра цветов фрейма').toBeGreaterThan(2);
    await colorBox.selectOption({ label: 'Blue' });
    let palette = '';
    await expect(async () => {
      const l = await look(page, 'qa-frame');
      expect(l.background).not.toBe('transparent');
      expect(l.background).not.toBe('rgb(255, 255, 255)');
      palette = l.background;
    }).toPass({ timeout: 5000 });
    // пользовательский цвет
    await select(page, 'qa-frame');
    const customBtn = selectionBar(page).getByRole('button', { name: 'Custom color', exact: true });
    const field = page.getByLabel('Custom frame color', { exact: true });
    if (!(await field.isVisible())) await customBtn.click();
    await field.fill('#12ab34');
    await field.press('Enter').catch(() => undefined);
    await expect(async () => expect((await look(page, 'qa-frame')).background).toBe(hexToRgb('#12ab34'))).toPass({ timeout: 5000 });
    const fillLook = await look(page, 'qa-frame');
    // второй клиент и перезагрузка
    await expect(async () => expect((await look(guest.page, 'qa-frame')).background).toBe(hexToRgb('#12ab34'))).toPass({ timeout: 10_000 });
    // Border only и No background — цвет на границе
    await setStyle('Border only');
    await expect(async () => expect((await look(page, 'qa-frame')).border).toContain(hexToRgb('#12ab34'))).toPass({ timeout: 5000 });
    const borderLook = await look(page, 'qa-frame');
    await setStyle('No background');
    await expect(async () => {
      const l = await look(page, 'qa-frame');
      expect(l.border).toContain(hexToRgb('#12ab34'));
      expect(l.background).toBe('transparent');
    }).toPass({ timeout: 5000 });
    const noBgLook = await look(page, 'qa-frame');
    test.info().annotations.push({ type: 'наблюдение', description: `fill=${JSON.stringify(fillLook)} border=${JSON.stringify(borderLook)} nobg=${JSON.stringify(noBgLook)}; палитра: ${palette}` });
    // три вида попарно различимы
    const sig = (l: typeof fillLook) => `${l.background}|${l.border}`;
    expect(new Set([sig(fillLook), sig(borderLook), sig(noBgLook)]).size, 'три вида оформления различаются').toBe(3);
    expect(fillLook.background, 'Fill — фон цветом').toBe(hexToRgb('#12ab34'));
    // толкование по ответу владельца на Q-004 (вариант а)
    expect(borderLook.border, 'Border only — граница цветом').toContain(hexToRgb('#12ab34'));
    expect(borderLook.background, 'Border only — фон белый').toBe('rgb(255, 255, 255)');
    expect(noBgLook.border, 'No background — граница цветом').toContain(hexToRgb('#12ab34'));
    expect(noBgLook.background, 'No background — фон прозрачный').toBe('transparent');
    await expect(async () => {
      const l = await look(guest.page, 'qa-frame');
      expect(l.background).toBe('transparent');
      expect(l.border).toContain(hexToRgb('#12ab34'));
    }).toPass({ timeout: 10_000 });
    await page.reload();
    await expect(obj(page, 'qa-frame')).toBeAttached();
    expect(sig(await look(page, 'qa-frame'))).toBe(sig(noBgLook));
  } finally {
    await owner.close();
    await guest.close();
  }
});

// =====================================================================
// FRM-03 · фиксация пропорций
// =====================================================================

async function dragHandleBy(page: Page, name: string, d: Point) {
  const from = centerOf(await boxOf(handle(page, name)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 5 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

const ratio = (b: Box) => b.width / b.height;

test('FRM-03 with Keep proportions on, corner and side handles keep the aspect ratio; it survives a reload and holds for the second client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR });
    await select(page, 'qa-frame');
    await expect(keepSwitch(page)).toBeVisible();
    if (!(await keepSwitch(page).isChecked())) await keepSwitch(page).click();
    await expect(keepSwitch(page)).toBeChecked();
    const r0 = ratio(await boxOf(obj(page, 'qa-frame')));
    // угол se — тянем почти только по горизонтали
    await dragHandleBy(page, 'se', { x: 150, y: 10 });
    const b1 = await boxOf(obj(page, 'qa-frame'));
    expect(Math.abs(ratio(b1) / r0 - 1), `se: ${ratio(b1)} против ${r0}`).toBeLessThanOrEqual(0.02);
    expect(b1.width).toBeGreaterThan(FR.width + 50);
    // угол nw — по вертикали
    await select(page, 'qa-frame');
    await dragHandleBy(page, 'nw', { x: 5, y: 80 });
    const b2 = await boxOf(obj(page, 'qa-frame'));
    expect(Math.abs(ratio(b2) / r0 - 1), `nw: ${ratio(b2)} против ${r0}`).toBeLessThanOrEqual(0.02);
    // боковые маркеры: если есть, пропорция тоже сохраняется
    await select(page, 'qa-frame');
    const sides: string[] = [];
    for (const s of ['e', 'w', 'n', 's']) if ((await handle(page, s).count()) && (await handle(page, s).first().isVisible())) sides.push(s);
    test.info().annotations.push({ type: 'наблюдение', description: `боковые маркеры при фиксации: ${sides.join(',') || 'нет'}` });
    for (const s of sides) {
      await select(page, 'qa-frame');
      await dragHandleBy(page, s, s === 'e' || s === 'w' ? { x: s === 'e' ? 60 : -60, y: 0 } : { x: 0, y: s === 's' ? 50 : -50 });
      const b = await boxOf(obj(page, 'qa-frame'));
      expect(Math.abs(ratio(b) / r0 - 1), `${s}: ${ratio(b)} против ${r0}`).toBeLessThanOrEqual(0.02);
    }
    // перезагрузка — фиксация осталась
    await page.reload();
    await expect(obj(page, 'qa-frame')).toBeAttached();
    await select(page, 'qa-frame');
    await expect(keepSwitch(page)).toBeChecked();
    // второй клиент тянет угол — пропорция та же
    const g = guest.page;
    await select(g, 'qa-frame');
    await expect(keepSwitch(g)).toBeChecked();
    await dragHandleBy(g, 'se', { x: -20, y: 120 });
    const bg = await boxOf(obj(g, 'qa-frame'));
    expect(Math.abs(ratio(bg) / r0 - 1), `гость: ${ratio(bg)} против ${r0}`).toBeLessThanOrEqual(0.02);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-03 with Keep proportions off the sides change independently; boundary: a strong shrink with it on keeps the ratio', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR });
    await select(page, 'qa-frame');
    if (await keepSwitch(page).isChecked()) await keepSwitch(page).click();
    await expect(keepSwitch(page)).not.toBeChecked();
    const r0 = ratio(await boxOf(obj(page, 'qa-frame')));
    await dragHandleBy(page, 'se', { x: 150, y: 0 });
    const b1 = await boxOf(obj(page, 'qa-frame'));
    expect(Math.abs(ratio(b1) / r0 - 1), 'без фиксации пропорция меняется').toBeGreaterThan(0.1);
    // включить и сильно уменьшить
    await select(page, 'qa-frame');
    await keepSwitch(page).click();
    await expect(keepSwitch(page)).toBeChecked();
    const r1 = ratio(b1);
    await dragHandleBy(page, 'se', { x: -(b1.width * 0.8), y: -(b1.height * 0.5) });
    const b2 = await boxOf(obj(page, 'qa-frame'));
    expect(b2.width).toBeLessThan(b1.width * 0.6);
    expect(Math.abs(ratio(b2) / r1 - 1), `сильное уменьшение: ${ratio(b2)} против ${r1}`).toBeLessThanOrEqual(0.02);
  } finally {
    await owner.close();
  }
});

// =====================================================================
// FRM-04 · скрытие содержимого
// =====================================================================

async function hideContent(page: Page, id: string, hide = true) {
  await select(page, id);
  await barButton(page, hide ? 'Hide content' : 'Show content').click();
}

test('FRM-04 Hide content hides the objects in the frame only; Show content brings them back in place; second client observed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj, 'qa-out': OUT });
    const fb = await boxOf(obj(page, 'qa-frame'));
    await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width * 0.3, y: fb.y + fb.height * 0.5 });
    await untilRaw(page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBe('qa-frame'));
    const a0 = await boxOf(obj(page, 'qa-a'));
    await expect(obj(guest.page, 'qa-a')).toBeAttached({ timeout: 10_000 });
    await hideContent(page, 'qa-frame');
    await expect.poll(() => isShown(page, 'qa-a'), { message: 'содержимое скрыто' }).toBe(false);
    expect(await isShown(page, 'qa-frame'), 'рамка видна').toBe(true);
    expect(await isShown(page, 'qa-out'), 'объект вне фрейма виден').toBe(true);
    // документ: объект не удалён
    const raw = await rawObjects(page, owner.boardId);
    expect(raw['qa-a'], 'скрытый объект остался в документе').toBeTruthy();
    await sleep(1500);
    const guestHidden = !(await isShown(guest.page, 'qa-a'));
    test.info().annotations.push({ type: 'наблюдение', description: `у второго клиента содержимое скрыто: ${guestHidden}` });
    await page.reload();
    await expect(obj(page, 'qa-frame')).toBeAttached();
    await expect.poll(() => isShown(page, 'qa-a')).toBe(false);
    await hideContent(page, 'qa-frame', false);
    await expect.poll(() => isShown(page, 'qa-a'), { message: 'содержимое снова видно' }).toBe(true);
    near(await boxOf(obj(page, 'qa-a')), a0, 2);
    await expect.poll(() => isShown(guest.page, 'qa-a'), { timeout: 10_000 }).toBe(true);
    const raw2 = await rawObjects(page, owner.boardId);
    expect(Object.keys(raw2).sort()).toEqual(Object.keys(raw).sort());
  } finally {
    await owner.close();
    await guest.close();
  }
});

for (const mode of ['Frame only', 'Frame and content'] as const) {
  test(`FRM-04 FRM-05 content of a frame locked "${mode}" can be hidden and shown again`, async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
    desktopOnly(isMobile);
    const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
    try {
      const page = owner.page;
      await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj });
      const fb = await boxOf(obj(page, 'qa-frame'));
      await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width * 0.3, y: fb.y + fb.height * 0.5 });
      await untilRaw(page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBe('qa-frame'));
      const a0 = await boxOf(obj(page, 'qa-a'));
      await lockFrame(page, 'qa-frame', mode);
      await hideContent(page, 'qa-frame');
      await expect.poll(() => isShown(page, 'qa-a')).toBe(false);
      await expect(obj(page, 'qa-frame')).toHaveAttribute('data-locked', 'true');
      await hideContent(page, 'qa-frame', false);
      await expect.poll(() => isShown(page, 'qa-a')).toBe(true);
      near(await boxOf(obj(page, 'qa-a')), a0, 2);
      await expect(obj(page, 'qa-frame')).toHaveAttribute('data-locked', 'true');
    } finally {
      await owner.close();
    }
  });
}

test('FRM-04 a link participant hides and shows the content of a frame the owner locked with content', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj });
    const fb = await boxOf(obj(page, 'qa-frame'));
    await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width * 0.3, y: fb.y + fb.height * 0.5 });
    await untilRaw(page, owner.boardId, (o) => expect(parentOf(o['qa-a'])).toBe('qa-frame'));
    await lockFrame(page, 'qa-frame', 'Frame and content');
    const g = guest.page;
    await expect(obj(g, 'qa-frame')).toHaveAttribute('data-locked', 'true', { timeout: 10_000 });
    await hideContent(g, 'qa-frame');
    await expect.poll(() => isShown(g, 'qa-a')).toBe(false);
    await hideContent(g, 'qa-frame', false);
    await expect.poll(() => isShown(g, 'qa-a')).toBe(true);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-04 boundary: hiding and showing an empty frame works without errors', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await seed(page, owner.boardId, { 'qa-frame': FR, 'qa-out': OUT });
    await hideContent(page, 'qa-frame');
    await expect(obj(page, 'qa-frame')).toHaveAttribute('data-content-hidden', 'true');
    expect(await isShown(page, 'qa-frame')).toBe(true);
    expect(await isShown(page, 'qa-out')).toBe(true);
    await hideContent(page, 'qa-frame', false);
    await expect(obj(page, 'qa-frame')).not.toHaveAttribute('data-content-hidden', 'true');
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

// =====================================================================
// FRM-05 · выбор режима блокировки
// =====================================================================

/** Стикер qa-a внутри фрейма qa-frame (через перетаскивание), рисунок qa-d внутри — через перо. */
async function frameWithSticky(page: Page, boardId: string) {
  await seed(page, boardId, { 'qa-frame': FR, 'qa-a': { ...OUT, x: 480, y: 340 } as Obj, 'qa-out': OUT });
  const fb = await boxOf(obj(page, 'qa-frame'));
  await moveCenterTo(page, 'qa-a', { x: fb.x + fb.width * 0.25, y: fb.y + fb.height * 0.4 });
  await untilRaw(page, boardId, (o) => expect(parentOf(o['qa-a'])).toBe('qa-frame'));
}

test('FRM-05 locking a frame asks Frame only / Frame and content in the app; dismissing the choice locks nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    await frameWithSticky(page, owner.boardId);
    await select(page, 'qa-frame');
    await barButton(page, 'Lock').click();
    await expect(lockGroup(page)).toBeVisible();
    await expect(lockGroup(page).getByRole('button', { name: 'Frame only', exact: true })).toBeVisible();
    await expect(lockGroup(page).getByRole('button', { name: 'Frame and content', exact: true })).toBeVisible();
    // ничего ещё не заблокировано
    await expect(obj(page, 'qa-frame')).not.toHaveAttribute('data-locked', 'true');
    // отказ: Escape / щелчок мимо
    await page.keyboard.press('Escape');
    await deselect(page);
    await expect(lockGroup(page)).toHaveCount(0);
    await expect(obj(page, 'qa-frame')).not.toHaveAttribute('data-locked', 'true');
    await expect(obj(page, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    const raw = await rawObjects(page, owner.boardId);
    expect(raw['qa-frame'].locked ?? false).toBeFalsy();
    expect(raw['qa-a'].locked ?? false).toBeFalsy();
    // меню объекта предлагает тот же выбор
    const p = await freePointOf(page, 'qa-frame');
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await expect(objectMenu(page)).toBeVisible();
    await expect(objectMenu(page).getByRole('menuitem', { name: 'Lock frame only', exact: true })).toBeVisible();
    await expect(objectMenu(page).getByRole('menuitem', { name: 'Lock frame and content', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(dialogs, 'выбор — не браузерный диалог').toBe(0);
  } finally {
    await owner.close();
  }
});

test('FRM-05 Frame only: the frame does not move, the sticky inside still moves; the second client sees the lock', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await frameWithSticky(page, owner.boardId);
    await lockFrame(page, 'qa-frame', 'Frame only');
    await expect(obj(page, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    const f0 = await boxOf(obj(page, 'qa-frame'));
    await moveObject(page, 'qa-frame', { x: 100, y: 60 });
    near(await boxOf(obj(page, 'qa-frame')), f0, 1);
    const a0 = await boxOf(obj(page, 'qa-a'));
    await moveObject(page, 'qa-a', { x: 40, y: 30 });
    near(await boxOf(obj(page, 'qa-a')), { x: a0.x + 40, y: a0.y + 30 }, 12);
    // второй клиент: замок на фрейме, не на стикере; фрейм не двигается и у него
    const g = guest.page;
    await expect(obj(g, 'qa-frame')).toHaveAttribute('data-locked', 'true', { timeout: 10_000 });
    await expect(obj(g, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    const gf0 = await boxOf(obj(g, 'qa-frame'));
    await moveObject(g, 'qa-frame', { x: -80, y: 40 });
    near(await boxOf(obj(g, 'qa-frame')), gf0, 1);
    const ga0 = await boxOf(obj(g, 'qa-a'));
    await moveObject(g, 'qa-a', { x: 20, y: 20 });
    near(await boxOf(obj(g, 'qa-a')), { x: ga0.x + 20, y: ga0.y + 20 }, 12);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-05 CVS-19 Frame and content: neither the frame nor the sticky moves and a drawing inside survives the eraser; the participant is bound too', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    const page = owner.page;
    await frameWithSticky(page, owner.boardId);
    // штрих пера внутри фрейма
    const fb = await boxOf(obj(page, 'qa-frame'));
    await tool(page, 'Pen').click();
    const before = await objectIds(page);
    const y = fb.y + fb.height * 0.8;
    await page.mouse.move(fb.x + fb.width * 0.5, y);
    await page.mouse.down();
    await page.mouse.move(fb.x + fb.width * 0.65, y + 5, { steps: 6 });
    await page.mouse.move(fb.x + fb.width * 0.8, y, { steps: 6 });
    await page.mouse.up();
    const stroke = await newObjectId(page, before, 'drawing');
    await page.keyboard.press('Escape');
    await tool(page, 'Select').click().catch(() => undefined);
    await untilRaw(page, owner.boardId, (o) => expect(parentOf(o[stroke])).toBe('qa-frame'));
    await lockFrame(page, 'qa-frame', 'Frame and content');
    await expect(obj(page, 'qa-a')).toHaveAttribute('data-locked', 'true');
    const f0 = await boxOf(obj(page, 'qa-frame'));
    const a0 = await boxOf(obj(page, 'qa-a'));
    await moveObject(page, 'qa-frame', { x: 90, y: 50 });
    near(await boxOf(obj(page, 'qa-frame')), f0, 1);
    await moveObject(page, 'qa-a', { x: 50, y: 40 });
    near(await boxOf(obj(page, 'qa-a')), a0, 1);
    // ластик по штриху внутри
    await tool(page, 'Pen').click();
    await page.getByRole('toolbar', { name: 'Drawing', exact: true }).getByRole('button', { name: 'Eraser', exact: true }).click();
    const sb = await boxOf(obj(page, stroke));
    await page.mouse.move(sb.x + sb.width / 2, sb.y - 30);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height + 30, { steps: 10 });
    await page.mouse.up();
    await sleep(800);
    await expect(obj(page, stroke)).toHaveCount(1);
    expect((await rawObjects(page, owner.boardId))[stroke], 'штрих в документе').toBeTruthy();
    await page.keyboard.press('Escape');
    // участник по ссылке
    const g = guest.page;
    await expect(obj(g, 'qa-a')).toHaveAttribute('data-locked', 'true', { timeout: 10_000 });
    const ga0 = await boxOf(obj(g, 'qa-a'));
    await moveObject(g, 'qa-a', { x: 30, y: 30 });
    near(await boxOf(obj(g, 'qa-a')), ga0, 1);
    const gf0 = await boxOf(obj(g, 'qa-frame'));
    await moveObject(g, 'qa-frame', { x: 30, y: 30 });
    near(await boxOf(obj(g, 'qa-frame')), gf0, 1);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('FRM-05 Unlock and Unlock all give back movement to the frame and its content', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await frameWithSticky(page, owner.boardId);
    // Unlock у фрейма с содержимым
    await lockFrame(page, 'qa-frame', 'Frame and content');
    await unlock(page, 'qa-frame');
    await expect(obj(page, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    const f0 = await boxOf(obj(page, 'qa-frame'));
    await moveObject(page, 'qa-frame', { x: 40, y: 30 });
    near(await boxOf(obj(page, 'qa-frame')), { x: f0.x + 40, y: f0.y + 30 }, 12);
    const a0 = await boxOf(obj(page, 'qa-a'));
    await moveObject(page, 'qa-a', { x: 20, y: 20 });
    near(await boxOf(obj(page, 'qa-a')), { x: a0.x + 20, y: a0.y + 20 }, 12);
    // Unlock all из меню холста
    await lockFrame(page, 'qa-frame', 'Frame and content');
    await deselect(page);
    await tools(page).getByRole('button', { name: 'Unlock all', exact: true }).click();
    await expect(obj(page, 'qa-frame')).not.toHaveAttribute('data-locked', 'true');
    await expect(obj(page, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    const f1 = await boxOf(obj(page, 'qa-frame'));
    await moveObject(page, 'qa-frame', { x: -40, y: 20 });
    near(await boxOf(obj(page, 'qa-frame')), { x: f1.x - 40, y: f1.y + 20 }, 12);
    const a1 = await boxOf(obj(page, 'qa-a'));
    await moveObject(page, 'qa-a', { x: 15, y: -15 });
    near(await boxOf(obj(page, 'qa-a')), { x: a1.x + 15, y: a1.y - 15 }, 12);
  } finally {
    await owner.close();
  }
});

test('FRM-05 a link participant also gets the choice when locking a frame and the owner sees the lock', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  try {
    await frameWithSticky(owner.page, owner.boardId);
    const g = guest.page;
    await expect(obj(g, 'qa-a')).toBeAttached({ timeout: 10_000 });
    await lockFrame(g, 'qa-frame', 'Frame only');
    await expect(obj(owner.page, 'qa-frame')).toHaveAttribute('data-locked', 'true', { timeout: 10_000 });
    await expect(obj(owner.page, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    const f0 = await boxOf(obj(owner.page, 'qa-frame'));
    await moveObject(owner.page, 'qa-frame', { x: 60, y: 30 });
    near(await boxOf(obj(owner.page, 'qa-frame')), f0, 1);
  } finally {
    await owner.close();
    await guest.close();
  }
});

test('CVS-19 locking a plain sticky still works at once (observation: no frame choice)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-out': OUT });
    await select(page, 'qa-out');
    await barButton(page, 'Lock').click();
    await expect(obj(page, 'qa-out')).toHaveAttribute('data-locked', 'true');
    await expect(lockGroup(page)).toHaveCount(0);
    const b0 = await boxOf(obj(page, 'qa-out'));
    await moveObject(page, 'qa-out', { x: 50, y: 50 });
    near(await boxOf(obj(page, 'qa-out')), b0, 1);
  } finally {
    await owner.close();
  }
});

// =====================================================================
// CVS-07, ARCH
// =====================================================================

test('CVS-07 undo of a frame move brings the frame and its content back', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await frameWithSticky(page, owner.boardId);
    const f0 = await boxOf(obj(page, 'qa-frame'));
    const a0 = await boxOf(obj(page, 'qa-a'));
    await moveObject(page, 'qa-frame', { x: 100, y: 70 });
    near(await boxOf(obj(page, 'qa-a')), { x: a0.x + 100, y: a0.y + 70 }, 12);
    await deselect(page);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(async () => {
      near(await boxOf(obj(page, 'qa-frame')), f0, 2);
      near(await boxOf(obj(page, 'qa-a')), a0, 2);
    }).toPass({ timeout: 5000 });
  } finally {
    await owner.close();
  }
});

test('ARCH a frame is an object with type frame, its child stores the parent and frame-relative coordinates; frame edits do not call HTTP /api', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const api = watchApi(page);
    await frameWithSticky(page, owner.boardId);
    let raw = await rawObjects(page, owner.boardId);
    expect(raw['qa-frame'].type).toBe('frame');
    const rel0 = { x: Number(raw['qa-a'].x), y: Number(raw['qa-a'].y) };
    // сдвиг фрейма не меняет локальные координаты ребёнка
    await moveObject(page, 'qa-frame', { x: 80, y: 40 });
    raw = await untilRaw(page, owner.boardId, (o) => expect(Number(o['qa-frame'].x)).not.toBe(FR.x + -240));
    expect({ x: Number(raw['qa-a'].x), y: Number(raw['qa-a'].y) }).toEqual(rel0);
    expect(parentOf(raw['qa-a'])).toBe('qa-frame');
    // правки фрейма — без HTTP
    await hideContent(page, 'qa-frame');
    await hideContent(page, 'qa-frame', false);
    await lockFrame(page, 'qa-frame', 'Frame only');
    await unlock(page, 'qa-frame');
    await deselect(page);
    expect(api, 'запросы к /api при правке фреймов').toEqual([]);
    await expect(tools(page)).toBeVisible();
  } finally {
    await owner.close();
  }
});

test('FRM-05 CVS-19 boundary: arrow keys and dragging a multi-selection do not move a locked frame or content locked with it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await frameWithSticky(page, owner.boardId);
    await lockFrame(page, 'qa-frame', 'Frame and content');
    const f0 = await boxOf(obj(page, 'qa-frame'));
    const a0 = await boxOf(obj(page, 'qa-a'));
    const pos = (o: Record<string, Record<string, unknown>>, id: string) => ({ x: Number(o[id].x), y: Number(o[id].y) });
    // выделить Shift-щелчками фрейм, стикер и внешний стикер, тянуть за внешний (сравнение — в документе)
    const r0 = await rawObjects(page, owner.boardId);
    await deselect(page);
    const o0 = await boxOf(obj(page, 'qa-out'));
    await page.mouse.click(o0.x + o0.width / 2, o0.y + o0.height / 2);
    const ac = centerOf(await boxOf(obj(page, 'qa-a')));
    const fp = await freePointOf(page, 'qa-frame');
    await page.keyboard.down('Shift');
    await page.mouse.click(ac.x, ac.y);
    await page.mouse.click(fp.x, fp.y);
    await page.keyboard.up('Shift');
    await sleep(300);
    const selIds = await page.locator('[data-object-id][aria-selected="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id')));
    await moveObjectKeepSelection(page, 'qa-out', { x: 40, y: 60 });
    await sleep(600);
    const rm = await rawObjects(page, owner.boardId);
    expect(pos(rm, 'qa-frame')).toEqual(pos(r0, 'qa-frame'));
    expect(pos(rm, 'qa-a')).toEqual(pos(r0, 'qa-a'));
    expect(selIds.length, 'выделено несколько объектов').toBeGreaterThan(1);
    test.info().annotations.push({ type: 'наблюдение', description: `выделено: ${selIds.join(',')}; qa-out ${JSON.stringify(pos(r0, 'qa-out'))} → ${JSON.stringify(pos(rm, 'qa-out'))}` });
    // стрелки (CVS-25 — сдвиг вида) у выделенных фрейма и стикера не меняют их в документе
    await select(page, 'qa-frame');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await select(page, 'qa-a');
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await sleep(600);
    const r1 = await rawObjects(page, owner.boardId);
    expect(pos(r1, 'qa-frame')).toEqual(pos(r0, 'qa-frame'));
    expect(pos(r1, 'qa-a')).toEqual(pos(r0, 'qa-a'));
  } finally {
    await owner.close();
  }
});

/** Перетащить за объект, не сбрасывая текущее выделение. */
async function moveObjectKeepSelection(page: Page, id: string, d: Point) {
  const from = centerOf(await boxOf(obj(page, id)));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 6 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
}

test('FRM-05 boundary: a frame locked Frame only cannot be resized; FRM-04 hidden content travels with a moved frame', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await frameWithSticky(page, owner.boardId);
    const rel = offset(await boxOf(obj(page, 'qa-a')), await boxOf(obj(page, 'qa-frame')));
    // скрыть, сдвинуть фрейм, показать — стикер на своём месте во фрейме
    await hideContent(page, 'qa-frame');
    await expect.poll(() => isShown(page, 'qa-a')).toBe(false);
    await moveObject(page, 'qa-frame', { x: 100, y: 60 });
    await hideContent(page, 'qa-frame', false);
    await expect.poll(() => isShown(page, 'qa-a')).toBe(true);
    near(offset(await boxOf(obj(page, 'qa-a')), await boxOf(obj(page, 'qa-frame'))), rel);
    // Frame only — маркеры размера не меняют фрейм
    await lockFrame(page, 'qa-frame', 'Frame only');
    const f0 = await boxOf(obj(page, 'qa-frame'));
    await select(page, 'qa-frame');
    if (await handle(page, 'se').count()) {
      const h = centerOf(await boxOf(handle(page, 'se')));
      await page.mouse.move(h.x, h.y);
      await page.mouse.down();
      await page.mouse.move(h.x + 80, h.y + 60, { steps: 6 });
      await page.mouse.up();
      await sleep(300);
    }
    near(await boxOf(obj(page, 'qa-frame')), f0, 1);
    expect(Math.abs((await boxOf(obj(page, 'qa-frame'))).width - f0.width)).toBeLessThanOrEqual(1);
  } finally {
    await owner.close();
  }
});
