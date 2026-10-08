// Приёмка T5.2 · сцена, создание и выделение: CVS-06, CVS-09…14, CVS-21, CVS-23, MOB-03, BUG-003.
// Сценарии — docs/qa/reports/T5.2.md. Подписи интерфейса — из handoff T5.2.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, close, minimapView, openGuest, openOwner, profileOpts, viewBar, waitIdle, type Point } from './camera';
import {
  allObjects, boardMenu, boxOf, type Box, cameraBy, centerOf, docState, Finger, handle, mousePath, obj, objectIds, objectMenu,
  onCanvas, seed, selected, selectedIds, selectionBar, tool, tools, untilDoc, writeDoc, type Obj,
} from './scene';

const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'жесты пальцами — профиль mobile');

type P = Parameters<typeof profileOpts>[0];
const opts = (p: P) => profileOpts(p);

const DARK = 'rgb(38, 50, 56)';
const MINT = 'rgb(232, 245, 233)';

async function pressAt(page: Page, isMobile: boolean, p: Point) {
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
}

/** Щелчок по пустому месту холста (снимает выделение, закрывает редактор). */
async function clickEmpty(page: Page, p: Point) {
  await page.mouse.click(p.x, p.y);
}

/** Закрыть редактор текста, который открывается у нового объекта. */
async function closeEditor(page: Page) {
  const editor = page.getByLabel('Object text');
  if (await editor.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
}

/** Ширина фона-сетки на экране, px. */
async function gridPx(page: Page): Promise<number> {
  const size = await canvas(page).evaluate((e) => getComputedStyle(e).backgroundSize);
  return parseFloat(size);
}

// ---------- CVS-06 ----------

test('CVS-06 background and grid step change at once, reach the second client and survive a reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 40, y: 40, width: 120, height: 120 };
    await seed(page, boardId, { 'qa-a': A });
    const before = (await docState(page, boardId)).objects;

    await page.getByLabel('Background').selectOption({ label: 'Dark' });
    await expect(canvas(page)).toHaveCSS('background-color', DARK);
    await expect(canvas(guest.page)).toHaveCSS('background-color', DARK);

    await page.getByLabel('Grid').selectOption({ label: '40 px' });
    await expect(canvas(page)).toHaveAttribute('data-grid-step', '40');
    await expect(canvas(guest.page)).toHaveAttribute('data-grid-step', '40');
    const g1 = await gridPx(page);
    close(g1, 40, 0.05, 1);

    // шаг на экране масштабируется вместе с камерой
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await waitIdle(page);
    const zoom = (await boxOf(obj(page, 'qa-a'))).width / A.width;
    expect(zoom).toBeGreaterThan(1.1);
    close(await gridPx(page), 40 * zoom, 0.05, 1);

    // свойство доски: переживает перезагрузку и видно новому клиенту
    await page.reload();
    await expect(canvas(page)).toHaveCSS('background-color', DARK);
    await expect(canvas(page)).toHaveAttribute('data-grid-step', '40');
    await expect(page.getByLabel('Background')).toHaveValue('#263238');

    // смена фона не меняет объекты
    expect((await docState(page, boardId)).objects).toEqual(before);

    // наблюдение: может ли участник менять фон (SHR-04 фон не перечисляет)
    await guest.page.getByLabel('Background').selectOption({ label: 'Mint' }).catch(() => undefined);
    const ownerBg = await canvas(page).evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.waitForTimeout(1000);
    test.info().annotations.push({
      type: 'наблюдение',
      description: `участник выбрал Mint; у владельца фон ${await canvas(page).evaluate((e) => getComputedStyle(e).backgroundColor)} (было ${ownerBg})`,
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-06 grid Off hides the grid; damaged settings written by another client do not break the canvas', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.getByLabel('Grid').selectOption({ label: 'Off' });
    await expect(canvas(page)).toHaveAttribute('data-grid-step', '0');
    const img = await canvas(page).evaluate((e) => getComputedStyle(e).backgroundImage);
    expect(img === 'none' || !img.includes('gradient'), `фон-сетка при Off: ${img}`).toBe(true);

    for (const bad of [-5, 0.0001, 'abc', 1e9, null]) {
      await writeDoc(page, boardId, (doc) => {
        const s = doc.getMap('settings');
        s.set('gridStep', bad);
        s.set('background', 'url(javascript:alert(1))');
      });
      await page.waitForTimeout(400);
      await expect(canvas(page)).toBeVisible();
      const step = Number(await canvas(page).getAttribute('data-grid-step'));
      expect(Number.isFinite(step) && step >= 0, `data-grid-step=${step} при ${bad}`).toBe(true);
      const size = await gridPx(page).catch(() => 0);
      expect(Number.isFinite(size) || size === 0).toBe(true);
    }
    // после мусора нормальный выбор снова работает
    await page.getByLabel('Grid').selectOption({ label: '10 px' });
    await expect(canvas(page)).toHaveAttribute('data-grid-step', '10');
    await page.getByLabel('Background').selectOption({ label: 'Mint' });
    await expect(canvas(page)).toHaveCSS('background-color', MINT);
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

// ---------- CVS-09 ----------

test('CVS-09 ARCH-T52-01 a tool from the panel and a click create an object at that point; second client sees it; new one is on top', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, boardId, { 'qa-ref': REF });
    const made: string[] = [];
    const cases: Array<[string, string, number, number]> = [
      ['Sticky note', 'sticky', 0.3, 0.3],
      ['Shape', 'shape', 0.6, 0.3],
      ['Text', 'text', 0.4, 0.55],
    ];
    for (const [name, type, fx, fy] of cases) {
      await tool(page, name).click();
      await expect(tool(page, name)).toHaveAttribute('aria-pressed', 'true');
      const before = await objectIds(page);
      const P = await onCanvas(page, fx, fy);
      const cam = await cameraBy(page, 'qa-ref', REF);
      await pressAt(page, isMobile, P);
      await expect(allObjects(page)).toHaveCount(before.length + 1);
      const id = (await objectIds(page)).find((x) => !before.includes(x))!;
      made.push(id);
      await closeEditor(page);
      // объект в точке щелчка (центр, угол может прилипнуть к сетке 20)
      const w = cam.toWorld(P);
      const d = await untilDoc(page, boardId, (s) => s.objects[id], (v) => expect(v).toBeTruthy());
      expect(d.type).toBe(type);
      for (const k of ['x', 'y', 'width', 'height'] as const) expect(Number.isFinite(d[k])).toBe(true);
      expect(Number.isInteger(d.z)).toBe(true);
      close(d.x + d.width / 2, w.x, 0, 20);
      close(d.y + d.height / 2, w.y, 0, 20);
      // второй клиент видит объект
      await expect(obj(guest.page, id)).toBeVisible();
      await expect(obj(guest.page, id)).toHaveAttribute('data-type', type);
    }
    // новый — поверх прежних
    const s = await docState(page, boardId);
    const zs = made.map((id) => s.objects[id].z as number);
    expect(zs[1]).toBeGreaterThan(zs[0]);
    expect(zs[2]).toBeGreaterThan(zs[1]);

    // ARCH-T52-02: объект — DOM-элемент внутри слоя с CSS-преобразованием камеры
    const layer = canvas(page).locator(':scope > *').first();
    expect(await layer.locator(`[data-object-id="${made[0]}"]`).count()).toBe(1);
    const t0 = await layer.evaluate((e) => getComputedStyle(e).transform);
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(() => layer.evaluate((e) => getComputedStyle(e).transform)).not.toBe(t0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-09 creation by a tool keeps the click point when zoomed and panned', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, boardId, { 'qa-ref': REF });
    for (let i = 0; i < 3; i++) await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await mousePath(page, [await onCanvas(page, 0.6, 0.6), await onCanvas(page, 0.35, 0.4)]);
    await waitIdle(page);
    const cam = await cameraBy(page, 'qa-ref', REF);
    expect(cam.zoom).toBeGreaterThan(1.3);
    await tool(page, 'Shape').click();
    const P = await onCanvas(page, 0.3, 0.3);
    await page.mouse.click(P.x, P.y);
    await expect(allObjects(page)).toHaveCount(2);
    const id = (await objectIds(page)).find((x) => x !== 'qa-ref')!;
    await closeEditor(page);
    const d = await untilDoc(page, boardId, (s) => s.objects[id], (v) => expect(v).toBeTruthy());
    const w = cam.toWorld(P);
    close(d.x + d.width / 2, w.x, 0, 20);
    close(d.y + d.height / 2, w.y, 0, 20);
    // и при отдалении
    for (let i = 0; i < 6; i++) await viewBar(page).getByRole('button', { name: 'Zoom out' }).click();
    await waitIdle(page);
    const cam2 = await cameraBy(page, 'qa-ref', REF);
    expect(cam2.zoom).toBeLessThan(0.9);
    await tool(page, 'Sticky note').click();
    const Q = await onCanvas(page, 0.7, 0.6);
    await page.mouse.click(Q.x, Q.y);
    await expect(allObjects(page)).toHaveCount(3);
    const id2 = (await objectIds(page)).find((x) => x !== 'qa-ref' && x !== id)!;
    await closeEditor(page);
    const d2 = await untilDoc(page, boardId, (s) => s.objects[id2], (v) => expect(v).toBeTruthy());
    const w2 = cam2.toWorld(Q);
    close(d2.x + d2.width / 2, w2.x, 0, 20);
    close(d2.y + d2.height / 2, w2.y, 0, 20);
  } finally {
    await owner.close();
  }
});

async function dragToolTo(page: Page, name: string, to: Point) {
  const b = await boxOf(tool(page, name));
  const from = centerOf(b);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 15, from.y + 5, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

test('CVS-09 dragging a tool button onto the canvas creates the object at the drop point; dropping outside creates nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, boardId, { 'qa-ref': REF });
    const cam = await cameraBy(page, 'qa-ref', REF);
    const P = await onCanvas(page, 0.6, 0.55);
    await dragToolTo(page, 'Shape', P);
    await expect(allObjects(page)).toHaveCount(2);
    const id = (await objectIds(page)).find((x) => x !== 'qa-ref')!;
    await closeEditor(page);
    const d = await untilDoc(page, boardId, (s) => s.objects[id], (v) => expect(v).toBeTruthy());
    expect(d.type).toBe('shape');
    const w = cam.toWorld(P);
    close(d.x + d.width / 2, w.x, 0, 20);
    close(d.y + d.height / 2, w.y, 0, 20);
    await expect(obj(guest.page, id)).toBeVisible();

    // отпущено вне холста (на панели инструментов) — объекта нет
    const back = centerOf(await boxOf(tool(page, 'Text')));
    await dragToolTo(page, 'Sticky note', back);
    await page.waitForTimeout(800);
    await expect(allObjects(page)).toHaveCount(2);
    expect(Object.keys((await docState(page, boardId)).objects)).toHaveLength(2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

/** Положить текст в системный буфер обмена: страница по http (LAN) — не безопасный контекст, поэтому копированием выделения. */
async function setClipboard(page: Page, text: string) {
  await page.evaluate((t) => {
    const ta = document.createElement('textarea');
    ta.value = t || ' ';
    document.body.appendChild(ta);
    ta.select();
    if (!t) ta.setSelectionRange(0, 0);
    const onCopy = (e: ClipboardEvent) => {
      e.clipboardData?.setData('text/plain', t);
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy, { once: true });
    document.execCommand('copy');
    ta.remove();
  }, text);
}

test('CVS-09 Ctrl/Cmd+V pastes clipboard text as an object; paste in a text field or an empty clipboard creates nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, boardId, { 'qa-ref': REF });
    await setClipboard(page, 'QA pasted text');
    const P = await onCanvas(page, 0.5, 0.5);
    await clickEmpty(page, P);
    await page.mouse.move(P.x + 3, P.y + 3);
    await page.keyboard.press('ControlOrMeta+V');
    await expect(allObjects(page)).toHaveCount(2);
    const id = (await objectIds(page)).find((x) => x !== 'qa-ref')!;
    await closeEditor(page);
    const d = await untilDoc(page, boardId, (s) => s.objects[id], (v) => expect(v?.text).toBe('QA pasted text'));
    // в видимой области
    const cv = await boxOf(canvas(page));
    const ob = await boxOf(obj(page, id));
    expect(ob.x + ob.width > cv.x && ob.x < cv.x + cv.width && ob.y + ob.height > cv.y && ob.y < cv.y + cv.height).toBe(true);
    expect(Number.isInteger(d.z)).toBe(true);
    await expect(obj(guest.page, id)).toContainText('QA pasted text');

    // вставка в поле ввода текста объекта — новый объект не появляется
    await obj(page, id).click();
    await selectionBar(page).getByRole('button', { name: 'Edit text' }).click();
    const editor = page.getByLabel('Object text');
    await expect(editor).toBeFocused();
    await page.keyboard.press('ControlOrMeta+V');
    await page.waitForTimeout(600);
    await expect(allObjects(page)).toHaveCount(2);
    await page.keyboard.press('Escape');

    // пустой буфер — ничего
    await setClipboard(page, '');
    await clickEmpty(page, await onCanvas(page, 0.4, 0.9));
    await page.keyboard.press('ControlOrMeta+V');
    await page.waitForTimeout(600);
    await expect(allObjects(page)).toHaveCount(2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-09 SHR-04 participant by link creates objects with a tool, by dragging and by pasting', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const page = guest.page;
  try {
    await tool(page, 'Sticky note').click();
    await page.mouse.click(...(Object.values(await onCanvas(page, 0.3, 0.3)) as [number, number]));
    await expect(allObjects(page)).toHaveCount(1);
    await closeEditor(page);
    await dragToolTo(page, 'Shape', await onCanvas(page, 0.6, 0.6));
    await expect(allObjects(page)).toHaveCount(2);
    await closeEditor(page);
    await setClipboard(page, 'guest paste');
    const P = await onCanvas(page, 0.5, 0.8);
    await clickEmpty(page, P);
    await page.keyboard.press('ControlOrMeta+V');
    await expect(allObjects(page)).toHaveCount(3);
    await closeEditor(page);
    // владелец видит все три
    await expect(allObjects(owner.page)).toHaveCount(3);
    const s = await untilDoc(owner.page, owner.boardId, (d) => Object.values(d.objects), (v) => expect(v).toHaveLength(3));
    expect(s.map((x) => x.type).sort()).toEqual(['shape', 'sticky', 'text']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-10 ----------

const GRID4: Record<string, Obj> = {
  'qa-a': { type: 'sticky', x: 40, y: 40, width: 80, height: 80 },
  'qa-b': { type: 'sticky', x: 180, y: 40, width: 80, height: 80 },
  'qa-c': { type: 'shape', x: 40, y: 200, width: 80, height: 80 },
  'qa-d': { type: 'shape', x: 300, y: 260, width: 80, height: 80 },
};

test('CVS-10 a click selects one object, another click moves the selection, a click on empty space clears it; selection is not written to the document', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire, boardId } = owner;
  try {
    await seed(page, boardId, GRID4);
    const before = (await docState(page, boardId)).objects;
    const sent0 = wire.syncSent;
    await obj(page, 'qa-a').click();
    expect(await selectedIds(page)).toEqual(['qa-a']);
    await expect(page.getByTestId('selection-frame')).toBeVisible();
    await obj(page, 'qa-c').click();
    expect(await selectedIds(page)).toEqual(['qa-c']);
    const cam = await cameraBy(page, 'qa-a', GRID4['qa-a']);
    const empty = cam.toScreen({ x: 220, y: 180 });
    await clickEmpty(page, empty);
    await expect(selected(page)).toHaveCount(0);
    await expect(page.getByTestId('selection-frame')).toHaveCount(0);
    await page.waitForTimeout(500);
    test.info().annotations.push({ type: 'наблюдение', description: `кадров sync от выделения: ${wire.syncSent - sent0}` });
    expect((await docState(page, boardId)).objects, 'выделение не меняет документ').toEqual(before);
    expect(wire.syncSent, 'выделение не пишет в документ').toBe(sent0);
  } finally {
    await owner.close();
  }
});

async function marquee(page: Page, from: Point, to: Point) {
  await page.keyboard.down('Shift');
  await mousePath(page, [from, { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, to], { steps: 6 });
  await page.keyboard.up('Shift');
}

test('CVS-10 a marquee selects objects inside it and leaves objects outside', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, wire, boardId } = owner;
  try {
    await seed(page, boardId, GRID4);
    const cam = await cameraBy(page, 'qa-a', GRID4['qa-a']);
    const sent0 = wire.syncSent;
    // рамка вокруг a, b, c; d снаружи
    await marquee(page, cam.toScreen({ x: 20, y: 20 }), cam.toScreen({ x: 280, y: 300 }));
    expect(await selectedIds(page)).toEqual(['qa-a', 'qa-b', 'qa-c']);
    await expect(page.getByTestId('selection-marquee')).toHaveCount(0);
    // вид не сдвинулся
    const cam2 = await cameraBy(page, 'qa-a', GRID4['qa-a']);
    close(cam2.refScreen.x, cam.refScreen.x, 0, 1);
    // граничный: частичное пересечение (d наполовину в рамке) — наблюдение
    await clickEmpty(page, cam.toScreen({ x: 500, y: 100 }));
    await marquee(page, cam.toScreen({ x: 160, y: 160 }), cam.toScreen({ x: 340, y: 360 }));
    test.info().annotations.push({ type: 'наблюдение', description: `рамка, задевшая d наполовину: выделено ${JSON.stringify(await selectedIds(page))}` });
    expect(await selectedIds(page)).not.toContain('qa-a');
    await page.waitForTimeout(400);
    expect(wire.syncSent).toBe(sent0);
  } finally {
    await owner.close();
  }
});

test('CVS-10 a lasso selects objects inside a free-form outline and not those only inside its bounding box', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, GRID4);
    const cam = await cameraBy(page, 'qa-a', GRID4['qa-a']);
    await tool(page, 'Lasso').click();
    await expect(tool(page, 'Lasso')).toHaveAttribute('aria-pressed', 'true');
    // L-образный контур: внутри a (40..120 × 40..120) и c (40..120 × 200..280); b (180..260 × 40..120) —
    // внутри описанного прямоугольника (10..290 × 10..350), но вне контура; d (300..380 × 260..340) — вне
    const pts = [
      { x: 10, y: 10 }, { x: 140, y: 10 }, { x: 140, y: 190 }, { x: 290, y: 190 }, { x: 290, y: 350 },
      { x: 150, y: 350 }, { x: 10, y: 350 }, { x: 10, y: 180 }, { x: 12, y: 12 },
    ].map((w) => cam.toScreen(w));
    await mousePath(page, pts, { steps: 6 });
    expect(await selectedIds(page)).toEqual(['qa-a', 'qa-c']);
  } finally {
    await owner.close();
  }
});

test('CVS-10 SHR-04 participant by link selects by a click, a marquee and a lasso', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, GRID4);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const page = guest.page;
  try {
    await expect(obj(page, 'qa-d')).toBeVisible();
    await obj(page, 'qa-b').click();
    expect(await selectedIds(page)).toEqual(['qa-b']);
    const cam = await cameraBy(page, 'qa-a', GRID4['qa-a']);
    await clickEmpty(page, cam.toScreen({ x: 220, y: 180 }));
    await marquee(page, cam.toScreen({ x: 20, y: 20 }), cam.toScreen({ x: 280, y: 140 }));
    expect(await selectedIds(page)).toEqual(['qa-a', 'qa-b']);
    await clickEmpty(page, cam.toScreen({ x: 220, y: 180 }));
    await tool(page, 'Lasso').click();
    await mousePath(page, [{ x: 280, y: 240 }, { x: 400, y: 240 }, { x: 400, y: 360 }, { x: 280, y: 360 }, { x: 282, y: 242 }].map((w) => cam.toScreen(w)));
    expect(await selectedIds(page)).toEqual(['qa-d']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-11 ----------

const MIXED: Record<string, Obj> = {
  'qa-s1': { type: 'sticky', x: 40, y: 40, width: 80, height: 80, fill: '#fff176' },
  'qa-s2': { type: 'sticky', x: 160, y: 40, width: 80, height: 80, fill: '#ffb74d' },
  'qa-s3': { type: 'sticky', x: 280, y: 40, width: 80, height: 80, fill: '#fff176' },
  'qa-r1': { type: 'shape', x: 40, y: 180, width: 120, height: 80, fill: '#ffffff' },
  'qa-r2': { type: 'shape', x: 200, y: 180, width: 120, height: 80, fill: '#ffffff' },
  'qa-out': { type: 'sticky', x: 420, y: 140, width: 80, height: 80, fill: '#fff176' },
};

async function filterAndFill(page: Page, docPage: Page, boardId: string) {
  const cam = await cameraBy(page, 'qa-s1', MIXED['qa-s1']);
  await marquee(page, cam.toScreen({ x: 20, y: 20 }), cam.toScreen({ x: 380, y: 280 }));
  expect(await selectedIds(page)).toEqual(['qa-r1', 'qa-r2', 'qa-s1', 'qa-s2', 'qa-s3']);
  await expect(selectionBar(page)).toContainText('5 selected');
  await selectionBar(page).getByRole('button', { name: /^Only sticky notes/ }).click();
  expect(await selectedIds(page)).toEqual(['qa-s1', 'qa-s2', 'qa-s3']);
  await expect(selectionBar(page)).toContainText('3 selected');
  await selectionBar(page).getByLabel('Fill').selectOption({ label: 'Blue' });
  const objs = await untilDoc(docPage, boardId, (d) => d.objects, (v) => {
    for (const id of ['qa-s1', 'qa-s2', 'qa-s3']) expect(v[id].fill, id).toBe('#81d4fa');
  });
  expect(objs['qa-r1'].fill).toBe('#ffffff');
  expect(objs['qa-r2'].fill).toBe('#ffffff');
  expect(objs['qa-out'].fill).toBe('#fff176');
}

test('CVS-11 a mixed selection is narrowed to sticky notes only and their fill changes at once; shapes keep theirs; second client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId, wire } = owner;
  try {
    await seed(page, boardId, MIXED);
    await expect(selectionBar(page).getByRole('button', { name: /^Only/ })).toHaveCount(0);
    const sent0 = wire.syncSent;
    await filterAndFill(page, page, boardId);
    test.info().annotations.push({ type: 'наблюдение', description: `кадров sync на массовое изменение: ${wire.syncSent - sent0}` });
    // второй клиент видит цвет у всех трёх
    for (const id of ['qa-s1', 'qa-s2', 'qa-s3']) {
      await expect.poll(() => obj(guest.page, id).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(129, 212, 250)');
    }
    // однотипное выделение тоже меняется разом (без фильтра)
    await obj(page, 'qa-r1').click();
    await page.keyboard.down('Shift');
    await obj(page, 'qa-r2').click();
    await page.keyboard.up('Shift');
    expect(await selectedIds(page)).toEqual(['qa-r1', 'qa-r2']);
    await selectionBar(page).getByLabel('Fill').selectOption({ label: 'Green' });
    await untilDoc(page, boardId, (d) => d.objects, (v) => {
      expect(v['qa-r1'].fill).toBe('#a5d6a7');
      expect(v['qa-r2'].fill).toBe('#a5d6a7');
      expect(v['qa-s1'].fill).toBe('#81d4fa');
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-11 SHR-04 participant by link narrows a mixed selection and changes it at once', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, MIXED);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  try {
    await expect(obj(guest.page, 'qa-out')).toBeVisible();
    await filterAndFill(guest.page, owner.page, owner.boardId);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-12 ----------

async function dragObject(page: Page, from: Point, d: Point, mods: { shift?: boolean; alt?: boolean } = {}) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(d.x) * 6, from.y + Math.sign(d.y) * 4, { steps: 2 });
  if (mods.shift) await page.keyboard.down('Shift');
  if (mods.alt) await page.keyboard.down('Alt');
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 5 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 5 });
  await page.mouse.up();
  if (mods.alt) await page.keyboard.up('Alt');
  if (mods.shift) await page.keyboard.up('Shift');
}

test('CVS-12 dragging moves the object by the gesture (zoomed), several selected move together; second and late clients see it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 100, y: 100, width: 100, height: 100 };
    const B: Obj = { type: 'shape', x: 260, y: 140, width: 120, height: 60 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B });
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await viewBar(page).getByRole('button', { name: 'Zoom in' }).click();
    await waitIdle(page);
    const zoom = (await boxOf(obj(page, 'qa-a'))).width / A.width;
    expect(zoom).toBeGreaterThan(1.1);
    const gBox0 = await boxOf(obj(guest.page, 'qa-a'));
    const gZoom = gBox0.width / A.width;

    const D = { x: 130, y: 70 };
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-a'))), D);
    const a1 = await untilDoc(page, boardId, (d) => d.objects['qa-a'], (v) => expect(v.x).not.toBe(A.x));
    close(a1.x - A.x, D.x / zoom, 0, 21);
    close(a1.y - A.y, D.y / zoom, 0, 21);
    await expect.poll(async () => (await boxOf(obj(guest.page, 'qa-a'))).x - gBox0.x).toBeCloseTo((a1.x - A.x) * gZoom, 0);

    // несколько выделенных — вместе, взаимное положение сохраняется
    await page.keyboard.down('Shift');
    await obj(page, 'qa-b').click();
    await page.keyboard.up('Shift');
    expect(await selectedIds(page)).toEqual(['qa-a', 'qa-b']);
    const s0 = (await docState(page, boardId)).objects;
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-b'))), { x: -90, y: 110 });
    const s1 = await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v['qa-b'].y).not.toBe(s0['qa-b'].y));
    close(s1['qa-b'].x - s0['qa-b'].x, -90 / zoom, 0, 21);
    close(s1['qa-b'].y - s0['qa-b'].y, 110 / zoom, 0, 21);
    close(s1['qa-b'].x - s1['qa-a'].x, s0['qa-b'].x - s0['qa-a'].x, 0, 0.01);
    close(s1['qa-b'].y - s1['qa-a'].y, s0['qa-b'].y - s0['qa-a'].y, 0, 0.01);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-12 Shift keeps the move on one axis, also for a near-diagonal gesture', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 100, y: 200, width: 100, height: 100 };
    const OFF: Obj = { type: 'shape', x: 103, y: 327, width: 100, height: 60 };
    await seed(page, boardId, { 'qa-a': A, 'qa-off': OFF });
    // в основном по горизонтали
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-a'))), { x: 150, y: 35 }, { shift: true });
    let a = await untilDoc(page, boardId, (d) => d.objects['qa-a'], (v) => expect(v.x).not.toBe(A.x));
    expect(a.y).toBe(A.y);
    close(a.x - A.x, 150, 0, 21);
    // почти по диагонали, вертикаль чуть больше
    const x1 = a.x;
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-a'))), { x: 90, y: -100 }, { shift: true });
    a = await untilDoc(page, boardId, (d) => d.objects['qa-a'], (v) => expect(v.y).not.toBe(A.y));
    expect(a.x).toBe(x1);
    close(a.y - A.y, -100, 0, 21);
    // наблюдение: объект не на сетке, Shift по горизонтали — меняется ли y из-за прилипания
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-off'))), { x: 120, y: 10 }, { shift: true });
    const off = await untilDoc(page, boardId, (d) => d.objects['qa-off'], (v) => expect(v.x).not.toBe(OFF.x));
    test.info().annotations.push({ type: 'наблюдение', description: `Shift вне сетки: y ${OFF.y} → ${off.y}, x ${OFF.x} → ${off.x}` });
  } finally {
    await owner.close();
  }
});

test('CVS-12 without the modifier the position snaps; with Alt it follows the gesture exactly; Shift and Alt together', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const A: Obj = { type: 'sticky', x: 103, y: 207, width: 100, height: 100 };
    const B: Obj = { type: 'sticky', x: 303, y: 207, width: 100, height: 100 };
    const C: Obj = { type: 'shape', x: 303, y: 40, width: 100, height: 60 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B, 'qa-c': C });
    const D = { x: 61, y: 37 };
    // без модификатора — прилипает к сетке 20
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-a'))), D);
    const a = await untilDoc(page, boardId, (d) => d.objects['qa-a'], (v) => expect(v.x).not.toBe(A.x));
    expect(a.x % 20, `x=${a.x}`).toBe(0);
    expect(a.y % 20, `y=${a.y}`).toBe(0);
    close(a.x, A.x + D.x, 0, 10);
    close(a.y, A.y + D.y, 0, 10);
    // с Alt — ровно на величину жеста
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-b'))), D, { alt: true });
    const b = await untilDoc(page, boardId, (d) => d.objects['qa-b'], (v) => expect(v.x).not.toBe(B.x));
    close(b.x, B.x + D.x, 0, 1.5);
    close(b.y, B.y + D.y, 0, 1.5);
    expect(b.x % 20).not.toBe(0);
    // Shift + Alt: одна ось и без прилипания
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-c'))), { x: 61, y: 12 }, { shift: true, alt: true });
    const c = await untilDoc(page, boardId, (d) => d.objects['qa-c'], (v) => expect(v.x).not.toBe(C.x));
    close(c.x, C.x + 61, 0, 1.5);
    expect(c.y).toBe(C.y);
    // Grid Off — без прилипания и без модификатора
    await page.getByLabel('Grid').selectOption({ label: 'Off' });
    await dragObject(page, centerOf(await boxOf(obj(page, 'qa-c'))), { x: 33, y: 17 });
    const c2 = await untilDoc(page, boardId, (d) => d.objects['qa-c'], (v) => expect(v.y).not.toBe(C.y));
    close(c2.x, c.x + 33, 0, 1.5);
    close(c2.y, c.y + 17, 0, 1.5);
  } finally {
    await owner.close();
  }
});

