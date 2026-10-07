// Приёмка T5.1 · камера холста (CVS-01…05, MOB-02, COL-04 на жестах телефона).
// Сценарии — docs/qa/reports/T5.1.md (зафиксированы до handoff); подписи интерфейса — из handoff T5.1.
// Камера измеряется зондом «экран → мир» (camera.ts): точка мира под указателем из `awareness`.
import { test, expect } from './fixtures';
import {
  at, canvas, close, dragBy, minimap, minimapView, objectsSeenByLateClient, openGuest, openOwner, profileOpts,
  putObject, Touch, viewBar, viewOf, waitIdle, watchWire, wheelSelect, worldAt, zoomLevel,
  type Point,
} from './camera';

const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'жесты пальцами — профиль mobile');

// ---------- CVS-02 ----------

test('CVS-02 mouse wheel zooms in and out around the pointer', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    const v0 = await viewOf(page, wire);
    const P = await at(page, 0.35, 0.4);
    const w0 = await worldAt(page, wire, P);
    await page.mouse.wheel(0, -300);
    await waitIdle(page);
    const w1 = await worldAt(page, wire, P);
    const v1 = await viewOf(page, wire);
    expect(v1.zoom).toBeGreaterThan(v0.zoom * 1.1);
    // точка под указателем остаётся на месте
    close(w1.x, w0.x, 0.01, 3);
    close(w1.y, w0.y, 0.01, 3);
    await page.mouse.move(P.x, P.y);
    await page.mouse.wheel(0, 600);
    await waitIdle(page);
    const v2 = await viewOf(page, wire);
    expect(v2.zoom).toBeLessThan(v1.zoom / 1.1);
  } finally {
    await owner.close();
  }
});

test('CVS-02 Zoom in and Zoom out buttons change the zoom; zoom level is shown', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    const v0 = await viewOf(page, wire);
    await expect(zoomLevel(page)).toHaveText('100%');
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    const v1 = await viewOf(page, wire);
    expect(v1.zoom).toBeGreaterThan(v0.zoom * 1.1);
    await expect(zoomLevel(page)).not.toHaveText('100%');
    await viewBar(page).getByRole('button', { name: 'Zoom out' }).click();
    await viewBar(page).getByRole('button', { name: 'Zoom out' }).click();
    const v2 = await viewOf(page, wire);
    expect(v2.zoom).toBeLessThan(v0.zoom / 1.1);
  } finally {
    await owner.close();
  }
});

test('CVS-02 keys + and − zoom the view (main keyboard and numpad)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const v0 = await viewOf(page, wire);
    await page.keyboard.press('+');
    const v1 = await viewOf(page, wire);
    expect(v1.zoom).toBeGreaterThan(v0.zoom * 1.1);
    await page.keyboard.press('-');
    const v2 = await viewOf(page, wire);
    close(v2.zoom, v0.zoom, 0.02);
    await page.keyboard.press('NumpadAdd');
    const v3 = await viewOf(page, wire);
    expect(v3.zoom).toBeGreaterThan(v0.zoom * 1.1);
    await page.keyboard.press('NumpadSubtract');
    await page.keyboard.press('NumpadSubtract');
    const v4 = await viewOf(page, wire);
    expect(v4.zoom).toBeLessThan(v0.zoom / 1.1);
  } finally {
    await owner.close();
  }
});

test('CVS-02 dragging the empty canvas moves the view by the drag distance', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    const v0 = await viewOf(page, wire);
    const D = { x: 180, y: -120 };
    await dragBy(page, await at(page, 0.4, 0.6), D);
    const v1 = await viewOf(page, wire);
    // содержимое идёт за рукой: точка мира в центре смещается на −D / масштаб
    close(v1.center.x - v0.center.x, -D.x / v0.zoom, 0.03, 2);
    close(v1.center.y - v0.center.y, -D.y / v0.zoom, 0.03, 2);
    close(v1.zoom, v0.zoom, 0.01);
  } finally {
    await owner.close();
  }
});

