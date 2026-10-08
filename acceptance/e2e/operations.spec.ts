// Приёмка T5.3 · операции над объектами: CVS-15…20, CVS-22.
// Сценарии — docs/qa/reports/T5.3.md. Подписи интерфейса — из handoff T5.3.
// Наблюдение: документ доски глазами позднего клиента (docState, локальные координаты FRAME),
// DOM-элементы объектов на холсте и порядок наложения (elementFromPoint).
import type { Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, close, openGuest, openOwner, profileOpts, type Point } from './camera';
import {
  allObjects, boardMenu, boxOf, centerOf, docState, FRAME, obj, objectIds, objectMenu, onCanvas, seed,
  selectedIds, selectionBar, tool, tools, untilDoc, writeDoc, type Obj,
} from './scene';

type P = Parameters<typeof profileOpts>[0];
const opts = (p: P) => profileOpts(p);
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');

// Сценарии длинные (два-три клиента и поздний клиент на каждом шаге).
test.beforeEach(() => test.setTimeout(90_000));

const arrangeMenu = (page: Page) => page.getByRole('menu', { name: 'Arrange menu' });
const guides = (page: Page) => page.getByTestId('alignment-guide');
const info = (page: Page) => page.getByLabel('Object info');

/** Выделить объекты: щелчок по первому, Shift+щелчок по остальным. */
async function selectObjects(page: Page, ids: string[]) {
  await page.mouse.click(...xy(await emptyPoint(page)));
  // у левого верхнего угла: копии и дубликаты со сдвигом не перекрывают эту точку
  await obj(page, ids[0]).click({ position: { x: 4, y: 4 } });
  if (ids.length > 1) {
    await page.keyboard.down('Shift');
    for (const id of ids.slice(1)) await obj(page, id).click({ position: { x: 4, y: 4 } });
    await page.keyboard.up('Shift');
  }
}

const xy = (p: Point): [number, number] => [p.x, p.y];

/** Пустая точка холста — внизу посередине (вне сцены 0…400 в локальных координатах). */
async function emptyPoint(page: Page): Promise<Point> {
  return onCanvas(page, 0.45, 0.93);
}

async function arrange(page: Page, item: string) {
  await selectionBar(page).getByRole('button', { name: 'Arrange', exact: true }).click();
  await arrangeMenu(page).getByRole('menuitem', { name: item, exact: true }).click();
  await expect(arrangeMenu(page)).toBeHidden();
}

async function dragFrom(page: Page, from: Point, d: Point, opt: { alt?: boolean; hold?: (page: Page) => Promise<void> } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(d.x || 1) * 6, from.y + Math.sign(d.y || 1) * 4, { steps: 2 });
  if (opt.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 5 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 5 });
  if (opt.hold) await opt.hold(page);
  await page.mouse.up();
  if (opt.alt) await page.keyboard.up('Alt');
}

/** Объект, видимый сверху в точке экрана (id ближайшего элемента объекта). */
async function topAt(page: Page, p: Point): Promise<string | null> {
  return page.evaluate(({ x, y }) => {
    for (const el of document.elementsFromPoint(x, y)) {
      const o = (el as HTMLElement).closest('[data-object-id]');
      if (o && o.getAttribute('data-type') !== 'group') return o.getAttribute('data-object-id');
    }
    return null;
  }, p);
}

/** Мировая (локальная) точка → экран по опорному объекту на холсте. */
async function screenOf(page: Page, refId: string, ref: Obj, w: Point): Promise<Point> {
  const b = await boxOf(obj(page, refId));
  const zoom = b.width / ref.width;
  return { x: b.x + (w.x - ref.x) * zoom, y: b.y + (w.y - ref.y) * zoom };
}

/** Мировое положение объекта (в локальных координатах тестов) с учётом родителя-группы. */
function worldOf(objects: Record<string, Obj>, id: string): Point {
  const o = objects[id];
  const parent = o.parent as string | undefined;
  if (!parent || !objects[parent]) return { x: o.x, y: o.y };
  const p = worldOf(objects, parent);
  // docState сдвигает на FRAME все объекты, а координаты ребёнка — относительно родителя
  return { x: p.x + o.x + FRAME.x, y: p.y + o.y + FRAME.y };
}

const gaps = (items: Obj[], axis: 'x' | 'y') => {
  const size = axis === 'x' ? 'width' : 'height';
  const s = [...items].sort((a, b) => a[axis] - b[axis]);
  return s.slice(1).map((o, i) => o[axis] - (s[i][axis] + s[i][size]));
};

// ---------- CVS-15 ----------