test('CVS-12 CVS-10 a click without movement keeps an object placed off the grid with Alt where it is', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    // объект создан инструментом и поставлен с Alt (без прилипания) вне сетки
    await tool(page, 'Shape').click();
    const P = await onCanvas(page, 0.35, 0.4);
    await page.mouse.click(P.x, P.y);
    await expect(allObjects(page)).toHaveCount(1);
    await closeEditor(page);
    const id = (await objectIds(page))[0];
    await dragObject(page, centerOf(await boxOf(obj(page, id))), { x: 37, y: 13 }, { alt: true });
    const placed = await untilDoc(page, boardId, (d) => d.objects[id], (v) => expect(v.x % 20).not.toBe(0));
    // снять выделение и выделить снова простым щелчком: положение не меняется
    await clickEmpty(page, await onCanvas(page, 0.4, 0.9));
    await obj(page, id).click();
    expect(await selectedIds(page)).toEqual([id]);
    await page.waitForTimeout(800);
    const after = (await docState(page, boardId)).objects[id];
    expect({ x: after.x, y: after.y }, 'щелчок без движения не двигает объект').toEqual({ x: placed.x, y: placed.y });
  } finally {
    await owner.close();
  }
});

test('CVS-12 SHR-04 participant by link moves an object and the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const A: Obj = { type: 'shape', x: 100, y: 100, width: 100, height: 60 };
  await seed(owner.page, owner.boardId, { 'qa-a': A });
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  try {
    const ob0 = await boxOf(obj(owner.page, 'qa-a'));
    await dragObject(guest.page, centerOf(await boxOf(obj(guest.page, 'qa-a'))), { x: 80, y: 60 }, { alt: true });
    const a = await untilDoc(owner.page, owner.boardId, (d) => d.objects['qa-a'], (v) => expect(v.x).not.toBe(A.x));
    close(a.x - A.x, 80, 0, 1.5);
    close(a.y - A.y, 60, 0, 1.5);
    await expect.poll(async () => (await boxOf(obj(owner.page, 'qa-a'))).x - ob0.x).toBeCloseTo(80, 0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-13 ----------

test('CVS-13 holding a dragged object at each edge scrolls the view that way and the object follows the pointer', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, boardId, { 'qa-ref': REF });
    const sides: Array<[string, number, number, Point]> = [
      ['right', 1, 0.45, { x: -1, y: 0 }],
      ['left', 0, 0.55, { x: 1, y: 0 }],
      ['bottom', 0.4, 1, { x: 0, y: -1 }],
      ['top', 0.55, 0, { x: 0, y: 1 }],
    ];
    for (const [side, fx, fy, dir] of sides) {
      const cv = await boxOf(canvas(page));
      const cam0 = await cameraBy(page, 'qa-ref', REF);
      const C = await onCanvas(page, 0.5, 0.5);
      const wc = cam0.toWorld(C);
      const id = `qa-${side}`;
      const M: Obj = { type: 'sticky', x: Math.round(wc.x - 30), y: Math.round(wc.y - 30), width: 60, height: 60 };
      await seed(page, boardId, { [id]: M });
      // край холста изнутри (15 px)
      const E = { x: cv.x + Math.min(Math.max(cv.width * fx, 15), cv.width - 15), y: cv.y + Math.min(Math.max(cv.height * fy, 15), cv.height - 15) };
      const start = centerOf(await boxOf(obj(page, id)));
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 5, start.y + 5, { steps: 2 });
      await page.mouse.move(E.x, E.y, { steps: 10 });
      await page.waitForTimeout(1200);
      // объект под указателем во время прокрутки
      const ob = await boxOf(obj(page, id));
      expect(E.x >= ob.x - 2 && E.x <= ob.x + ob.width + 2 && E.y >= ob.y - 2 && E.y <= ob.y + ob.height + 2, `${side}: объект под указателем`).toBe(true);
      await page.mouse.up();
      await waitIdle(page);
      const cam1 = await cameraBy(page, 'qa-ref', REF);
      const shift = { x: cam1.refScreen.x - cam0.refScreen.x, y: cam1.refScreen.y - cam0.refScreen.y };
      // вид поехал к краю: опорный объект сместился в противоположную сторону
      expect(shift.x * dir.x + shift.y * dir.y, `${side}: сдвиг вида ${JSON.stringify(shift)}`).toBeGreaterThan(80);
      expect(Math.abs(dir.x ? shift.y : shift.x), `${side}: вид двигается вдоль своей оси`).toBeLessThan(5);
      // объект ушёл в мире за исходную видимую область
      const m = (await docState(page, boardId)).objects[id];
      const view0 = { left: cam0.toWorld({ x: cv.x, y: cv.y }), right: cam0.toWorld({ x: cv.x + cv.width, y: cv.y + cv.height }) };
      if (side === 'right') expect(m.x + m.width).toBeGreaterThan(view0.right.x);
      if (side === 'left') expect(m.x).toBeLessThan(view0.left.x);
      if (side === 'bottom') expect(m.y + m.height).toBeGreaterThan(view0.right.y);
      if (side === 'top') expect(m.y).toBeLessThan(view0.left.y);
      // после отпускания прокрутка прекращается
      await page.waitForTimeout(600);
      const cam2 = await cameraBy(page, 'qa-ref', REF);
      close(cam2.refScreen.x, cam1.refScreen.x, 0, 1);
      close(cam2.refScreen.y, cam1.refScreen.y, 0, 1);
      // вернуть объект в центр вида для следующей стороны не нужно: следующий создаётся в центре
      await clickEmpty(page, await onCanvas(page, 0.5, 0.5));
    }
  } finally {
    await owner.close();
  }
});