test('CVS-02 arrow keys move the view along their axis; opposite arrow moves back', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    await canvas(page).click({ position: { x: 20, y: 20 } });
    const v0 = await viewOf(page, wire);
    await page.keyboard.press('ArrowRight');
    const r = await viewOf(page, wire);
    expect(Math.abs(r.center.x - v0.center.x)).toBeGreaterThan(20);
    close(r.center.y, v0.center.y, 0, 1);
    await page.keyboard.press('ArrowLeft');
    const l = await viewOf(page, wire);
    close(l.center.x, v0.center.x, 0, 1);
    await page.keyboard.press('ArrowDown');
    const d = await viewOf(page, wire);
    expect(Math.abs(d.center.y - v0.center.y)).toBeGreaterThan(20);
    close(d.center.x, v0.center.x, 0, 1);
    await page.keyboard.press('ArrowUp');
    const u = await viewOf(page, wire);
    close(u.center.y, v0.center.y, 0, 1);
    // стрелки вправо и вниз двигают в разные стороны от стрелок влево и вверх
    expect(Math.sign(r.center.x - v0.center.x)).not.toBe(0);
    expect(Math.sign(d.center.y - v0.center.y)).not.toBe(0);
  } finally {
    await owner.close();
  }
});

test('CVS-02 keys do not move or zoom the view while typing in a text field', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    const v0 = await viewOf(page, wire);
    await page.getByRole('button', { name: 'Share' }).click();
    const dialog = page.getByRole('dialog', { name: 'Share board' });
    await dialog.getByLabel('Board link').focus();
    for (const key of ['+', '-', '=', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) await page.keyboard.press(key);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const v1 = await viewOf(page, wire);
    close(v1.zoom, v0.zoom, 0.005);
    close(v1.center.x, v0.center.x, 0, 1);
    close(v1.center.y, v0.center.y, 0, 1);
  } finally {
    await owner.close();
  }
});

test('CVS-02 zoom is bounded: many zoom-ins and zoom-outs keep a finite positive zoom that can be reversed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  const zin = viewBar(page).getByRole('button', { name: 'Zoom in' });
  const zout = viewBar(page).getByRole('button', { name: 'Zoom out' });
  test.setTimeout(120_000);
  try {
    // у предела кнопка может стать недоступной — это тоже ограничение масштаба
    for (let i = 0; i < 30 && (await zin.isEnabled()); i++) await zin.click();
    await expect(zin).toBeDisabled();
    const hi = await viewOf(page, wire);
    expect(Number.isFinite(hi.zoom)).toBe(true);
    expect(hi.zoom).toBeGreaterThan(2);
    for (let i = 0; i < 60 && (await zout.isEnabled()); i++) await zout.click();
    await expect(zout).toBeDisabled();
    const lo = await viewOf(page, wire);
    expect(Number.isFinite(lo.zoom)).toBe(true);
    expect(lo.zoom).toBeGreaterThan(0);
    expect(lo.zoom).toBeLessThan(0.5);
    await zin.click();
    const back = await viewOf(page, wire);
    expect(back.zoom).toBeGreaterThan(lo.zoom * 1.1);
    await expect(zoomLevel(page)).toHaveText(/^\d+%$/);
  } finally {
    await owner.close();
  }
});

test('CVS-02 SHR-04 participant by link zooms with buttons and pans by dragging', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const opts = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Camera Guest');
    const { page, wire } = guest;
    const v0 = await viewOf(page, wire);
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    const v1 = await viewOf(page, wire);
    expect(v1.zoom).toBeGreaterThan(v0.zoom * 1.1);
    const D = { x: -100, y: 70 };
    if (isMobile) {
      const t = await Touch.of(page);
      const A = await at(page, 0.5, 0.5);
      await t.gesture([A], [{ x: A.x + D.x, y: A.y + D.y }]);
    } else {
      await dragBy(page, await at(page, 0.5, 0.5), D);
    }
    const v2 = await viewOf(page, wire);
    close(v2.center.x - v1.center.x, -D.x / v1.zoom, 0.05, 2);
    close(v2.center.y - v1.center.y, -D.y / v1.zoom, 0.05, 2);
    await guest.close();
  } finally {
    await owner.close();
  }
});

// ---------- CVS-03 ----------