test('CVS-15 align left, right, top and middle line up the selection; the other axis stays; second client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'shape', x: 40, y: 40, width: 100, height: 60 };
    const B: Obj = { type: 'shape', x: 200, y: 140, width: 80, height: 80 };
    const C: Obj = { type: 'sticky', x: 330, y: 70, width: 120, height: 120 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C });
    await selectObjects(page, ['qa-a', 'qa-b', 'qa-c']);
    expect(await selectedIds(page)).toEqual(['qa-a', 'qa-b', 'qa-c']);

    await arrange(page, 'Align left');
    let s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-c'].x).toBe(40));
    for (const id of ['qa-a', 'qa-b', 'qa-c']) expect(s[id].x).toBe(40);
    expect([s['qa-a'].y, s['qa-b'].y, s['qa-c'].y]).toEqual([A.y, B.y, C.y]);
    // второй клиент видит общий левый край
    await expect.poll(async () => {
      const xs = await Promise.all(['qa-a', 'qa-b', 'qa-c'].map(async (id) => Math.round((await boxOf(obj(guest.page, id))).x)));
      return new Set(xs).size;
    }).toBe(1);

    await arrange(page, 'Align top');
    s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-b'].y).toBe(40));
    for (const id of ['qa-a', 'qa-b', 'qa-c']) expect(s[id].y).toBe(40);

    await arrange(page, 'Align right');
    s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-a'].x).not.toBe(40));
    const right = 40 + 120; // правый край самого широкого
    for (const id of ['qa-a', 'qa-b', 'qa-c']) close(s[id].x + s[id].width, right, 0, 0.5);

    await arrange(page, 'Align middle');
    s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-a'].y).not.toBe(40));
    const mid = 40 + 120 / 2;
    for (const id of ['qa-a', 'qa-b', 'qa-c']) close(s[id].y + s[id].height / 2, mid, 0, 0.5);
    // размеры не менялись
    expect([s['qa-a'].width, s['qa-b'].width, s['qa-c'].width]).toEqual([A.width, B.width, C.width]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-15 distribute horizontally and vertically gives equal gaps and keeps the outer objects; two objects cannot be distributed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    // по горизонтали: разные ширины, неравные промежутки
    const A: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    const B: Obj = { type: 'shape', x: 70, y: 20, width: 120, height: 40 };
    const C: Obj = { type: 'shape', x: 420, y: 10, width: 60, height: 40 };
    // по вертикали: разные высоты
    const D: Obj = { type: 'sticky', x: 0, y: 120, width: 60, height: 30 };
    const E: Obj = { type: 'sticky', x: 100, y: 160, width: 60, height: 90 };
    const F: Obj = { type: 'sticky', x: 200, y: 400, width: 60, height: 50 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C, 'qa-d': D, 'qa-e': E, 'qa-f': F });

    await selectObjects(page, ['qa-a', 'qa-b', 'qa-c']);
    await arrange(page, 'Distribute horizontally');
    let s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-b'].x).not.toBe(B.x));
    const gx = gaps([s['qa-a'], s['qa-b'], s['qa-c']], 'x');
    close(gx[0], gx[1], 0, 1);
    close(gx[0], (480 - 0 - 220) / 2, 0, 1);
    expect(s['qa-a'].x).toBe(A.x);
    expect(s['qa-c'].x).toBe(C.x);
    expect(s['qa-b'].y).toBe(B.y);
    await expect.poll(async () => Math.round((await boxOf(obj(guest.page, 'qa-b'))).x - (await boxOf(obj(guest.page, 'qa-a'))).x)).toBeGreaterThan(100);

    await selectObjects(page, ['qa-d', 'qa-e', 'qa-f']);
    await arrange(page, 'Distribute vertically');
    s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-e'].y).not.toBe(E.y));
    const gy = gaps([s['qa-d'], s['qa-e'], s['qa-f']], 'y');
    close(gy[0], gy[1], 0, 1);
    expect(s['qa-d'].y).toBe(D.y);
    expect(s['qa-f'].y).toBe(F.y);
    expect(s['qa-e'].x).toBe(E.x);

    // негатив: два объекта — распределить нельзя, положения не меняются
    const before = (await docState(page, boardId)).objects;
    await selectObjects(page, ['qa-a', 'qa-c']);
    await selectionBar(page).getByRole('button', { name: 'Arrange', exact: true }).click();
    const dist = arrangeMenu(page).getByRole('menuitem', { name: 'Distribute horizontally' });
    if (await dist.count()) {
      if (await dist.isEnabled()) await dist.click();
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const after = (await docState(page, boardId)).objects;
    expect({ a: after['qa-a'].x, c: after['qa-c'].x }).toEqual({ a: before['qa-a'].x, c: before['qa-c'].x });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-15 dragging the spacing handle of the selection frame sets equal gaps and keeps sizes', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    const B: Obj = { type: 'shape', x: 70, y: 10, width: 100, height: 40 };
    const C: Obj = { type: 'shape', x: 260, y: 20, width: 60, height: 40 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C });
    await selectObjects(page, ['qa-a', 'qa-b', 'qa-c']);
    const hx = page.locator('[data-handle="spacing-x"]');
    await expect(hx).toBeVisible();
    await expect(hx).toHaveAttribute('aria-label', 'Adjust horizontal spacing');
    await dragFrom(page, centerOf(await boxOf(hx)), { x: 80, y: 0 });
    const s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-c'].x).not.toBe(C.x));
    const g = gaps([s['qa-a'], s['qa-b'], s['qa-c']], 'x');
    close(g[0], g[1], 0, 1);
    expect(g[0], 'промежуток вырос').toBeGreaterThan(Math.max(30, 90));
    expect([s['qa-a'].width, s['qa-b'].width, s['qa-c'].width]).toEqual([A.width, B.width, C.width]);
    expect([s['qa-a'].height, s['qa-b'].height, s['qa-c'].height]).toEqual([40, 40, 40]);

    // по вертикали — маркер внизу
    const hy = page.locator('[data-handle="spacing-y"]');
    await expect(hy).toBeVisible();
    await dragFrom(page, centerOf(await boxOf(hy)), { x: 0, y: 90 });
    const t = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(new Set([v['qa-a'].y, v['qa-b'].y, v['qa-c'].y]).size).toBe(3));
    const gv = gaps([t['qa-a'], t['qa-b'], t['qa-c']], 'y');
    close(gv[0], gv[1], 0, 1);
    expect(gv[0]).toBeGreaterThan(0);
    expect([t['qa-a'].height, t['qa-b'].height, t['qa-c'].height]).toEqual([40, 40, 40]);
  } finally {
    await owner.close();
  }
});