test('CVS-13 dragging in the middle or hovering at the edge does not scroll the view', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, boardId, { 'qa-ref': REF });
    await onCanvas(page, 0.5, 0.5); // прокрутить к холсту до замеров
    const cam0 = await cameraBy(page, 'qa-ref', REF);
    const wc = cam0.toWorld(await onCanvas(page, 0.5, 0.5));
    await seed(page, boardId, { 'qa-m': { type: 'sticky', x: wc.x - 30, y: wc.y - 30, width: 60, height: 60 } });
    // перетаскивание в середине с удержанием
    const s = centerOf(await boxOf(obj(page, 'qa-m')));
    await mousePath(page, [s, { x: s.x + 60, y: s.y + 40 }], { holdMs: 1000 });
    let cam1 = await cameraBy(page, 'qa-ref', REF);
    close(cam1.refScreen.x, cam0.refScreen.x, 0, 1);
    close(cam1.refScreen.y, cam0.refScreen.y, 0, 1);
    // курсор у края без перетаскивания
    const cv = await boxOf(canvas(page));
    await page.mouse.move(cv.x + cv.width - 10, cv.y + cv.height * 0.4, { steps: 5 });
    await page.waitForTimeout(1000);
    await page.mouse.move(cv.x + 10, cv.y + cv.height * 0.5, { steps: 5 });
    await page.waitForTimeout(1000);
    cam1 = await cameraBy(page, 'qa-ref', REF);
    close(cam1.refScreen.x, cam0.refScreen.x, 0, 1);
    close(cam1.refScreen.y, cam0.refScreen.y, 0, 1);
  } finally {
    await owner.close();
  }
});