test('CVS-03 wheel mode: "zooms" zooms on every wheel turn; "scrolls" pans and zooms only with Ctrl', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  const P = () => at(page, 0.5, 0.5);
  const wheel = async (dy: number, ctrl = false) => {
    const p = await P();
    await page.mouse.move(p.x, p.y);
    if (ctrl) await page.keyboard.down('Control');
    await page.mouse.wheel(0, dy);
    if (ctrl) await page.keyboard.up('Control');
    await waitIdle(page);
  };
  try {
    await expect(wheelSelect(page)).toBeVisible();
    // режим «каждое вращение»
    await wheelSelect(page).selectOption('zoom');
    const z0 = await viewOf(page, wire);
    await wheel(-300);
    const z1 = await viewOf(page, wire);
    expect(z1.zoom).toBeGreaterThan(z0.zoom * 1.1);

    // режим «с модификатором»: без клавиши масштаб не меняется, вид двигается
    await wheelSelect(page).selectOption('scroll');
    await wheel(300);
    const s1 = await viewOf(page, wire);
    close(s1.zoom, z1.zoom, 0.005);
    expect(Math.abs(s1.center.y - z1.center.y)).toBeGreaterThan(5);
    await wheel(-300, true);
    const s2 = await viewOf(page, wire);
    expect(s2.zoom).toBeGreaterThan(s1.zoom * 1.1);
    await wheel(300, true);
    const s3 = await viewOf(page, wire);
    expect(s3.zoom).toBeLessThan(s2.zoom / 1.1);

    // обратно — действует сразу, без перезагрузки
    await wheelSelect(page).selectOption('zoom');
    await wheel(-300);
    const z2 = await viewOf(page, wire);
    expect(z2.zoom).toBeGreaterThan(s3.zoom * 1.1);
  } finally {
    await owner.close();
  }
});

// ---------- CVS-04 ----------

function centerOf(b: { x: number; y: number; width: number; height: number }): Point {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function pressAt(page: import('@playwright/test').Page, isMobile: boolean, p: Point) {
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

type Box = { x: number; y: number; width: number; height: number };

/** Отображение «точка миникарты → точка мира» по двум объектам с известными координатами. */
async function minimapMapping(page: import('@playwright/test').Page, a: Box, b: Box) {
  const rects = (await page
    .locator('[data-testid="minimap"] rect.minimap-object')
    .evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) as Box[];
  expect(rects).toHaveLength(2);
  const [ra, rb] = (a.x < b.x ? [0, 1] : [1, 0]).map((i) => [...rects].sort((p, q) => p.x - q.x)[i]);
  const sx = (rb.x - ra.x) / (b.x - a.x);
  const sy = (rb.y - ra.y) / (b.y - a.y);
  return {
    unitsPerPx: 1 / sx,
    toWorld: (m: Point): Point => ({ x: a.x + (m.x - ra.x) / sx, y: a.y + (m.y - ra.y) / sy }),
    rects: { a: ra, b: rb },
  };
}

test('CVS-04 minimap shows the visible area; it follows pan and zoom; a click moves the view there', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire, boardId } = owner;
  try {
    await expect(minimap(page)).toBeVisible();
    await expect(minimap(page)).toHaveAccessibleName('Minimap');
    // Объекты не дальше ~2000 единиц: рамка вида на миникарте заметно больше её минимального размера
    // (12×9 px — исправление BUG-003, T5.2), и уменьшение рамки при приближении наблюдаемо.
    const A = { type: 'sticky', x: -800, y: -600, width: 400, height: 300 };
    const B = { type: 'sticky', x: 1200, y: 800, width: 400, height: 300 };
    await putObject(page, `board=${boardId}`, 'qa-a', A);
    await putObject(page, `board=${boardId}`, 'qa-b', B);
    await expect(page.locator('[data-testid="minimap"] rect.minimap-object')).toHaveCount(2);
    await expect(minimapView(page)).toBeVisible();
    const r0 = (await minimapView(page).boundingBox())!;
    // масштаб: рамка видимой области меньше
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await waitIdle(page);
    const r1 = (await minimapView(page).boundingBox())!;
    expect(r1.width).toBeLessThan(r0.width * 0.8);
    // сдвиг: рамка смещается
    if (isMobile) {
      const t = await Touch.of(page);
      const S = await at(page, 0.5, 0.5);
      await t.gesture([S], [{ x: S.x - 150, y: S.y }]);
    } else {
      await dragBy(page, await at(page, 0.6, 0.5), { x: -150, y: 0 });
    }
    await waitIdle(page);
    const r2 = (await minimapView(page).boundingBox())!;
    expect(centerOf(r2).x - centerOf(r1).x).toBeGreaterThan(1);

    // щелчок по пустой точке миникарты: центр вида — в этой точке мира
    let map = await minimapMapping(page, A, B);
    const M = { x: map.rects.a.x + (map.rects.b.x - map.rects.a.x) * 0.3, y: map.rects.a.y + (map.rects.b.y - map.rects.a.y) * 0.8 };
    const expected = map.toWorld(M);
    await pressAt(page, isMobile, M);
    await waitIdle(page);
    let v = await viewOf(page, wire);
    close(v.center.x, expected.x, 0, 3 * map.unitsPerPx);
    close(v.center.y, expected.y, 0, 3 * map.unitsPerPx);
    // рамка видимой области встала на точку щелчка
    const r3 = (await minimapView(page).boundingBox())!;
    map = await minimapMapping(page, A, B);
    const frameWorld = map.toWorld(centerOf(r3));
    close(frameWorld.x, v.center.x, 0, 3 * map.unitsPerPx);
    close(frameWorld.y, v.center.y, 0, 3 * map.unitsPerPx);

    // щелчок по объекту B на миникарте: вид — у объекта B
    await pressAt(page, isMobile, centerOf(map.rects.b));
    await waitIdle(page);
    v = await viewOf(page, wire);
    close(v.center.x, B.x + B.width / 2, 0, 3 * map.unitsPerPx);
    close(v.center.y, B.y + B.height / 2, 0, 3 * map.unitsPerPx);

    // щелчок у угла миникарты: вид конечен, холст работает
    const m = (await minimap(page).boundingBox())!;
    await pressAt(page, isMobile, { x: m.x + 2, y: m.y + m.height - 2 });
    await waitIdle(page);
    const v4 = await viewOf(page, wire);
    expect(Number.isFinite(v4.center.x) && Number.isFinite(v4.center.y) && Number.isFinite(v4.zoom)).toBe(true);
    await expect(canvas(page)).toBeVisible();
  } finally {
    await owner.close();
  }
});