test('CVS-15 SHR-04 participant by link aligns and distributes', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { boardId } = owner;
  const g = guest.page;
  try {
    await seed(owner.page, boardId, {
      'qa-a': { type: 'shape', x: 0, y: 0, width: 40, height: 40 },
      'qa-b': { type: 'shape', x: 60, y: 100, width: 100, height: 40 },
      'qa-c': { type: 'shape', x: 380, y: 50, width: 60, height: 40 },
    });
    await expect(obj(g, 'qa-c')).toBeVisible();
    await selectObjects(g, ['qa-a', 'qa-b', 'qa-c']);
    await arrange(g, 'Align top');
    await untilDoc(owner.page, boardId, (d) => d.objects, (v) => expect([v['qa-a'].y, v['qa-b'].y, v['qa-c'].y]).toEqual([0, 0, 0]));
    await arrange(g, 'Distribute horizontally');
    const s = await untilDoc(owner.page, boardId, (d) => d.objects, (v) => expect(v['qa-b'].x).not.toBe(60));
    const gx = gaps([s['qa-a'], s['qa-b'], s['qa-c']], 'x');
    close(gx[0], gx[1], 0, 1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-16 (и регрессия CVS-12) ----------

test('CVS-16 a guide appears next to a neighbour while dragging and the object snaps to it; the guide goes away after release', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    // сосед вне сетки 20: прилипание к нему отличимо от прилипания к сетке
    const N: Obj = { type: 'sticky', x: 47, y: 47, width: 100, height: 100 };
    const M: Obj = { type: 'shape', x: 300, y: 240, width: 100, height: 60 };
    await seed(page, boardId, { 'qa-n': N, 'qa-m': M });
    const zoom = (await boxOf(obj(page, 'qa-n'))).width / N.width;
    // верх M к верху N без 3 мировых px: 240 → 50
    let during = 0;
    let values: string[] = [];
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-m'))), { x: 0, y: (50 - 240) * zoom }, {
      hold: async (p) => {
        await p.waitForTimeout(200);
        during = await guides(p).count();
        values = await guides(p).evaluateAll((els) => els.map((e) => `${e.getAttribute('data-axis')}=${e.getAttribute('data-value')}`));
      },
    });
    expect(during, 'направляющая видна во время жеста').toBeGreaterThan(0);
    expect(values.some((v) => v.endsWith(`=${N.y + FRAME.y}`)), `направляющие: ${values.join(', ')}`).toBe(true);
    const m = await untilDoc(page, boardId, (d) => d.objects['qa-m'], (v) => expect(v.y).not.toBe(M.y));
    expect(m.y, 'верх прилип к верху соседа').toBe(N.y);
    await expect(guides(page)).toHaveCount(0);

    // далеко от соседей — направляющих нет
    let far = -1;
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-m'))), { x: 120 * zoom, y: 160 * zoom }, {
      hold: async (p) => {
        await p.waitForTimeout(200);
        far = await guides(p).count();
      },
    });
    expect(far, 'вдали от соседей направляющих нет').toBe(0);

    // с Alt — без прилипания к соседу: точный сдвиг
    const m1 = await untilDoc(page, boardId, (d) => d.objects['qa-m'], (v) => expect(v.x).not.toBe(M.x));
    const target = { x: N.x + N.width + 3, y: N.y + 4 }; // правее соседа на 3, ниже его верха на 4
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-m'))), { x: (target.x - m1.x) * zoom, y: (target.y - m1.y) * zoom }, { alt: true });
    const m2 = await untilDoc(page, boardId, (d) => d.objects['qa-m'], (v) => expect(v.x).not.toBe(m1.x));
    close(m2.x, target.x, 0, 1.5);
    close(m2.y, target.y, 0, 1.5);

    // центр к центру соседа по горизонтали (без Alt)
    const cx = N.x + N.width / 2 - 100 / 2; // x, при котором центры совпадают
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-m'))), { x: (cx + 2 - m2.x) * zoom, y: (260 - m2.y) * zoom });
    const m3 = await untilDoc(page, boardId, (d) => d.objects['qa-m'], (v) => expect(v.y).not.toBe(m2.y));
    expect(m3.x, 'центр прилип к центру соседа').toBe(cx);
  } finally {
    await owner.close();
  }
});

// ---------- CVS-17 ----------