// ---------- CVS-14 ----------

/** Повернуть маркер Rotate вокруг центра объекта на `deg` градусов (по часовой на экране). */
async function rotateBy(page: Page, id: string, deg: number) {
  const C = centerOf(await boxOf(obj(page, id)));
  const H = centerOf(await boxOf(handle(page, 'rotate')));
  const r = Math.hypot(H.x - C.x, H.y - C.y);
  const a0 = Math.atan2(H.y - C.y, H.x - C.x);
  const n = Math.max(6, Math.ceil(Math.abs(deg) / 10));
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (deg * Math.PI) / 180 * (i / n);
    pts.push({ x: C.x + r * Math.cos(a), y: C.y + r * Math.sin(a) });
  }
  await mousePath(page, pts, { steps: 2 });
}

const norm = (a: number) => ((a % 360) + 360) % 360;
const angleClose = (a: number, b: number, tol: number) => {
  const d = Math.abs(norm(a) - norm(b));
  expect(Math.min(d, 360 - d), `${a}° ≈ ${b}°`).toBeLessThanOrEqual(tol);
};

test('CVS-14 a corner handle resizes by the gesture; second client sees the new size', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    const R: Obj = { type: 'shape', x: 100, y: 100, width: 200, height: 100 };
    await seed(page, boardId, { 'qa-r': R });
    await obj(page, 'qa-r').click();
    await expect(handle(page, 'se')).toBeVisible();
    await expect(handle(page, 'nw')).toBeVisible();
    await dragObject(page, centerOf(await boxOf(handle(page, 'se'))), { x: 60, y: 40 });
    const r = await untilDoc(page, boardId, (d) => d.objects['qa-r'], (v) => expect(v.width).not.toBe(R.width));
    close(r.width, 260, 0, 20);
    close(r.height, 140, 0, 20);
    close(r.x, R.x, 0, 0.5);
    close(r.y, R.y, 0, 0.5);
    await expect.poll(async () => (await boxOf(obj(guest.page, 'qa-r'))).width).toBeCloseTo(r.width, 0);
    // маркер nw: левый верхний угол двигается, правый нижний на месте
    await dragObject(page, centerOf(await boxOf(handle(page, 'nw'))), { x: -40, y: -20 });
    const r2 = await untilDoc(page, boardId, (d) => d.objects['qa-r'], (v) => expect(v.x).not.toBe(R.x));
    close(r2.x + r2.width, r.x + r.width, 0, 1);
    close(r2.y + r2.height, r.y + r.height, 0, 1);
    close(r2.x, R.x - 40, 0, 20);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-14 the rotate handle turns a shape and a text; a sticky note and a mixed selection have none', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, {
      'qa-r': { type: 'shape', x: 120, y: 120, width: 160, height: 80 },
      'qa-t': { type: 'text', x: 400, y: 140, width: 160, height: 40, text: 'Turn me' },
      'qa-s': { type: 'sticky', x: 120, y: 300, width: 120, height: 120 },
    });
    await obj(page, 'qa-r').click();
    await expect(handle(page, 'rotate')).toBeVisible();
    await rotateBy(page, 'qa-r', 90);
    const r = await untilDoc(page, boardId, (d) => d.objects['qa-r'], (v) => expect(v.rotation ?? 0).not.toBe(0));
    angleClose(r.rotation!, 90, 4);
    await expect.poll(() => obj(guest.page, 'qa-r').evaluate((e) => getComputedStyle(e).transform)).not.toBe('none');

    await obj(page, 'qa-t').click();
    await expect(handle(page, 'rotate')).toBeVisible();
    await rotateBy(page, 'qa-t', -45);
    const t = await untilDoc(page, boardId, (d) => d.objects['qa-t'], (v) => expect(v.rotation ?? 0).not.toBe(0));
    angleClose(t.rotation!, -45, 4);

    await obj(page, 'qa-s').click();
    expect(await selectedIds(page)).toEqual(['qa-s']);
    await expect(handle(page, 'se')).toBeVisible();
    await expect(handle(page, 'rotate')).toHaveCount(0);

    await page.keyboard.down('Shift');
    await obj(page, 'qa-r').click();
    await page.keyboard.up('Shift');
    expect(await selectedIds(page)).toEqual(['qa-r', 'qa-s']);
    await expect(handle(page, 'rotate')).toHaveCount(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-14 shrinking past zero keeps a positive finite size; a full turn keeps a finite angle', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, { 'qa-r': { type: 'shape', x: 200, y: 160, width: 120, height: 80 } });
    await obj(page, 'qa-r').click();
    await dragObject(page, centerOf(await boxOf(handle(page, 'se'))), { x: -400, y: -300 });
    const r = await untilDoc(page, boardId, (d) => d.objects['qa-r'], (v) => expect(v.width).not.toBe(120));
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Number.isFinite(r[k]), k).toBe(true);
    expect(r.width).toBeGreaterThan(0);
    expect(r.height).toBeGreaterThan(0);
    test.info().annotations.push({ type: 'наблюдение', description: `после сжатия через ноль: ${JSON.stringify(r)}` });
    // вернуть размер и повернуть на 405°
    await page.reload();
    await seed(page, boardId, { 'qa-q': { type: 'shape', x: 200, y: 160, width: 160, height: 80 } });
    await obj(page, 'qa-q').click();
    await rotateBy(page, 'qa-q', 405);
    const q = await untilDoc(page, boardId, (d) => d.objects['qa-q'], (v) => expect(v.rotation ?? 0).not.toBe(0));
    expect(Number.isFinite(q.rotation)).toBe(true);
    angleClose(q.rotation!, 45, 5);
  } finally {
    await owner.close();
  }
});