// ---------- CVS-01 ----------

test('CVS-01 CVS-04 objects far from the origin are kept, shown on the minimap and reachable through it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire, boardId } = owner;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const far = { type: 'sticky', x: 5_000_000, y: -3_000_000, width: 200, height: 200 };
    const neg = { type: 'sticky', x: -1_000_000, y: 2_000_000, width: 300, height: 100 };
    await putObject(page, `board=${boardId}`, 'qa-far', far);
    await putObject(page, `board=${boardId}`, 'qa-neg', neg);
    await expect(page.locator('[data-testid="minimap"] rect.minimap-object')).toHaveCount(2);

    // переход к дальнему объекту по миникарте (точность — несколько пикселей миникарты)
    let map = await minimapMapping(page, neg, far);
    await pressAt(page, isMobile, centerOf(map.rects.b));
    await waitIdle(page);
    const v = await viewOf(page, wire);
    close(v.center.x, far.x + far.width / 2, 0, 3 * map.unitsPerPx);
    close(v.center.y, far.y + far.height / 2, 0, 3 * map.unitsPerPx);
    expect(v.center.x).toBeGreaterThan(4_000_000);
    // и дальше: вид двигается без упора в край
    if (isMobile) {
      const t = await Touch.of(page);
      const A = await at(page, 0.6, 0.5);
      await t.gesture([A], [{ x: A.x - 200, y: A.y + 100 }]);
    } else {
      await dragBy(page, await at(page, 0.6, 0.5), { x: -200, y: 100 });
    }
    const v2 = await viewOf(page, wire);
    close(v2.center.x - v.center.x, 200 / v.zoom, 0.05, 2);
    close(v2.center.y - v.center.y, -100 / v.zoom, 0.05, 2);

    // к объекту в отрицательных x
    map = await minimapMapping(page, neg, far);
    await pressAt(page, isMobile, centerOf(map.rects.a));
    await waitIdle(page);
    const v3 = await viewOf(page, wire);
    close(v3.center.x, neg.x + neg.width / 2, 0, 3 * map.unitsPerPx);
    close(v3.center.y, neg.y + neg.height / 2, 0, 3 * map.unitsPerPx);
    expect(v3.center.x).toBeLessThan(-500_000);
    // и оттуда вид двигается дальше в отрицательную сторону
    if (isMobile) {
      const t = await Touch.of(page);
      const A = await at(page, 0.3, 0.3);
      await t.gesture([A], [{ x: A.x + 150, y: A.y + 150 }]);
    } else {
      await dragBy(page, await at(page, 0.3, 0.3), { x: 150, y: 150 });
    }
    const v4 = await viewOf(page, wire);
    close(v4.center.x - v3.center.x, -150 / v3.zoom, 0.05, 2);
    close(v4.center.y - v3.center.y, -150 / v3.zoom, 0.05, 2);

    // документ сохранил объекты с координатами для нового клиента
    const seen = await objectsSeenByLateClient(page, `board=${boardId}`);
    expect(seen['qa-far']).toMatchObject(far);
    expect(seen['qa-neg']).toMatchObject(neg);
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

// ---------- CVS-05 ----------

async function moveSomewhere(page: import('@playwright/test').Page, isMobile: boolean) {
  await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
  await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
  if (isMobile) {
    const t = await Touch.of(page);
    const A = await at(page, 0.6, 0.6);
    await t.gesture([A], [{ x: A.x - 130, y: A.y - 90 }]);
  } else {
    await dragBy(page, await at(page, 0.6, 0.6), { x: -130, y: -90 });
  }
  await waitIdle(page);
}

function sameView(a: { center: Point; zoom: number }, b: { center: Point; zoom: number }) {
  close(a.zoom, b.zoom, 0.01);
  close(a.center.x, b.center.x, 0, 2);
  close(a.center.y, b.center.y, 0, 2);
}

test('CVS-05 last place and zoom are restored after reload; other boards and other browsers start fresh', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const opts = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  const { page, wire, boardId } = owner;
  try {
    const initial = await viewOf(page, wire);
    await moveSomewhere(page, isMobile);
    const moved = await viewOf(page, wire);
    expect(moved.zoom).toBeGreaterThan(initial.zoom * 1.2);
    expect(Math.abs(moved.center.x - initial.center.x)).toBeGreaterThan(20);

    // перезагрузка — тот же вид
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    sameView(await viewOf(page, wire), moved);
    const zoomText = await zoomLevel(page).textContent();
    expect(zoomText).not.toBe('100%');

    // другая доска того же пользователя — свой (начальный) вид, вид A не переносится
    const other = await owner.newBoard();
    await page.goto(`/boards/${other}`);
    await expect(canvas(page)).toBeVisible();
    sameView(await viewOf(page, wire), initial);
    await page.goto(`/boards/${boardId}`);
    await expect(canvas(page)).toBeVisible();
    sameView(await viewOf(page, wire), moved);

    // другой браузер (свой контекст, та же учётка) — начальный вид
    const ctx2 = await browser.newContext(opts);
    try {
      const p2 = await ctx2.newPage();
      const cookies = await page.context().cookies();
      await ctx2.addCookies(cookies);
      const w2 = watchWire(p2);
      await p2.goto(`/boards/${boardId}`);
      await expect(canvas(p2)).toBeVisible();
      sameView(await viewOf(p2, w2), initial);
    } finally {
      await ctx2.close();
    }
  } finally {
    await owner.close();
  }
});