test('CVS-17 ARCH group moves as one, ungroup returns separate objects in place; children are stored relative to the group; second client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 40, y: 40, width: 100, height: 100 };
    const B: Obj = { type: 'shape', x: 200, y: 80, width: 120, height: 60 };
    const C: Obj = { type: 'shape', x: 40, y: 260, width: 80, height: 60 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C });

    // один объект сгруппировать нельзя
    await selectObjects(page, ['qa-a']);
    await expect(selectionBar(page).getByRole('button', { name: 'Group', exact: true })).toHaveCount(0);

    await selectObjects(page, ['qa-a', 'qa-b']);
    await selectionBar(page).getByRole('button', { name: 'Group', exact: true }).click();
    const s = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(Object.values(v).some((x) => x.type === 'group')).toBe(true));
    const gid = Object.keys(s).find((id) => s[id].type === 'group')!;
    expect(s['qa-a'].parent).toBe(gid);
    expect(s['qa-b'].parent).toBe(gid);
    expect(s['qa-c'].parent ?? null).toBeNull();
    // мировые места не изменились
    expect(worldOf(s, 'qa-a')).toEqual({ x: A.x, y: A.y });
    expect(worldOf(s, 'qa-b')).toEqual({ x: B.x, y: B.y });
    await expect(page.locator(`[data-object-id="${gid}"][data-type="group"]`)).toBeAttached();
    await expect(guest.page.locator(`[data-object-id="${gid}"][data-type="group"]`)).toBeAttached();

    // щелчок по объекту группы выделяет группу
    await page.mouse.click(...xy(await emptyPoint(page)));
    await obj(page, 'qa-a').click();
    expect(await selectedIds(page)).toEqual([gid]);

    // перетаскивание двигает всю группу
    const zoom = (await boxOf(obj(page, 'qa-c'))).width / C.width;
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-a'))), { x: 100 * zoom, y: 60 * zoom }, { alt: true });
    const s1 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(worldOf(v, 'qa-a').x).not.toBe(A.x));
    const dA = { x: worldOf(s1, 'qa-a').x - A.x, y: worldOf(s1, 'qa-a').y - A.y };
    const dB = { x: worldOf(s1, 'qa-b').x - B.x, y: worldOf(s1, 'qa-b').y - B.y };
    close(dA.x, 100, 0, 2);
    close(dA.y, 60, 0, 2);
    expect(dB).toEqual(dA);
    expect({ x: s1['qa-c'].x, y: s1['qa-c'].y }).toEqual({ x: C.x, y: C.y });
    // второй клиент видит сдвиг обоих
    await expect.poll(async () => Math.round((await boxOf(obj(guest.page, 'qa-b'))).x - (await boxOf(obj(guest.page, 'qa-a'))).x))
      .toBe(Math.round((B.x - A.x) * ((await boxOf(obj(guest.page, 'qa-c'))).width / C.width)));

    // разгруппировка: отдельные объекты на тех же мировых местах
    await selectionBar(page).getByRole('button', { name: 'Ungroup', exact: true }).click();
    const s2 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v[gid]).toBeUndefined());
    expect(s2['qa-a'].parent ?? null).toBeNull();
    expect(s2['qa-b'].parent ?? null).toBeNull();
    expect({ x: s2['qa-a'].x, y: s2['qa-a'].y }).toEqual(worldOf(s1, 'qa-a'));
    expect({ x: s2['qa-b'].x, y: s2['qa-b'].y }).toEqual(worldOf(s1, 'qa-b'));
    await expect(guest.page.locator('[data-type="group"]')).toHaveCount(0);
    // теперь щелчок выделяет один объект
    await page.mouse.click(...xy(await emptyPoint(page)));
    await obj(page, 'qa-b').click();
    expect(await selectedIds(page)).toEqual(['qa-b']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-17 layer order of an object inside a group and of the whole group', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  test.setTimeout(90_000);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    // A < B < C перекрываются; E — снаружи, сверху, перекрывает все три
    const A: Obj = { type: 'shape', x: 0, y: 0, width: 160, height: 160, z: 1 };
    const B: Obj = { type: 'shape', x: 60, y: 60, width: 160, height: 160, z: 2 };
    const C: Obj = { type: 'shape', x: 120, y: 120, width: 160, height: 160, z: 3 };
    const E: Obj = { type: 'sticky', x: 130, y: 130, width: 60, height: 60, z: 10 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C, 'qa-e': E });
    const AB = await screenOf(page, 'qa-a', A, { x: 90, y: 90 }); // A и B
    const ABCE = await screenOf(page, 'qa-a', A, { x: 150, y: 150 }); // все четыре
    const BC = await screenOf(page, 'qa-a', A, { x: 200, y: 200 }); // B и C
    expect(await topAt(page, AB)).toBe('qa-b');
    expect(await topAt(page, ABCE)).toBe('qa-e');

    // перекрываются — выделяю щелчками по открытым частям
    await page.mouse.click(...xy(await emptyPoint(page)));
    const only = { a: { x: 20, y: 20 }, b: { x: 200, y: 70 }, c: { x: 260, y: 260 } };
    const pa = await screenOf(page, 'qa-a', A, only.a);
    await page.mouse.click(pa.x, pa.y);
    await page.keyboard.down('Shift');
    for (const w of [only.b, only.c]) {
      const p = await screenOf(page, 'qa-a', A, w);
      await page.mouse.click(p.x, p.y);
    }
    await page.keyboard.up('Shift');
    expect(await selectedIds(page)).toEqual(['qa-a', 'qa-b', 'qa-c']);
    await selectionBar(page).getByRole('button', { name: 'Group', exact: true }).click();
    await untilDoc(page, boardId, (d) => d.objects['qa-a'].parent, (v) => expect(v).toBeTruthy());
    // порядок внутри не изменился
    expect(await topAt(page, AB)).toBe('qa-b');
    expect(await topAt(page, BC)).toBe('qa-c');

    // элемент внутри группы: двойной щелчок по A, «на передний план» — выше B и C, но не выше E
    await page.mouse.click(...xy(await emptyPoint(page)));
    const aOnly = await screenOf(page, 'qa-a', A, { x: 20, y: 20 });
    await page.mouse.dblclick(aOnly.x, aOnly.y);
    expect(await selectedIds(page)).toEqual(['qa-a']);
    await arrange(page, 'Bring to front');
    await expect.poll(() => topAt(page, AB)).toBe('qa-a');
    await expect.poll(() => topAt(page, ABCE)).toBe('qa-e');
    const gABCE = await screenOf(guest.page, 'qa-e', E, { x: 150, y: 150 });
    await expect.poll(() => topAt(guest.page, gABCE)).toBe('qa-e');
    // A — среди объектов группы выше всех
    const s = await docState(page, boardId);
    expect(s.objects['qa-a'].z).toBeGreaterThan(s.objects['qa-b'].z as number);
    expect(s.objects['qa-a'].z).toBeGreaterThan(s.objects['qa-c'].z as number);
    // элемент внутри: «назад на один» — между B и C? (A на вершине: ниже C, выше B)
    await arrange(page, 'Send backward');
    await expect.poll(() => topAt(page, AB)).toBe('qa-a'); // A выше B
    const sb = (await docState(page, boardId)).objects;
    expect(sb['qa-a'].z).toBeLessThan(sb['qa-c'].z as number);
    expect(sb['qa-a'].z).toBeGreaterThan(sb['qa-b'].z as number);

    // группа целиком: на передний план — выше E, порядок внутри сохраняется
    await page.mouse.click(...xy(await emptyPoint(page)));
    const cOnly = await screenOf(page, 'qa-a', A, { x: 260, y: 260 });
    await page.mouse.click(cOnly.x, cOnly.y);
    const sel = await selectedIds(page);
    expect(sel.length).toBe(1);
    expect(sel[0]).not.toMatch(/^qa-/);
    await arrange(page, 'Bring to front');
    await expect.poll(() => topAt(page, ABCE)).not.toBe('qa-e');
    expect(await topAt(page, ABCE)).toBe('qa-c');
    expect(await topAt(page, AB)).toBe('qa-a');
    await expect.poll(() => topAt(guest.page, gABCE)).toBe('qa-c');
    // и на задний — E снова сверху
    await arrange(page, 'Send to back');
    await expect.poll(() => topAt(page, ABCE)).toBe('qa-e');
    expect(await topAt(page, AB)).toBe('qa-a');
    // поздний клиент: тот же порядок по z (группа ниже E)
    const late = (await docState(page, boardId)).objects;
    const gid = late['qa-a'].parent as string;
    expect(late[gid].z).toBeLessThan(late['qa-e'].z as number);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-17 SHR-04 participant by link groups and ungroups', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { boardId } = owner;
  const g = guest.page;
  try {
    await seed(owner.page, boardId, {
      'qa-a': { type: 'shape', x: 40, y: 40, width: 80, height: 80 },
      'qa-b': { type: 'shape', x: 200, y: 40, width: 80, height: 80 },
    });
    await expect(obj(g, 'qa-b')).toBeVisible();
    await selectObjects(g, ['qa-a', 'qa-b']);
    await selectionBar(g).getByRole('button', { name: 'Group', exact: true }).click();
    await expect(owner.page.locator('[data-type="group"]')).toHaveCount(1);
    await untilDoc(owner.page, boardId, (d) => d.objects['qa-b'].parent, (v) => expect(v).toBeTruthy());
    await selectionBar(g).getByRole('button', { name: 'Ungroup', exact: true }).click();
    await expect(owner.page.locator('[data-type="group"]')).toHaveCount(0);
    const s = await untilDoc(owner.page, boardId, (d) => d.objects, (v) => expect(v['qa-b'].parent ?? null).toBeNull());
    expect({ x: s['qa-b'].x, y: s['qa-b'].y }).toEqual({ x: 200, y: 40 });
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-18 ----------

test('CVS-18 forward and backward by one layer, to front and to back; edges do nothing; second and late clients see the order', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const A: Obj = { type: 'shape', x: 0, y: 0, width: 160, height: 160, z: 1 };
    const B: Obj = { type: 'shape', x: 60, y: 60, width: 160, height: 160, z: 2 };
    const C: Obj = { type: 'shape', x: 120, y: 120, width: 160, height: 160, z: 3 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C });
    const ALL = await screenOf(page, 'qa-a', A, { x: 140, y: 140 });
    const AB = await screenOf(page, 'qa-a', A, { x: 90, y: 90 });
    await expect(obj(guest.page, 'qa-c')).toBeVisible();
    const gALL = await screenOf(guest.page, 'qa-a', A, { x: 140, y: 140 });
    const gAB = await screenOf(guest.page, 'qa-a', A, { x: 90, y: 90 });
    const order = async () => {
      const s = (await docState(page, boardId)).objects;
      for (const id of ['qa-a', 'qa-b', 'qa-c']) expect(Number.isInteger(s[id].z), `z ${id}`).toBe(true);
      return ['qa-a', 'qa-b', 'qa-c'].sort((x, y) => (s[x].z as number) - (s[y].z as number));
    };
    const aOnly = await screenOf(page, 'qa-a', A, { x: 20, y: 20 });
    await page.mouse.click(aOnly.x, aOnly.y);
    expect(await selectedIds(page)).toEqual(['qa-a']);

    await arrange(page, 'Bring forward');
    await expect.poll(order).toEqual(['qa-b', 'qa-a', 'qa-c']);
    expect(await topAt(page, AB)).toBe('qa-a');
    expect(await topAt(page, ALL)).toBe('qa-c');
    await expect.poll(() => topAt(guest.page, gAB)).toBe('qa-a');

    await arrange(page, 'Bring to front');
    await expect.poll(order).toEqual(['qa-b', 'qa-c', 'qa-a']);
    expect(await topAt(page, ALL)).toBe('qa-a');
    await expect.poll(() => topAt(guest.page, gALL)).toBe('qa-a');

    // граница: «вперёд» у самого верхнего — без изменений
    await arrange(page, 'Bring forward');
    await page.waitForTimeout(500);
    expect(await order()).toEqual(['qa-b', 'qa-c', 'qa-a']);

    await arrange(page, 'Send backward');
    await expect.poll(order).toEqual(['qa-b', 'qa-a', 'qa-c']);
    expect(await topAt(page, ALL)).toBe('qa-c');

    await arrange(page, 'Send to back');
    await expect.poll(order).toEqual(['qa-a', 'qa-b', 'qa-c']);
    expect(await topAt(page, AB)).toBe('qa-b');
    await expect.poll(() => topAt(guest.page, gAB)).toBe('qa-b');

    // граница: «назад» у самого нижнего — без изменений
    await arrange(page, 'Send backward');
    await page.waitForTimeout(500);
    expect(await order()).toEqual(['qa-a', 'qa-b', 'qa-c']);

    // те же пункты есть в меню объекта
    await obj(page, 'qa-c').click({ button: 'right', position: { x: 150, y: 150 } });
    for (const item of ['Bring to front', 'Bring forward', 'Send backward', 'Send to back']) {
      await expect(objectMenu(page).getByRole('menuitem', { name: item, exact: true })).toBeVisible();
    }
    await objectMenu(page).getByRole('menuitem', { name: 'Send to back', exact: true }).click();
    await expect.poll(order).toEqual(['qa-c', 'qa-a', 'qa-b']);
    // поздний клиент (новая вкладка) видит тот же порядок
    const late = await openGuest(browser, o, owner.token, 'QA Late');
    try {
      await expect(obj(late.page, 'qa-c')).toBeVisible();
      expect(await topAt(late.page, await screenOf(late.page, 'qa-a', A, { x: 140, y: 140 }))).toBe('qa-b');
    } finally {
      await late.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-18 SHR-04 participant by link changes the layer order', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { boardId } = owner;
  const g = guest.page;
  try {
    const A: Obj = { type: 'shape', x: 0, y: 0, width: 160, height: 160, z: 1 };
    const B: Obj = { type: 'shape', x: 60, y: 60, width: 160, height: 160, z: 2 };
    await seed(owner.page, boardId, { 'qa-a': A, 'qa-b': B });
    await expect(obj(g, 'qa-b')).toBeVisible();
    const aOnly = await screenOf(g, 'qa-a', A, { x: 20, y: 20 });
    await g.mouse.click(aOnly.x, aOnly.y);
    await arrange(g, 'Bring to front');
    const ownerAB = await screenOf(owner.page, 'qa-a', A, { x: 100, y: 100 });
    await expect.poll(() => topAt(owner.page, ownerAB)).toBe('qa-a');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-19 ----------

test('CVS-19 a locked object does not move or resize for anyone; unlock makes it movable again', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'shape', x: 60, y: 60, width: 120, height: 80 };
    await seed(page, boardId, { 'qa-a': A });
    await selectObjects(page, ['qa-a']);
    await selectionBar(page).getByRole('button', { name: 'Lock', exact: true }).click();
    await untilDoc(page, boardId, (d) => d.objects['qa-a'].locked, (v) => expect(v).toBe(true));
    await expect(obj(page, 'qa-a')).toHaveAttribute('data-locked', 'true');
    await expect(obj(guest.page, 'qa-a')).toHaveAttribute('data-locked', 'true');
    await expect(obj(guest.page, 'qa-a').getByTestId('lock-badge')).toBeAttached();

    // перетаскивание владельцем не двигает
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-a'))), { x: 120, y: 80 });
    await page.waitForTimeout(800);
    let s = (await docState(page, boardId)).objects['qa-a'];
    expect({ x: s.x, y: s.y, w: s.width, h: s.height }).toEqual({ x: A.x, y: A.y, w: A.width, h: A.height });
    // маркер размера: нет или не действует
    const se = page.locator('[data-handle="se"]');
    if (await se.count()) {
      await dragFrom(page, centerOf(await boxOf(se)), { x: 60, y: 40 });
      await page.waitForTimeout(600);
      s = (await docState(page, boardId)).objects['qa-a'];
      expect({ w: s.width, h: s.height }).toEqual({ w: A.width, h: A.height });
    }
    // и второй клиент не двигает
    await guest.page.mouse.click(...xy(await emptyPoint(guest.page)));
    await dragFrom(guest.page, centerOf(await boxOf(obj(guest.page, 'qa-a'))), { x: -40, y: 120 });
    await page.waitForTimeout(800);
    s = (await docState(page, boardId)).objects['qa-a'];
    expect({ x: s.x, y: s.y }).toEqual({ x: A.x, y: A.y });
    // наблюдение: Delete на заблокированном
    await obj(page, 'qa-a').click();
    await page.keyboard.press('Delete');
    await page.waitForTimeout(600);
    const stillThere = !!(await docState(page, boardId)).objects['qa-a'];
    test.info().annotations.push({ type: 'наблюдение', description: `Delete по заблокированному: объект ${stillThere ? 'остался' : 'удалён'}` });
    expect(stillThere).toBe(true);

    // снять блокировку — снова двигается
    await selectObjects(page, ['qa-a']);
    await selectionBar(page).getByRole('button', { name: 'Unlock', exact: true }).click();
    await untilDoc(page, boardId, (d) => d.objects['qa-a'].locked ?? false, (v) => expect(v).toBe(false));
    await expect(obj(guest.page, 'qa-a')).not.toHaveAttribute('data-locked', 'true');
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-a'))), { x: 100, y: 0 }, { alt: true });
    const moved = await untilDoc(page, boardId, (d) => d.objects['qa-a'], (v) => expect(v.x).not.toBe(A.x));
    expect(moved.x).toBeGreaterThan(A.x + 50);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-19 Unlock all on the board removes every lock, also on objects that are not selected', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const items: Record<string, Obj> = {
      'qa-a': { type: 'shape', x: 0, y: 0, width: 80, height: 80 },
      'qa-b': { type: 'sticky', x: 140, y: 0, width: 80, height: 80 },
      'qa-c': { type: 'shape', x: 280, y: 0, width: 80, height: 80 },
      'qa-d': { type: 'shape', x: 0, y: 160, width: 80, height: 80 },
    };
    await seed(page, boardId, items);
    // кнопка неактивна, пока заблокированных нет
    const unlockAllBtn = tools(page).getByRole('button', { name: 'Unlock all', exact: true });
    await expect(unlockAllBtn).toBeDisabled();
    for (const id of ['qa-a', 'qa-b']) {
      await selectObjects(page, [id]);
      await selectionBar(page).getByRole('button', { name: 'Lock', exact: true }).click();
    }
    // участник блокирует третий
    await selectObjects(guest.page, ['qa-c']);
    await selectionBar(guest.page).getByRole('button', { name: 'Lock', exact: true }).click();
    await untilDoc(page, boardId, (d) => ['qa-a', 'qa-b', 'qa-c'].map((id) => d.objects[id].locked), (v) => expect(v).toEqual([true, true, true]));
    await expect(unlockAllBtn).toBeEnabled();

    // меню холста: Unlock all, выделено только D
    await selectObjects(page, ['qa-d']);
    const empty = await emptyPoint(page);
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    await boardMenu(page).getByRole('menuitem', { name: 'Unlock all', exact: true }).click();
    const locks = await untilDoc(page, boardId, (d) => Object.values(d.objects).filter((x) => x.locked === true).length, (v) => expect(v).toBe(0));
    expect(locks).toBe(0);
    await expect(page.locator('[data-object-id][data-locked="true"]')).toHaveCount(0);
    await expect(guest.page.locator('[data-object-id][data-locked="true"]')).toHaveCount(0);
    await expect(unlockAllBtn).toBeDisabled();
    // в меню холста пункта больше нет
    await page.mouse.click(empty.x, empty.y, { button: 'right' });
    await expect(boardMenu(page).getByRole('menuitem', { name: 'Unlock all', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // кнопка панели инструментов у участника
    await selectObjects(page, ['qa-d']);
    await selectionBar(page).getByRole('button', { name: 'Lock', exact: true }).click();
    const gBtn = tools(guest.page).getByRole('button', { name: 'Unlock all', exact: true });
    await expect(gBtn).toBeEnabled();
    await gBtn.click();
    await untilDoc(page, boardId, (d) => d.objects['qa-d'].locked ?? false, (v) => expect(v).toBe(false));
    // объекты снова двигаются
    await page.mouse.click(...xy(empty));
    await dragFrom(page, centerOf(await boxOf(obj(page, 'qa-b'))), { x: 0, y: 200 }, { alt: true });
    await untilDoc(page, boardId, (d) => d.objects['qa-b'].y, (v) => expect(v).toBeGreaterThan(100));
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-20 ----------

/**
 * Положить объекты как Y.Map — так их пишет сам клиент (seed пишет JSON-значения, а их
 * верхний `z` клиент при вставке не учитывает — см. отчёт, наблюдение).
 */
async function seedMaps(page: Page, boardId: string, items: Record<string, Obj>) {
  await writeDoc(page, boardId, (doc) => {
    const objects = doc.getMap('objects');
    for (const [id, o] of Object.entries(items)) {
      const m = new Y.Map<unknown>();
      for (const [k, v] of Object.entries({ ...o, x: o.x + FRAME.x, y: o.y + FRAME.y })) m.set(k, k === 'text' ? new Y.Text(String(v)) : v);
      objects.set(id, m);
    }
  });
  for (const id of Object.keys(items)) await expect(obj(page, id)).toBeAttached();
}

/** Объекты, появившиеся после `before` (id → объект). */
function added(now: Record<string, Obj>, before: Record<string, Obj>) {
  return Object.fromEntries(Object.entries(now).filter(([id]) => !(id in before)));
}

const props = (o: Obj) => ({ type: o.type, width: o.width, height: o.height, fill: o.fill, text: o.text });

test('CVS-20 ARCH copy, paste, duplicate and cut on this board; cut goes to trash; second client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 40, y: 40, width: 120, height: 120, fill: '#81d4fa', text: 'QA copy me', z: 1 };
    const B: Obj = { type: 'shape', x: 200, y: 60, width: 100, height: 60, z: 2 };
    await seedMaps(page, boardId, { 'qa-a': A, 'qa-b': B });
    const s0 = (await docState(page, boardId)).objects;

    await selectObjects(page, ['qa-a', 'qa-b']);
    await page.keyboard.press('ControlOrMeta+C');
    const P = await onCanvas(page, 0.55, 0.7);
    await page.mouse.click(P.x, P.y);
    await page.keyboard.press('ControlOrMeta+V');
    await expect(allObjects(page)).toHaveCount(4);
    const s1 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(4));
    const n1 = added(s1, s0);
    const copies = Object.values(n1);
    expect(copies.map(props).sort((a, b) => a.type.localeCompare(b.type))).toEqual([props(B), props(A)].sort((a, b) => a.type.localeCompare(b.type)));
    const ca = copies.find((c) => c.type === 'sticky')!;
    const cb = copies.find((c) => c.type === 'shape')!;
    // взаимное положение и новый слой поверх
    expect({ dx: cb.x - ca.x, dy: cb.y - ca.y }).toEqual({ dx: B.x - A.x, dy: B.y - A.y });
    expect(ca.x === A.x && ca.y === A.y, 'копия не на месте оригинала').toBe(false);
    expect(Math.min(ca.z as number, cb.z as number), `z копий ${ca.z}, ${cb.z}; оригиналов ${JSON.stringify(Object.fromEntries(Object.entries(s1).map(([k, v]) => [k, v.z])))}`).toBeGreaterThan(2);
    // оригиналы не изменились
    expect(s1['qa-a']).toEqual(s0['qa-a']);
    for (const id of Object.keys(n1)) await expect(obj(guest.page, id)).toBeVisible();

    // повторная вставка — ещё одна копия, прежние на месте
    await page.keyboard.press('ControlOrMeta+V');
    const s2 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(6));
    for (const [id, c] of Object.entries(n1)) expect({ x: s2[id].x, y: s2[id].y }).toEqual({ x: c.x, y: c.y });

    // дублирование: одна команда — копия выделенного
    await selectObjects(page, ['qa-b']);
    await page.keyboard.press('ControlOrMeta+D');
    const s3 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(7));
    const dup = Object.values(added(s3, s2))[0];
    expect(props(dup)).toEqual(props(B));
    // дублирование из меню объекта
    await obj(page, 'qa-a').click({ button: 'right' });
    await objectMenu(page).getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
    const s4 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(8));
    expect(props(Object.values(added(s4, s3))[0])).toEqual(props(A));

    // вырезание: объект уходит из objects в trash, вставка возвращает копию
    await selectObjects(page, ['qa-a']);
    await page.keyboard.press('ControlOrMeta+X');
    const cut = await untilDoc(page, boardId, (d) => d, (v) => expect(v.objects['qa-a']).toBeUndefined());
    await expect(obj(guest.page, 'qa-a')).toHaveCount(0);
    const tr = cut.trash['qa-a'] as { object?: Obj; deletedAt?: string; deletedBy?: string };
    expect(tr, 'вырезанный объект в trash').toBeTruthy();
    expect(tr.deletedBy).toBe(owner.name);
    expect(Math.abs(Date.parse(String(tr.deletedAt)) - Date.now())).toBeLessThan(120_000);
    expect(tr.object?.type).toBe('sticky');
    const P2 = await onCanvas(page, 0.25, 0.85);
    await page.mouse.click(P2.x, P2.y);
    await page.keyboard.press('ControlOrMeta+V');
    const s5 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(8));
    const pastedId = Object.keys(added(s5, cut.objects))[0];
    expect(props(s5[pastedId])).toEqual(props(A));

    // ARCH: удаление (Delete) тоже переносит в trash
    await selectObjects(page, ['qa-b']);
    await page.keyboard.press('Delete');
    const del = await untilDoc(page, boardId, (d) => d, (v) => expect(v.objects['qa-b']).toBeUndefined());
    expect((del.trash['qa-b'] as { deletedBy?: string }).deletedBy).toBe(owner.name);

    // негатив: вставка в поле ввода объектов не создаёт
    await selectObjects(page, [pastedId]);
    await page.keyboard.press('ControlOrMeta+C');
    const nowCount = await allObjects(page).count();
    const editBtn = selectionBar(page).getByRole('button', { name: 'Edit text', exact: true });
    if (await editBtn.count()) {
      await editBtn.click();
      await expect(page.getByLabel('Object text')).toBeFocused();
      await page.keyboard.press('ControlOrMeta+V');
      await page.waitForTimeout(600);
      await expect(allObjects(page)).toHaveCount(nowCount);
      await page.keyboard.press('Escape');
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-20 objects copied on one board are pasted on another board of the same user with their properties; the source stays', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 40, y: 40, width: 120, height: 120, fill: '#81d4fa', text: 'QA across boards' };
    const B: Obj = { type: 'shape', x: 220, y: 70, width: 100, height: 60 };
    const C: Obj = { type: 'shape', x: 40, y: 240, width: 80, height: 50 };
    await seedMaps(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C });
    // A и B в группе — копируется и группа
    await selectObjects(page, ['qa-a', 'qa-b']);
    await selectionBar(page).getByRole('button', { name: 'Group', exact: true }).click();
    await untilDoc(page, boardId, (d) => d.objects['qa-a'].parent, (v) => expect(v).toBeTruthy());
    const src = (await docState(page, boardId)).objects;
    await page.mouse.click(...xy(await emptyPoint(page)));
    await obj(page, 'qa-a').click(); // выделяет группу
    await page.keyboard.down('Shift');
    await obj(page, 'qa-c').click();
    await page.keyboard.up('Shift');
    expect((await selectedIds(page)).length).toBe(2);
    await page.keyboard.press('ControlOrMeta+C');

    // вторая доска того же пользователя, клавиши
    const board2 = await owner.newBoard();
    await page.goto(`/boards/${board2}`);
    await expect(canvas(page)).toBeVisible();
    await expect(allObjects(page)).toHaveCount(0);
    const P = await onCanvas(page, 0.5, 0.5);
    await page.mouse.click(P.x, P.y);
    await page.keyboard.press('ControlOrMeta+V');
    const b2 = await untilDoc(page, board2, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(4));
    const vals = Object.values(b2);
    const group = Object.entries(b2).find(([, x]) => x.type === 'group');
    expect(group, 'группа скопирована').toBeTruthy();
    const kids = Object.entries(b2).filter(([, x]) => x.parent === group![0]);
    expect(kids.map(([, k]) => props(k)).sort((x, y) => x.type.localeCompare(y.type))).toEqual([props(B), props(A)].sort((x, y) => x.type.localeCompare(y.type)));
    expect(vals.filter((x) => x.type === 'shape' && !x.parent).map(props)).toEqual([props(C)]);
    for (const id of Object.keys(b2)) expect(id in src).toBe(false);
    // взаимное положение: A–B внутри группы, группа–C
    const ka = kids.find(([, k]) => k.type === 'sticky')![0];
    const kb = kids.find(([, k]) => k.type === 'shape')![0];
    const kc = Object.entries(b2).find(([, x]) => x.type === 'shape' && !x.parent)![0];
    const wa = worldOf(b2, ka);
    const wb = worldOf(b2, kb);
    const wc = worldOf(b2, kc);
    expect({ dx: wb.x - wa.x, dy: wb.y - wa.y }).toEqual({ dx: B.x - A.x, dy: B.y - A.y });
    expect({ dx: wc.x - wa.x, dy: wc.y - wa.y }).toEqual({ dx: C.x - A.x, dy: C.y - A.y });
    await expect(allObjects(page).filter({ hasText: 'QA across boards' })).toHaveCount(1);

    // вставка из меню холста («Paste here») — ещё раз на той же второй доске
    const Q = await onCanvas(page, 0.3, 0.85);
    await page.mouse.click(Q.x, Q.y, { button: 'right' });
    await boardMenu(page).getByRole('menuitem', { name: 'Paste here', exact: true }).click();
    await untilDoc(page, board2, (d) => Object.keys(d.objects).length, (v) => expect(v).toBe(8));

    // доска-источник не изменилась
    const after = (await docState(page, boardId)).objects;
    expect(after).toEqual(src);
  } finally {
    await owner.close();
  }
});