test('CVS-14 SHR-04 participant by link resizes and rotates', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, { 'qa-r': { type: 'shape', x: 100, y: 100, width: 200, height: 100 } });
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const page = guest.page;
  try {
    await obj(page, 'qa-r').click();
    await dragObject(page, centerOf(await boxOf(handle(page, 'se'))), { x: 40, y: 40 });
    await rotateBy(page, 'qa-r', 30);
    const r = await untilDoc(owner.page, owner.boardId, (d) => d.objects['qa-r'], (v) => expect(v.rotation ?? 0).not.toBe(0));
    close(r.width, 240, 0, 20);
    angleClose(r.rotation!, 30, 4);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-21 ----------

const THREE: Record<string, Obj> = {
  'qa-a': { type: 'sticky', x: 60, y: 60, width: 100, height: 100 },
  'qa-b': { type: 'shape', x: 220, y: 60, width: 120, height: 80 },
  'qa-c': { type: 'text', x: 60, y: 240, width: 160, height: 40, text: 'keep me' },
};

test('CVS-21 Delete and Backspace remove all selected objects and only them; second client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, THREE);
    await expect(allObjects(guest.page)).toHaveCount(3);
    await obj(page, 'qa-a').click();
    await page.keyboard.down('Shift');
    await obj(page, 'qa-b').click();
    await page.keyboard.up('Shift');
    await page.keyboard.press('Delete');
    await expect(allObjects(page)).toHaveCount(1);
    await expect(obj(page, 'qa-c')).toBeVisible();
    await expect(allObjects(guest.page)).toHaveCount(1);
    const s = await untilDoc(page, boardId, (d) => d, (v) => expect(Object.keys(v.objects)).toEqual(['qa-c']));
    test.info().annotations.push({ type: 'наблюдение (ARCH, вердикт — T5.3/T8.2)', description: `trash: ${JSON.stringify(Object.keys(s.trash))}, записи: ${JSON.stringify(Object.values(s.trash).map((t) => ({ deletedBy: t.deletedBy, deletedAt: t.deletedAt, type: (t.object as Obj | undefined)?.type })))}` });
    await obj(page, 'qa-c').click();
    await page.keyboard.press('Backspace');
    await expect(allObjects(page)).toHaveCount(0);
    await expect(allObjects(guest.page)).toHaveCount(0);
    await untilDoc(page, boardId, (d) => d.objects, (v) => expect(v).toEqual({}));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-21 Delete and Backspace while typing or with nothing selected remove nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, THREE);
    await obj(page, 'qa-c').click();
    await selectionBar(page).getByRole('button', { name: 'Edit text' }).click();
    const editor = page.getByLabel('Object text');
    await expect(editor).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Home');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(500);
    await expect(allObjects(page)).toHaveCount(3);
    await page.keyboard.press('Escape');
    const c = await untilDoc(page, boardId, (d) => d.objects['qa-c'], (v) => expect(v.text).toBe('eep m'));
    expect(c.type).toBe('text');
    // поле ввода вне холста (поиск/ссылка не нужны — фокус в списке Grid не удаляет)
    await clickEmpty(page, await onCanvas(page, 0.4, 0.9));
    await expect(selected(page)).toHaveCount(0);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    await expect(allObjects(page)).toHaveCount(3);
    expect(Object.keys((await docState(page, boardId)).objects).sort()).toEqual(['qa-a', 'qa-b', 'qa-c']);
  } finally {
    await owner.close();
  }
});