test('CVS-05 SHR-04 participant by link gets the view restored after reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const opts = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Returning Guest');
    const initial = await viewOf(guest.page, guest.wire);
    await moveSomewhere(guest.page, isMobile);
    const moved = await viewOf(guest.page, guest.wire);
    await guest.page.reload();
    await expect(canvas(guest.page)).toBeVisible();
    sameView(await viewOf(guest.page, guest.wire), moved);
    // вид участника не влияет на вид владельца (другой браузер)
    sameView(await viewOf(owner.page, owner.wire), initial);
    await guest.close();
  } finally {
    await owner.close();
  }
});

test('CVS-05 damaged saved view does not break the board: it opens with the initial view', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire, boardId } = owner;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    const initial = await viewOf(page, wire);
    await moveSomewhere(page, isMobile);
    // ключ хранилища — из ARCHITECTURE.md (по id доски) и handoff
    const keys = await page.evaluate(() => Object.keys(localStorage));
    const key = keys.find((k) => k.includes(boardId));
    expect(key, `ключ с id доски среди ${keys.join(', ')}`).toBeTruthy();
    for (const bad of ['{not json', '{"x":"a","y":null,"zoom":-5}', '{"x":1e400,"y":0,"zoom":0}', 'null']) {
      await page.evaluate(({ k, v }) => localStorage.setItem(k, v), { k: key!, v: bad });
      await page.reload();
      await expect(canvas(page)).toBeVisible();
      const v = await viewOf(page, wire);
      expect(Number.isFinite(v.zoom) && v.zoom > 0, `масштаб при «${bad}»`).toBe(true);
      expect(Number.isFinite(v.center.x) && Number.isFinite(v.center.y), `центр при «${bad}»`).toBe(true);
      sameView(v, initial);
    }
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