test('CVS-20 SHR-04 participant by link copies, pastes and duplicates on the board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { boardId } = owner;
  const g = guest.page;
  try {
    const A: Obj = { type: 'sticky', x: 40, y: 40, width: 120, height: 120, text: 'QA guest copy' };
    await seedMaps(owner.page, boardId, { 'qa-a': A });
    await expect(obj(g, 'qa-a')).toBeVisible();
    await selectObjects(g, ['qa-a']);
    await g.keyboard.press('ControlOrMeta+C');
    const P = await onCanvas(g, 0.6, 0.7);
    await g.mouse.click(P.x, P.y);
    await g.keyboard.press('ControlOrMeta+V');
    const s = await untilDoc(owner.page, boardId, (d) => d.objects, (v) => expect(Object.keys(v).length).toBe(2));
    const copy = Object.entries(s).find(([id]) => id !== 'qa-a')![1];
    expect(props(copy)).toEqual(props(A));
    await selectObjects(g, ['qa-a']);
    await g.keyboard.press('ControlOrMeta+D');
    await untilDoc(owner.page, boardId, (d) => Object.keys(d.objects).length, (v) => expect(v).toBe(3));
    await expect(allObjects(owner.page).filter({ hasText: 'QA guest copy' })).toHaveCount(3);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-22 ----------

const within = (iso: string | null, fromMs: number, toMs: number) => {
  const t = Date.parse(String(iso));
  expect(Number.isFinite(t), `дата ${iso}`).toBe(true);
  expect(t).toBeGreaterThanOrEqual(fromMs - 60_000);
  expect(t).toBeLessThanOrEqual(toMs + 60_000);
  return t;
};

test('CVS-22 author and dates: created by the owner, modified by a participant by link (name from the session); kept after reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Kate');
  const { page, boardId } = owner;
  try {
    const t0 = Date.now();
    await tool(page, 'Shape').click();
    const P = await onCanvas(page, 0.3, 0.3);
    await page.mouse.click(P.x, P.y);
    await expect(allObjects(page)).toHaveCount(1);
    const editor = page.getByLabel('Object text');
    if (await editor.isVisible().catch(() => false)) await page.keyboard.press('Escape');
    const id = (await objectIds(page))[0];
    await selectObjects(page, [id]);
    const created = info(page).getByTestId('object-created');
    const modified = info(page).getByTestId('object-modified');
    await expect(created).toContainText(owner.name);
    const c1 = within(await created.locator('time').getAttribute('datetime'), t0, Date.now());
    await expect(modified).toContainText(owner.name);

    // негатив: выделение без правки не меняет «последнее изменение»
    const m0 = await modified.locator('time').getAttribute('datetime');
    const d0 = (await docState(page, boardId)).objects[id];
    await page.mouse.click(...xy(await emptyPoint(page)));
    await page.waitForTimeout(1200);
    await obj(page, id).click();
    await page.waitForTimeout(600);
    expect(await modified.locator('time').getAttribute('datetime')).toBe(m0);
    expect((await docState(page, boardId)).objects[id].updatedAt).toBe(d0.updatedAt);

    // участник по ссылке двигает объект
    await page.waitForTimeout(1100);
    const t1 = Date.now();
    await guest.page.mouse.click(...xy(await emptyPoint(guest.page)));
    await dragFrom(guest.page, centerOf(await boxOf(obj(guest.page, id))), { x: 80, y: 40 });
    await untilDoc(page, boardId, (d) => d.objects[id].updatedBy, (v) => expect(v).toBe('QA Kate'));
    await page.mouse.click(...xy(await emptyPoint(page)));
    await obj(page, id).click();
    await expect(modified).toContainText('QA Kate');
    await expect(created).toContainText(owner.name);
    await expect(created).not.toContainText('QA Kate');
    const m1 = within(await modified.locator('time').getAttribute('datetime'), t1, Date.now());
    expect(m1).toBeGreaterThanOrEqual(c1);
    expect(m1).toBeGreaterThan(Date.parse(String(m0)));
    // дата создания не изменилась
    expect(Date.parse(String(await created.locator('time').getAttribute('datetime')))).toBe(c1);

    // участник видит то же
    await guest.page.mouse.click(...xy(await emptyPoint(guest.page)));
    await obj(guest.page, id).click();
    await expect(info(guest.page).getByTestId('object-created')).toContainText(owner.name);
    await expect(info(guest.page).getByTestId('object-modified')).toContainText('QA Kate');

    // после перезагрузки — из документа
    await page.reload();
    await expect(obj(page, id)).toBeVisible();
    await obj(page, id).click();
    await expect(info(page).getByTestId('object-created')).toContainText(owner.name);
    await expect(info(page).getByTestId('object-modified')).toContainText('QA Kate');
    const doc = (await docState(page, boardId)).objects[id];
    expect(doc.createdBy).toBe(owner.name);
    expect(doc.updatedBy).toBe('QA Kate');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-22 an object created by a participant by link names the participant as its author; a change of fill updates Modified', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Kate');
  const { page, boardId } = owner;
  const g = guest.page;
  try {
    const t0 = Date.now();
    await tool(g, 'Sticky note').click();
    const P = await onCanvas(g, 0.35, 0.35);
    await g.mouse.click(P.x, P.y);
    await expect(allObjects(g)).toHaveCount(1);
    const editor = g.getByLabel('Object text');
    if (await editor.isVisible().catch(() => false)) await g.keyboard.press('Escape');
    const id = (await objectIds(g))[0];
    await expect(obj(page, id)).toBeVisible();
    await selectObjects(page, [id]);
    await expect(info(page).getByTestId('object-created')).toContainText('QA Kate');
    within(await info(page).getByTestId('object-created').locator('time').getAttribute('datetime'), t0, Date.now());
    // владелец меняет заливку — «изменил» владелец, «создал» участник
    await page.waitForTimeout(1100);
    const fill = selectionBar(page).getByLabel('Fill');
    const optsList = await fill.locator('option:not([disabled])').evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    const cur = await fill.inputValue();
    await fill.selectOption(optsList.find((v) => v !== cur)!);
    await expect(info(page).getByTestId('object-modified')).toContainText(owner.name);
    await expect(info(page).getByTestId('object-created')).toContainText('QA Kate');
    const d = await untilDoc(page, boardId, (s) => s.objects[id], (v) => expect(v.updatedBy).toBe(owner.name));
    expect(d.createdBy).toBe('QA Kate');
    expect(Date.parse(String(d.updatedAt))).toBeGreaterThan(Date.parse(String(d.createdAt)));
  } finally {
    await guest.close();
    await owner.close();
  }
});

// Доступ (посторонний не получает холст чужой доски) — регрессия realtime.spec.ts и test_realtime.py.