test('CVS-21 SHR-04 participant by link deletes selected objects with the Delete button', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, THREE);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  try {
    await expect(obj(guest.page, 'qa-b')).toBeVisible();
    await pressAt(guest.page, isMobile, centerOf(await boxOf(obj(guest.page, 'qa-b'))));
    expect(await selectedIds(guest.page)).toEqual(['qa-b']);
    await selectionBar(guest.page).getByRole('button', { name: 'Delete' }).click();
    await expect(obj(owner.page, 'qa-b')).toHaveCount(0);
    await untilDoc(owner.page, owner.boardId, (d) => Object.keys(d.objects).sort(), (v) => expect(v).toEqual(['qa-a', 'qa-c']));
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-23 ----------

async function menuItems(page: Page, name: 'Object menu' | 'Board menu'): Promise<string[]> {
  return page.getByRole('menu', { name }).getByRole('menuitem').allInnerTexts();
}

test('CVS-23 right-click gives an object menu on an object and a board menu on empty space; no browser menu', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, THREE);
    await page.evaluate(() => {
      (window as unknown as { __cm: boolean[] }).__cm = [];
      window.addEventListener('contextmenu', (e) => (window as unknown as { __cm: boolean[] }).__cm.push(e.defaultPrevented));
    });
    await obj(page, 'qa-a').click({ button: 'right' });
    await expect(objectMenu(page)).toBeVisible();
    expect(await selectedIds(page)).toEqual(['qa-a']);
    const om = await menuItems(page, 'Object menu');
    expect(om.some((t) => /delete/i.test(t))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(objectMenu(page)).toHaveCount(0);

    const cam = await cameraBy(page, 'qa-a', THREE['qa-a']);
    const E = cam.toScreen({ x: 420, y: 220 });
    await page.mouse.click(E.x, E.y, { button: 'right' });
    await expect(boardMenu(page)).toBeVisible();
    await expect(objectMenu(page)).toHaveCount(0);
    const bm = await menuItems(page, 'Board menu');
    expect(bm.some((t) => /delete/i.test(t)), `в меню холста нет действий над объектом: ${bm}`).toBe(false);
    expect(bm).not.toEqual(om);
    // щелчок мимо закрывает
    await page.mouse.click(E.x + 200, E.y - 150);
    await expect(boardMenu(page)).toHaveCount(0);
    const prevented = await page.evaluate(() => (window as unknown as { __cm: boolean[] }).__cm);
    expect(prevented.length).toBeGreaterThanOrEqual(2);
    expect(prevented.every(Boolean), 'системное меню браузера подавлено').toBe(true);
  } finally {
    await owner.close();
  }
});