// ---------- архитектура ----------

test('ARCH-T51-01 ARCH-T51-02 camera is a CSS transform of the board layer and never goes into the document', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire, boardId } = owner;
  const layerTransform = () =>
    canvas(page).evaluate((el) => getComputedStyle(el.firstElementChild as Element).transform);
  try {
    await viewOf(page, wire);
    const before = await layerTransform();
    const syncBefore = wire.syncSent;
    await moveSomewhere(page, isMobile);
    await viewBar(page).getByRole('button', { name: 'Zoom out' }).click();
    await waitIdle(page);
    const after = await layerTransform();
    expect(after).not.toBe(before);
    expect(after).toMatch(/^matrix/);
    // ни одного обновления документа от движения камеры
    await page.waitForTimeout(500);
    expect(wire.syncSent).toBe(syncBefore);
    const objs = await objectsSeenByLateClient(page, `board=${boardId}`);
    expect(Object.keys(objs)).toEqual([]);
    // сдвиг и масштаб — в localStorage по id доски
    const stored = await page.evaluate((id) => Object.entries(localStorage).filter(([k]) => k.includes(id)), boardId);
    expect(stored.length).toBe(1);
  } finally {
    await owner.close();
  }
});

// ---------- MOB-02 ----------

async function pageIsStill(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({ sx: window.scrollX, sy: window.scrollY, scale: window.visualViewport?.scale ?? 1 }));
}

test('MOB-02 one finger pans the canvas by the gesture distance and keeps the zoom; a tap does not move it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    const t = await Touch.of(page);
    const still = await pageIsStill(page);
    const box0 = (await canvas(page).boundingBox())!;
    const v0 = await viewOf(page, wire);
    const A = await at(page, 0.5, 0.6);
    const D = { x: 90, y: -110 };
    await t.gesture([A], [{ x: A.x + D.x, y: A.y + D.y }]);
    await waitIdle(page);
    const v1 = await viewOf(page, wire);
    close(v1.center.x - v0.center.x, -D.x / v0.zoom, 0.05, 2);
    close(v1.center.y - v0.center.y, -D.y / v0.zoom, 0.05, 2);
    close(v1.zoom, v0.zoom, 0.01);
    // страница не прокрутилась и не масштабировалась, холст на месте
    expect(await pageIsStill(page)).toEqual(still);
    const box1 = (await canvas(page).boundingBox())!;
    close(box1.y, box0.y, 0, 1);
    // касание без движения вид не двигает
    await t.tap(await at(page, 0.4, 0.4));
    await waitIdle(page);
    sameView(await viewOf(page, wire), v1);
  } finally {
    await owner.close();
  }
});

test('MOB-02 two-finger pinch zooms in when spread and out when pinched; one finger pans again after it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire } = owner;
  try {
    const t = await Touch.of(page);
    const still = await pageIsStill(page);
    const v0 = await viewOf(page, wire);
    const C = await at(page, 0.5, 0.5);
    // раздвигаем: 80 → 200 px
    await t.gesture([{ x: C.x - 40, y: C.y }, { x: C.x + 40, y: C.y }], [{ x: C.x - 100, y: C.y }, { x: C.x + 100, y: C.y }]);
    await waitIdle(page);
    const v1 = await viewOf(page, wire);
    close(v1.zoom / v0.zoom, 2.5, 0.1);
    // сводим: 200 → 50 px
    await t.gesture([{ x: C.x - 100, y: C.y }, { x: C.x + 100, y: C.y }], [{ x: C.x - 25, y: C.y }, { x: C.x + 25, y: C.y }]);
    await waitIdle(page);
    const v2 = await viewOf(page, wire);
    close(v2.zoom / v1.zoom, 0.25, 0.1);
    expect(await pageIsStill(page)).toEqual(still);
    // после щипка один палец снова двигает вид
    const A = await at(page, 0.5, 0.5);
    await t.gesture([A], [{ x: A.x - 60, y: A.y + 40 }]);
    await waitIdle(page);
    const v3 = await viewOf(page, wire);
    close(v3.center.x - v2.center.x, 60 / v2.zoom, 0.05, 2);
    close(v3.center.y - v2.center.y, -40 / v2.zoom, 0.05, 2);
    close(v3.zoom, v2.zoom, 0.01);
  } finally {
    await owner.close();
  }
});