test('CVS-23 menu actions work and reach the second client; right-click on another object targets it; the menu stays inside the window', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, THREE);
    // выделен b, правый щелчок по a — меню про a
    await obj(page, 'qa-b').click();
    await obj(page, 'qa-a').click({ button: 'right' });
    await expect(objectMenu(page)).toBeVisible();
    await objectMenu(page).getByRole('menuitem', { name: /Delete/ }).click();
    await expect(obj(guest.page, 'qa-a')).toHaveCount(0);
    await expect(obj(guest.page, 'qa-b')).toBeVisible();
    await untilDoc(page, boardId, (d) => Object.keys(d.objects).sort(), (v) => expect(v).toEqual(['qa-b', 'qa-c']));
    // меню холста: добавить стикер в точке
    const cam = await cameraBy(page, 'qa-b', THREE['qa-b']);
    const P = cam.toScreen({ x: 420, y: 250 });
    await page.mouse.click(P.x, P.y, { button: 'right' });
    await boardMenu(page).getByRole('menuitem', { name: 'Add sticky note here' }).click();
    await expect(allObjects(page)).toHaveCount(3);
    await closeEditor(page);
    const added = await untilDoc(page, boardId, (d) => Object.values(d.objects).filter((x) => x.type === 'sticky'), (v) => expect(v, JSON.stringify(v)).toHaveLength(1));
    const w = cam.toWorld(P);
    expect(Math.abs(added[0].x + added[0].width / 2 - w.x) <= added[0].width / 2 + 20 || Math.abs(added[0].x - w.x) <= 20).toBe(true);
    await expect(allObjects(guest.page)).toHaveCount(3);
    // меню холста: выделить всё
    const Q = cam.toScreen({ x: 160, y: 180 });
    await page.mouse.click(Q.x, Q.y, { button: 'right' });
    await boardMenu(page).getByRole('menuitem', { name: 'Select all' }).click();
    await expect(selected(page)).toHaveCount(3);
    // у углов холста меню целиком в окне
    const cv = await boxOf(canvas(page));
    const vp = page.viewportSize()!;
    for (const corner of [{ x: cv.x + 8, y: cv.y + cv.height - 8 }, { x: cv.x + cv.width - 8, y: cv.y + 8 }]) {
      await page.keyboard.press('Escape');
      await page.mouse.click(corner.x, corner.y, { button: 'right' });
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      const mb = await boxOf(menu);
      const scroll = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, y: window.scrollY }));
      expect.soft(mb.x >= 0 && mb.y >= 0 && mb.x + mb.width <= vp.width && mb.y + mb.height <= vp.height, `BUG-005: страница ${JSON.stringify(scroll)}; меню ${JSON.stringify(mb)} в окне ${JSON.stringify(vp)}`).toBe(true);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-23 SHR-04 participant by link opens both menus and uses them', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, THREE);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const page = guest.page;
  try {
    await expect(obj(page, 'qa-c')).toBeVisible();
    const cam = await cameraBy(page, 'qa-a', THREE['qa-a']);
    const P = cam.toScreen({ x: 420, y: 220 });
    await page.mouse.click(P.x, P.y, { button: 'right' });
    await boardMenu(page).getByRole('menuitem', { name: 'Add shape here' }).click();
    await expect(allObjects(owner.page)).toHaveCount(4);
    await closeEditor(page);
    await obj(page, 'qa-c').click({ button: 'right' });
    await objectMenu(page).getByRole('menuitem', { name: /Delete/ }).click();
    await expect(obj(owner.page, 'qa-c')).toHaveCount(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- MOB-03 ----------

test('MOB-03 a short finger move over an object or empty space pans the view; nothing is selected or moved', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: -3000, y: -3000, width: 30, height: 30 };
    await seed(page, boardId, { 'qa-ref': REF });
    await onCanvas(page, 0.5, 0.5); // прокрутить к холсту до замеров
    const cam0 = await cameraBy(page, 'qa-ref', REF);
    const wc = cam0.toWorld(await onCanvas(page, 0.5, 0.4));
    const M: Obj = { type: 'sticky', x: Math.round(wc.x - 50), y: Math.round(wc.y - 50), width: 100, height: 100 };
    await seed(page, boardId, { 'qa-m': M });
    const f = await Finger.of(page);
    // по объекту
    const b0 = await boxOf(obj(page, 'qa-m'));
    const S = centerOf(b0);
    await f.down(S);
    await f.moveTo(S, { x: S.x - 70, y: S.y + 50 });
    await f.up();
    await waitIdle(page);
    const b1 = await boxOf(obj(page, 'qa-m'));
    close(b1.x - b0.x, -70, 0, 3);
    close(b1.y - b0.y, 50, 0, 3);
    expect(await selectedIds(page)).toEqual([]);
    expect((await docState(page, boardId)).objects['qa-m']).toMatchObject({ x: M.x, y: M.y });
    // по пустому месту
    const E = await onCanvas(page, 0.25, 0.85);
    await f.down(E);
    await f.moveTo(E, { x: E.x + 60, y: E.y - 40 });
    await f.up();
    await waitIdle(page);
    const b2 = await boxOf(obj(page, 'qa-m'));
    close(b2.x - b1.x, 60, 0, 3);
    close(b2.y - b1.y, -40, 0, 3);
    expect(await selectedIds(page)).toEqual([]);
    // касание пустого места без движения вид не двигает
    await f.down(E);
    await f.hold(60);
    await f.up();
    await waitIdle(page);
    const b3 = await boxOf(obj(page, 'qa-m'));
    close(b3.x, b2.x, 0, 1);
    close(b3.y, b2.y, 0, 1);
    // движение раньше порога долгого нажатия, затем удержание — это сдвиг, не выделение
    const S2 = centerOf(b3);
    await f.down(S2);
    await f.moveTo(S2, { x: S2.x + 40, y: S2.y }, 4);
    await f.hold(900);
    await f.up();
    await waitIdle(page);
    const b4 = await boxOf(obj(page, 'qa-m'));
    close(b4.x - b3.x, 40, 0, 3);
    expect(await selectedIds(page)).toEqual([]);
    expect((await docState(page, boardId)).objects['qa-m']).toMatchObject({ x: M.x, y: M.y });
  } finally {
    await owner.close();
  }
});

test('MOB-03 a long press selects the object; a long press on empty space starts an area selection without moving the view', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const REF: Obj = { type: 'shape', x: -3000, y: -3000, width: 30, height: 30 };
    await seed(page, boardId, { 'qa-ref': REF });
    await onCanvas(page, 0.5, 0.5); // прокрутить к холсту до замеров
    const cam0 = await cameraBy(page, 'qa-ref', REF);
    const w1 = cam0.toWorld(await onCanvas(page, 0.35, 0.35));
    const w2 = cam0.toWorld(await onCanvas(page, 0.65, 0.35));
    const A: Obj = { type: 'sticky', x: Math.round(w1.x - 30), y: Math.round(w1.y - 30), width: 60, height: 60 };
    const B: Obj = { type: 'shape', x: Math.round(w2.x - 30), y: Math.round(w2.y - 20), width: 60, height: 40 };
    await seed(page, boardId, { 'qa-a': A, 'qa-b': B });
    const f = await Finger.of(page);
    // долгое нажатие на объект
    const S = centerOf(await boxOf(obj(page, 'qa-a')));
    await f.down(S);
    await f.hold(900);
    await f.up();
    await expect.poll(() => selectedIds(page)).toEqual(['qa-a']);
    expect.soft((await docState(page, boardId)).objects['qa-a'], 'долгое нажатие без движения не двигает объект (BUG-004)').toMatchObject({ x: A.x, y: A.y });
    // долгое нажатие на пустом месте + протяжка — выделение области, вид на месте
    const cam1 = await cameraBy(page, 'qa-ref', REF);
    const from = await onCanvas(page, 0.15, 0.15);
    const to = await onCanvas(page, 0.85, 0.55);
    await f.down(from);
    await f.hold(900);
    await f.moveTo(from, to, 12);
    await f.up();
    await expect.poll(() => selectedIds(page)).toEqual(['qa-a', 'qa-b']);
    const cam2 = await cameraBy(page, 'qa-ref', REF);
    close(cam2.refScreen.x, cam1.refScreen.x, 0, 1);
    close(cam2.refScreen.y, cam1.refScreen.y, 0, 1);
    // наблюдение: после долгого нажатия палец тянет объект
    await clickEmptyTouch(page);
    const S3 = centerOf(await boxOf(obj(page, 'qa-b')));
    await f.down(S3);
    await f.hold(900);
    await f.moveTo(S3, { x: S3.x, y: S3.y + 60 });
    await f.up();
    await page.waitForTimeout(800);
    const b = (await docState(page, boardId)).objects['qa-b'];
    test.info().annotations.push({ type: 'наблюдение', description: `долгое нажатие + движение по объекту: y ${B.y} → ${b.y}` });
  } finally {
    await owner.close();
  }
});

async function clickEmptyTouch(page: Page) {
  const p = await onCanvas(page, 0.5, 0.9);
  await page.touchscreen.tap(p.x, p.y);
  await expect(selected(page)).toHaveCount(0);
}

test('MOB-03 SHR-04 participant by link: a long press selects, a short move pans', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const page = guest.page;
  try {
    const REF: Obj = { type: 'shape', x: -3000, y: -3000, width: 30, height: 30 };
    await seed(owner.page, owner.boardId, { 'qa-ref': REF });
    await expect(obj(page, 'qa-ref')).toBeAttached();
    await onCanvas(page, 0.5, 0.5);
    const cam0 = await cameraBy(page, 'qa-ref', REF);
    const w = cam0.toWorld(await onCanvas(page, 0.5, 0.4));
    await seed(owner.page, owner.boardId, { 'qa-m': { type: 'sticky', x: Math.round(w.x - 40), y: Math.round(w.y - 40), width: 80, height: 80 } });
    await expect(obj(page, 'qa-m')).toBeAttached();
    const f = await Finger.of(page);
    const b0 = await boxOf(obj(page, 'qa-m'));
    const S = centerOf(b0);
    await f.down(S);
    await f.moveTo(S, { x: S.x + 50, y: S.y + 30 });
    await f.up();
    await waitIdle(page);
    const b1 = await boxOf(obj(page, 'qa-m'));
    close(b1.x - b0.x, 50, 0, 3);
    expect(await selectedIds(page)).toEqual([]);
    const S1 = centerOf(b1);
    await f.down(S1);
    await f.hold(900);
    await f.up();
    await expect.poll(() => selectedIds(page)).toEqual(['qa-m']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- BUG-003 (CVS-04) и регрессия CVS-01 с объектами на холсте ----------

test('CVS-04 BUG-003 the visible-area frame on the minimap keeps a visible size and differs from objects when objects are far apart', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, {
      'qa-far': { type: 'sticky', x: 5_000_000, y: -3_000_000, width: 200, height: 200 },
      'qa-neg': { type: 'sticky', x: -1_000_000, y: 2_000_000, width: 300, height: 100 },
    });
    await expect(page.locator('[data-testid="minimap"] rect.minimap-object')).toHaveCount(2);
    const v = await boxOf(minimapView(page));
    const objs = await page.locator('[data-testid="minimap"] rect.minimap-object').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON() as { width: number; height: number }));
    expect(v.width, `рамка ${JSON.stringify(v)}`).toBeGreaterThanOrEqual(8);
    expect(v.height).toBeGreaterThanOrEqual(6);
    for (const r of objs) expect(v.width * v.height).toBeGreaterThan(r.width * r.height * 2);
    const look = (sel: string) => page.locator(sel).first().evaluate((e) => {
      const s = getComputedStyle(e);
      return { fill: s.fill, stroke: s.stroke };
    });
    const vl = await look('[data-testid="minimap-view"]');
    const ol = await look('[data-testid="minimap"] rect.minimap-object');
    expect(vl.stroke !== ol.stroke || vl.fill !== ol.fill, `рамка ${JSON.stringify(vl)} / объект ${JSON.stringify(ol)}`).toBe(true);
    expect(vl.stroke).not.toBe('none');
    // рамка поверх объектов
    const last = await page.locator('[data-testid="minimap"] > *').last().getAttribute('data-testid');
    expect(last).toBe('minimap-view');
  } finally {
    await owner.close();
  }
});

test('CVS-01 CVS-04 objects far from the origin are drawn on the canvas where the camera puts them', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const far: Obj = { type: 'sticky', x: 5_000_000, y: -3_000_000, width: 200, height: 200 };
    await seed(page, boardId, { 'qa-far': far, 'qa-neg': { type: 'sticky', x: -1_000_000, y: 2_000_000, width: 300, height: 100 } });
    const rects = page.locator('[data-testid="minimap"] rect.minimap-object');
    await expect(rects).toHaveCount(2);
    await page.getByTestId('minimap').scrollIntoViewIfNeeded();
    const boxes = (await rects.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()))) as Box[];
    const farRect = boxes.sort((p, q) => q.x - p.x)[0];
    await pressAt(page, isMobile, centerOf(farRect));
    await waitIdle(page);
    // после перехода по миникарте (точность — пиксели миникарты, BUG-003) оба далёких объекта нарисованы
    // одной камерой: расстояние на экране = расстояние в мире × масштаб; дальний — рядом с видом
    const fb = await boxOf(obj(page, 'qa-far'));
    const nb = await boxOf(obj(page, 'qa-neg'));
    const zoom = fb.width / far.width;
    close(nb.width, 300 * zoom, 0, 1);
    close(fb.x - nb.x, (far.x - -1_000_000) * zoom, 1e-6, 3);
    close(fb.y - nb.y, (far.y - 2_000_000) * zoom, 1e-6, 3);
    const cv = await boxOf(canvas(page));
    const unitsPerPx = 6_000_000 / (await boxOf(page.getByTestId('minimap'))).width;
    expect(Math.abs(centerOf(fb).x - centerOf(cv).x), 'дальний объект у вида').toBeLessThan(4 * unitsPerPx * zoom);
  } finally {
    await owner.close();
  }
});

// ---------- COL-01 (замечание): одновременная правка одного объекта ----------

test('COL-01 two clients edit one object at once: a move and a fill change both stay; typing into one text merges', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    // стикер создаётся инструментом (объект клиента, текст — Y.Text)
    await tool(page, 'Sticky note').click();
    const P = await onCanvas(page, 0.4, 0.4);
    await page.mouse.click(P.x, P.y);
    await expect(allObjects(page)).toHaveCount(1);
    const id = (await objectIds(page))[0];
    const editor = page.getByLabel('Object text');
    await expect(editor).toBeFocused();
    await page.keyboard.type('ab');
    await page.keyboard.press('Escape');
    await untilDoc(page, boardId, (d) => d.objects[id], (v) => expect(v.text).toBe('ab'));
    const s0 = (await docState(page, boardId)).objects[id];

    // одновременно: владелец двигает (Alt), участник меняет заливку
    await expect(obj(guest.page, id)).toBeVisible();
    await obj(guest.page, id).click();
    const from = centerOf(await boxOf(obj(page, id)));
    await Promise.all([
      dragObject(page, from, { x: 120, y: 60 }, { alt: true }),
      selectionBar(guest.page).getByLabel('Fill').selectOption({ label: 'Pink' }),
    ]);
    const s1 = await untilDoc(page, boardId, (d) => d.objects[id], (v) => {
      expect(v.fill).toBe('#f48fb1');
      expect(v.x).not.toBe(s0.x);
    });
    close(s1.x - s0.x, 120, 0, 1.5);
    expect(s1.text).toBe('ab');

    // одновременный ввод в один текст: владелец — в конец, участник — в начало
    await obj(page, id).click();
    await selectionBar(page).getByRole('button', { name: 'Edit text' }).click();
    await expect(page.getByLabel('Object text')).toBeFocused();
    await page.keyboard.press('End');
    await obj(guest.page, id).click();
    await selectionBar(guest.page).getByRole('button', { name: 'Edit text' }).click();
    await expect(guest.page.getByLabel('Object text')).toBeFocused();
    await guest.page.keyboard.press('Home');
    await Promise.all([page.keyboard.type('XXXX', { delay: 60 }), guest.page.keyboard.type('YYYY', { delay: 60 })]);
    await page.waitForTimeout(800);
    await page.keyboard.press('Escape');
    await guest.page.keyboard.press('Escape');
    const s2 = await untilDoc(page, boardId, (d) => d.objects[id], (v) => {
      expect((v.text ?? '').split('X').length - 1, `текст: ${v.text}`).toBe(4);
      expect((v.text ?? '').split('Y').length - 1, `текст: ${v.text}`).toBe(4);
    });
    expect(s2.text).toContain('a');
    expect(s2.text).toContain('b');
    test.info().annotations.push({ type: 'наблюдение', description: `итоговый текст: ${s2.text}` });
    await expect(obj(page, id)).toContainText(s2.text!);
    await expect(obj(guest.page, id)).toContainText(s2.text!);
  } finally {
    await guest.close();
    await owner.close();
  }
});

void tools;