test('MOB-02 SHR-04 participant by link pans with one finger and zooms with a pinch', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const opts = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Phone Guest');
    const { page, wire } = guest;
    const t = await Touch.of(page);
    const v0 = await viewOf(page, wire);
    const C = await at(page, 0.5, 0.5);
    await t.gesture([{ x: C.x, y: C.y - 50 }, { x: C.x, y: C.y + 50 }], [{ x: C.x, y: C.y - 100 }, { x: C.x, y: C.y + 100 }]);
    await waitIdle(page);
    const v1 = await viewOf(page, wire);
    close(v1.zoom / v0.zoom, 2, 0.1);
    await t.gesture([C], [{ x: C.x + 70, y: C.y }]);
    await waitIdle(page);
    const v2 = await viewOf(page, wire);
    close(v2.center.x - v1.center.x, -70 / v1.zoom, 0.05, 2);
    await guest.close();
  } finally {
    await owner.close();
  }
});

// ---------- COL-04 на жестах телефона ----------

test('COL-04 MOB-02 follower repeats one-finger pan and pinch of a leader on a phone; own finger stops following', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const opts = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, opts);
  try {
    const guest = await openGuest(browser, opts, owner.token, 'Phone Follower');
    await expect(guest.page.getByText('On this board (2)')).toBeVisible();
    await guest.page.getByRole('button', { name: `Follow ${owner.name}` }).tap();
    await expect(guest.page.getByText(`Following ${owner.name}`)).toBeVisible();

    const lt = await Touch.of(owner.page);
    const C = await at(owner.page, 0.5, 0.5);
    // ведущий: один палец, затем щипок
    await lt.gesture([C], [{ x: C.x + 120, y: C.y - 80 }]);
    await lt.gesture([{ x: C.x - 40, y: C.y }, { x: C.x + 40, y: C.y }], [{ x: C.x - 90, y: C.y }, { x: C.x + 90, y: C.y }]);
    await waitIdle(owner.page);
    const lead = await viewOf(owner.page, owner.wire);
    expect(lead.zoom).toBeGreaterThan(1.5);
    await expect(async () => sameView(await viewOf(guest.page, guest.wire), lead)).toPass({ timeout: 5000 });
    await expect(guest.page.getByText(`Following ${owner.name}`)).toBeVisible();

    // наблюдатель двигает вид пальцем — слежение выключается
    const ft = await Touch.of(guest.page);
    const G = await at(guest.page, 0.5, 0.5);
    await ft.gesture([G], [{ x: G.x - 50, y: G.y }]);
    await expect(guest.page.getByText(`Following ${owner.name}`)).toBeHidden();
    const mine = await viewOf(guest.page, guest.wire);
    // дальнейшие жесты ведущего вид наблюдателя не двигают
    await lt.gesture([{ x: C.x - 90, y: C.y }, { x: C.x + 90, y: C.y }], [{ x: C.x - 30, y: C.y }, { x: C.x + 30, y: C.y }]);
    await lt.gesture([C], [{ x: C.x - 100, y: C.y + 100 }]);
    await guest.page.waitForTimeout(800);
    sameView(await viewOf(guest.page, guest.wire), mine);

    // снова следим — вид догоняет ведущего; кнопка «Stop following» выключает
    await guest.page.getByRole('button', { name: `Follow ${owner.name}` }).tap();
    const lead2 = await viewOf(owner.page, owner.wire);
    await expect(async () => sameView(await viewOf(guest.page, guest.wire), lead2)).toPass({ timeout: 5000 });
    await guest.page.getByRole('button', { name: 'Stop following' }).tap();
    const stopped = await viewOf(guest.page, guest.wire);
    await lt.gesture([C], [{ x: C.x + 80, y: C.y + 80 }]);
    await guest.page.waitForTimeout(800);
    sameView(await viewOf(guest.page, guest.wire), stopped);
    await guest.close();
  } finally {
    await owner.close();
  }
});
