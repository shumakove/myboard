// Приёмка T5.4 · отмена, панель инструментов, горячие клавиши: CVS-07, CVS-24, CVS-25.
// Сценарии — docs/qa/reports/T5.4.md. Подписи интерфейса — из handoff T5.4.
// Наблюдение: DOM холста и панели Tools, документ доски глазами позднего клиента (docState),
// второй независимый клиент (участник по ссылке) в своём контексте браузера.
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, openGuest, openOwner, profileOpts, zoomLevel, type Point } from './camera';
import {
  allObjects, boxOf, centerOf, docState, obj, objectIds, onCanvas, seed, selected, selectedIds, selectionBar, tool, tools, untilDoc,
  type Obj,
} from './scene';

type P = Parameters<typeof profileOpts>[0];
const opts = (p: P) => profileOpts(p);
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(120_000));

const DEFAULT_TOOLS = ['Select', 'Lasso', 'Sticky note', 'Shape', 'Text'];
const undoBtn = (page: Page) => tools(page).getByRole('button', { name: 'Undo', exact: true });
const redoBtn = (page: Page) => tools(page).getByRole('button', { name: 'Redo', exact: true });
const allToolsBtn = (page: Page) => tools(page).getByRole('button', { name: 'All tools', exact: true });
const allToolsDialog = (page: Page) => page.getByRole('dialog', { name: 'All tools' });
const pin = (page: Page, name: string) => allToolsDialog(page).getByRole('switch', { name: `Pin ${name}` });

const UNDO = 'ControlOrMeta+z';
const REDO = 'ControlOrMeta+Shift+z';

/** Закреплённые инструменты на левой панели, по порядку (кнопки инструментов с aria-pressed). */
async function pinned(page: Page): Promise<string[]> {
  return tools(page).locator(':scope > button[aria-pressed]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()));
}

/** Закрыть редактор текста, который открывается у нового объекта. */
async function closeEditor(page: Page) {
  const editor = page.getByLabel('Object text');
  if (await editor.isVisible().catch(() => false)) await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
}

/** Создать объект выбранным инструментом щелчком (касанием) в точке холста; вернуть его id. */
async function createAt(page: Page, choose: () => Promise<void>, at: Point, isMobile = false): Promise<string> {
  const before = await objectIds(page);
  await choose();
  if (isMobile) await page.touchscreen.tap(at.x, at.y);
  else await page.mouse.click(at.x, at.y);
  await expect(allObjects(page)).toHaveCount(before.length + 1);
  const id = (await objectIds(page)).find((x) => !before.includes(x))!;
  await closeEditor(page);
  return id;
}

async function dragObject(page: Page, from: Point, d: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + Math.sign(d.x) * 6, from.y + Math.sign(d.y) * 4, { steps: 2 });
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 5 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 5 });
  await page.mouse.up();
}

/** Пустая точка холста для снятия выделения. */
const empty = (page: Page) => onCanvas(page, 0.45, 0.93);

async function clickEmpty(page: Page) {
  const p = await empty(page);
  await page.mouse.click(p.x, p.y);
  await expect(selected(page)).toHaveCount(0);
}

async function select(page: Page, id: string) {
  await clickEmpty(page);
  await obj(page, id).click({ position: { x: 6, y: 6 } });
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

async function setFill(page: Page, id: string, label: string) {
  await select(page, id);
  await selectionBar(page).getByLabel('Fill').selectOption({ label });
}

const pick = (o: Obj | undefined) => (o ? { x: o.x, y: o.y, width: o.width, height: o.height, fill: o.fill, type: o.type } : undefined);

// ---------- CVS-07 ----------

test('CVS-07 Undo and Redo revert and repeat own create, move, fill and delete step by step, by buttons and keys; the second client sees each step', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  try {
    await expect(undoBtn(page)).toBeDisabled();
    await expect(redoBtn(page)).toBeDisabled();
    // 1 создание, 2 перемещение, 3 цвет, 4 удаление
    const id = await createAt(page, () => tool(page, 'Sticky note').click(), await onCanvas(page, 0.3, 0.35));
    const s1 = pick(await untilDoc(page, boardId, (d) => d.objects[id], (v) => expect(v).toBeTruthy()));
    await expect(undoBtn(page)).toBeEnabled();
    await tool(page, 'Select').click();
    await clickEmpty(page);
    await dragObject(page, centerOf(await boxOf(obj(page, id))), { x: 160, y: 80 });
    const s2 = pick(await untilDoc(page, boardId, (d) => d.objects[id], (v) => expect(v.x).not.toBe(s1!.x)));
    await setFill(page, id, 'Blue');
    const s3 = pick(await untilDoc(page, boardId, (d) => d.objects[id], (v) => expect(v.fill).not.toBe(s2!.fill)));
    await select(page, id);
    await page.keyboard.press('Delete');
    await expect(obj(page, id)).toHaveCount(0);
    await expect(obj(guest.page, id)).toHaveCount(0);
    await untilDoc(page, boardId, (d) => d, (v) => {
      expect(v.objects[id]).toBeUndefined();
      expect(Object.keys(v.trash)).toContain(id);
    });

    // Undo кнопкой: удаление отменено — объект вернулся один раз, с прежними свойствами, запись корзины снята
    await clickEmpty(page);
    await undoBtn(page).click();
    await expect(obj(page, id)).toHaveCount(1);
    await expect(obj(guest.page, id)).toHaveCount(1);
    await untilDoc(page, boardId, (d) => d, (v) => {
      expect(pick(v.objects[id])).toEqual(s3);
      expect(Object.keys(v.trash), 'после отмены удаления объекта нет в корзине').not.toContain(id);
    });
    await expect(redoBtn(page)).toBeEnabled();
    // Undo клавишами: цвет, затем перемещение, затем создание
    await page.keyboard.press(UNDO);
    await untilDoc(page, boardId, (d) => pick(d.objects[id]), (v) => expect(v).toEqual(s2));
    await page.keyboard.press(UNDO);
    await untilDoc(page, boardId, (d) => pick(d.objects[id]), (v) => expect(v).toEqual(s1));
    await page.keyboard.press(UNDO);
    await expect(obj(page, id)).toHaveCount(0);
    await expect(obj(guest.page, id)).toHaveCount(0);
    await untilDoc(page, boardId, (d) => d.objects[id], (v) => expect(v).toBeUndefined());
    await expect(undoBtn(page)).toBeDisabled();

    // Redo: кнопкой, Ctrl/⌘+Shift+Z, Ctrl+Y, снова кнопкой — шаги возвращаются по порядку
    await redoBtn(page).click();
    await expect(obj(guest.page, id)).toHaveCount(1);
    await untilDoc(page, boardId, (d) => pick(d.objects[id]), (v) => expect(v).toEqual(s1));
    await page.keyboard.press(REDO);
    await untilDoc(page, boardId, (d) => pick(d.objects[id]), (v) => expect(v).toEqual(s2));
    await page.keyboard.press('Control+y');
    await untilDoc(page, boardId, (d) => pick(d.objects[id]), (v) => expect(v).toEqual(s3));
    await redoBtn(page).click();
    await expect(obj(page, id)).toHaveCount(0);
    await expect(obj(guest.page, id)).toHaveCount(0);
    await untilDoc(page, boardId, (d) => d, (v) => {
      expect(v.objects[id]).toBeUndefined();
      expect(Object.keys(v.trash)).toContain(id);
    });
    await expect(redoBtn(page)).toBeDisabled();
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 Undo does not touch edits of another client: its objects, its later edit of the same object, and its newer value of the same field', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page: A, boardId } = owner;
  const B = guest.page;
  try {
    // объект сторонней записи и объект, созданный вторым клиентом, в стек A не попадают
    await seed(A, boardId, { 'qa-seed': { type: 'sticky', x: 40, y: 40, width: 100, height: 100, fill: '#fff176' } });
    const b1 = await createAt(B, () => tool(B, 'Shape').click(), await onCanvas(B, 0.6, 0.3));
    await expect(obj(A, b1)).toBeVisible();
    await expect(undoBtn(A)).toBeDisabled();
    const before = (await docState(A, boardId)).objects;
    await clickEmpty(A);
    await A.keyboard.press(UNDO);
    await A.waitForTimeout(800);
    expect((await docState(A, boardId)).objects, 'Undo без своих правок ничего не меняет').toEqual(before);

    // A меняет цвет объекта B; B затем двигает его; Undo A возвращает только цвет, перемещение B остаётся
    const b0 = before[b1];
    await setFill(A, b1, 'Blue');
    await untilDoc(A, boardId, (d) => d.objects[b1].fill, (v) => expect(v).not.toBe(b0.fill));
    await tool(B, 'Select').click();
    await clickEmpty(B);
    await dragObject(B, centerOf(await boxOf(obj(B, b1))), { x: 120, y: 60 });
    const moved = await untilDoc(A, boardId, (d) => d.objects[b1], (v) => expect(v.x).not.toBe(b0.x));
    await clickEmpty(A);
    await A.keyboard.press(UNDO);
    const after = await untilDoc(A, boardId, (d) => d.objects[b1], (v) => expect(v.fill).toBe(b0.fill));
    expect({ x: after.x, y: after.y }, 'перемещение второго клиента не отменено').toEqual({ x: moved.x, y: moved.y });

    // то же поле позже меняет B — Undo A его значение не перезаписывает
    await setFill(A, b1, 'Blue');
    await untilDoc(A, boardId, (d) => d.objects[b1].fill, (v) => expect(v).not.toBe(b0.fill));
    await setFill(B, b1, 'Green');
    const green = await untilDoc(A, boardId, (d) => d.objects[b1].fill, (v) => expect(v).toBe('#a5d6a7'));
    await clickEmpty(A);
    await A.keyboard.press(UNDO);
    await A.waitForTimeout(1000);
    expect((await docState(A, boardId)).objects[b1].fill, 'новое значение второго клиента сохранено').toBe(green);

    // объект и правка B живы, сторонний объект не тронут
    const s = await docState(A, boardId);
    expect(s.objects[b1]).toBeTruthy();
    expect(s.objects['qa-seed']).toEqual(before['qa-seed']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 boundaries: empty stack does nothing, several undos go in reverse order, a new edit clears Redo, the stack is empty after reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    // пустой стек: клавиши и кнопки ничего не делают
    await page.keyboard.press(UNDO);
    await page.keyboard.press(REDO);
    await page.keyboard.press('Control+y');
    await expect(allObjects(page)).toHaveCount(0);

    const a = await createAt(page, () => tool(page, 'Sticky note').click(), await onCanvas(page, 0.25, 0.3));
    const b = await createAt(page, () => tool(page, 'Shape').click(), await onCanvas(page, 0.55, 0.3));
    await clickEmpty(page);
    await page.keyboard.press(UNDO);
    await expect(obj(page, b)).toHaveCount(0);
    await expect(obj(page, a)).toHaveCount(1);
    await page.keyboard.press(UNDO);
    await expect(obj(page, a)).toHaveCount(0);
    await page.keyboard.press(REDO);
    await expect(obj(page, a)).toHaveCount(1);
    await expect(redoBtn(page)).toBeEnabled();
    // новая правка очищает Redo: созданный b не возвращается
    const c = await createAt(page, () => tool(page, 'Text').click(), await onCanvas(page, 0.4, 0.55));
    await expect(redoBtn(page)).toBeDisabled();
    await clickEmpty(page);
    await page.keyboard.press(REDO);
    await page.waitForTimeout(600);
    await expect(obj(page, b)).toHaveCount(0);
    expect(Object.keys((await docState(page, boardId)).objects).sort()).toEqual([a, c].sort());

    // стек локальный: после перезагрузки пуст, Undo документ не меняет
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect(obj(page, c)).toBeVisible();
    await expect(undoBtn(page)).toBeDisabled();
    await clickEmpty(page);
    await page.keyboard.press(UNDO);
    await page.waitForTimeout(800);
    expect(Object.keys((await docState(page, boardId)).objects).sort()).toEqual([a, c].sort());
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('CVS-07 SHR-04 participant by link undoes and redoes own edits; the owner sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const { page, boardId } = owner;
  const G = guest.page;
  try {
    const mine = await createAt(page, () => tool(page, 'Shape').click(), await onCanvas(page, 0.6, 0.3));
    const id = await createAt(G, () => tool(G, 'Sticky note').click(), await onCanvas(G, 0.3, 0.3));
    await expect(obj(page, id)).toBeVisible();
    await clickEmpty(G);
    await G.keyboard.press(UNDO);
    await expect(obj(page, id)).toHaveCount(0);
    await expect(obj(page, mine), 'объект владельца не тронут').toHaveCount(1);
    await redoBtn(G).click();
    await expect(obj(page, id)).toHaveCount(1);
    await untilDoc(page, boardId, (d) => Object.keys(d.objects).sort(), (v) => expect(v).toEqual([id, mine].sort()));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 on a phone the Undo and Redo buttons revert and repeat an own edit', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    const id = await createAt(page, () => tool(page, 'Sticky note').tap(), await onCanvas(page, 0.3, 0.3), true);
    await undoBtn(page).tap();
    await expect(obj(page, id)).toHaveCount(0);
    await redoBtn(page).tap();
    await expect(obj(page, id)).toHaveCount(1);
    await untilDoc(page, boardId, (d) => Object.keys(d.objects), (v) => expect(v).toEqual([id]));
  } finally {
    await owner.close();
  }
});

// ---------- CVS-24 ----------

test('CVS-24 All tools lists every tool; an unpinned tool leaves the panel, stays in the list and is chosen from it; pinning returns it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    // новый контекст браузера — набор по умолчанию
    await expect.poll(() => pinned(page)).toEqual(DEFAULT_TOOLS);
    await allToolsBtn(page).click();
    const dlg = allToolsDialog(page);
    await expect(dlg).toBeVisible();
    for (const t of DEFAULT_TOOLS) {
      await expect(dlg.getByRole('button', { name: t, exact: true })).toBeVisible();
      await expect(pin(page, t)).toBeChecked();
    }
    // открепить Sticky note
    await pin(page, 'Sticky note').click();
    await expect(pin(page, 'Sticky note')).not.toBeChecked();
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect(dlg).toBeHidden();
    expect(await pinned(page)).toEqual(['Select', 'Lasso', 'Shape', 'Text']);
    await expect(tool(page, 'Sticky note')).toHaveCount(0);

    // откреплённый инструмент выбирается из полного списка и работает
    await allToolsBtn(page).click();
    await expect(dlg.getByRole('button', { name: 'Sticky note', exact: true })).toBeVisible();
    const id = await createAt(page, async () => {
      await dlg.getByRole('button', { name: 'Sticky note', exact: true }).click();
      await expect(dlg).toBeHidden();
    }, await onCanvas(page, 0.35, 0.35));
    await untilDoc(page, boardId, (d) => d.objects[id]?.type, (v) => expect(v).toBe('sticky'));

    // закрепить обратно — инструмент снова на панели
    await allToolsBtn(page).click();
    await pin(page, 'Sticky note').click();
    await expect(pin(page, 'Sticky note')).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect((await pinned(page)).sort()).toEqual([...DEFAULT_TOOLS].sort());
  } finally {
    await owner.close();
  }
});

test('CVS-24 the order of pinned tools changes and the set and order survive a reload and another board; edges do nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page } = owner;
  try {
    await expect.poll(() => pinned(page)).toEqual(DEFAULT_TOOLS);
    await allToolsBtn(page).click();
    const dlg = allToolsDialog(page);
    // крайние позиции: первый вверх и последний вниз не двигаются
    const up0 = dlg.getByRole('button', { name: 'Move Select up' });
    const down4 = dlg.getByRole('button', { name: 'Move Text down' });
    if (await up0.isEnabled()) await up0.click();
    if (await down4.isEnabled()) await down4.click();
    await expect.poll(() => pinned(page)).toEqual(DEFAULT_TOOLS);
    // Text — на два места вверх, Select — на одно вниз, Lasso откреплён
    await dlg.getByRole('button', { name: 'Move Text up' }).click();
    await dlg.getByRole('button', { name: 'Move Text up' }).click();
    await dlg.getByRole('button', { name: 'Move Select down' }).click();
    await pin(page, 'Lasso').click();
    await dlg.getByRole('button', { name: 'Done' }).click();
    const order = await pinned(page);
    // [Select, Lasso, Sticky note, Shape, Text] → Text ↑↑ → Select ↓ → без Lasso
    expect(order).toEqual(['Select', 'Text', 'Sticky note', 'Shape']);

    // перезагрузка и другая доска этого пользователя — тот же набор и порядок
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    await expect.poll(() => pinned(page)).toEqual(order);
    const other = await owner.newBoard();
    await page.goto(`/boards/${other}`);
    await expect(canvas(page)).toBeVisible();
    await expect.poll(() => pinned(page)).toEqual(order);
  } finally {
    await owner.close();
  }
});

test('CVS-24 with every tool unpinned the panel still offers All tools and each tool can be chosen from it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await allToolsBtn(page).click();
    const dlg = allToolsDialog(page);
    for (const t of DEFAULT_TOOLS) if (await pin(page, t).isChecked()) await pin(page, t).click();
    const left = [] as string[];
    for (const t of DEFAULT_TOOLS) if (await pin(page, t).isChecked()) left.push(t);
    test.info().annotations.push({ type: 'наблюдение', description: `после попытки открепить всё закреплены: ${left.join(', ') || 'ничего'}` });
    await dlg.getByRole('button', { name: 'Done' }).click();
    await expect.poll(() => pinned(page)).toEqual(left);
    await expect(allToolsBtn(page)).toBeVisible();
    await expect(undoBtn(page)).toBeVisible();
    // любой инструмент — из полного списка
    const id = await createAt(page, async () => {
      await allToolsBtn(page).click();
      await dlg.getByRole('button', { name: 'Shape', exact: true }).click();
    }, await onCanvas(page, 0.4, 0.4));
    await untilDoc(page, boardId, (d) => d.objects[id]?.type, (v) => expect(v).toBe('shape'));
    await page.reload();
    await expect(allToolsBtn(page)).toBeVisible();
    await expect.poll(() => pinned(page)).toEqual(left);
    expect(errors).toEqual([]);
  } finally {
    await owner.close();
  }
});

test('CVS-24 SHR-04 participant by link pins and orders tools for itself; the panel of another client does not change', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'QA Guest');
  const G = guest.page;
  try {
    await allToolsBtn(G).click();
    await pin(G, 'Shape').click();
    await allToolsDialog(G).getByRole('button', { name: 'Move Text up' }).click();
    await G.keyboard.press('Escape');
    const order = await pinned(G);
    expect(order).not.toContain('Shape');
    expect(order.indexOf('Text')).toBeLessThan(order.indexOf('Sticky note'));
    await G.reload();
    await expect(canvas(G)).toBeVisible();
    await expect.poll(() => pinned(G)).toEqual(order);
    // настройка панели — не содержимое доски: у владельца в другом браузере панель по умолчанию
    await owner.page.reload();
    await expect(canvas(owner.page)).toBeVisible();
    await expect.poll(() => pinned(owner.page)).toEqual(DEFAULT_TOOLS);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-24 on a phone All tools opens, a switch unpins a tool by a tap and the panel follows', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page } = owner;
  try {
    await allToolsBtn(page).tap();
    const dlg = allToolsDialog(page);
    await expect(dlg).toBeVisible();
    await expect(dlg).toBeInViewport();
    await pin(page, 'Text').tap();
    await expect(pin(page, 'Text')).not.toBeChecked();
    await dlg.getByRole('button', { name: 'Done' }).tap();
    await expect(dlg).toBeHidden();
    expect(await pinned(page)).not.toContain('Text');
  } finally {
    await owner.close();
  }
});

// ---------- CVS-25 ----------

test('CVS-25 V, L, N, S and T choose the main tools; a chosen tool creates its object; the key is shown on the button', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await clickEmpty(page);
    const keys: [string, string][] = [['l', 'Lasso'], ['n', 'Sticky note'], ['s', 'Shape'], ['t', 'Text'], ['v', 'Select']];
    for (const [k, name] of keys) {
      await page.keyboard.press(k);
      await expect(tool(page, name), `${k} → ${name}`).toHaveAttribute('aria-pressed', 'true');
      await expect(tools(page).locator('[aria-pressed="true"]')).toHaveCount(1);
      const shown = `${await tool(page, name).getAttribute('aria-keyshortcuts')} ${await tool(page, name).getAttribute('title')}`;
      expect(shown.toUpperCase(), `${name}: клавиша видна`).toContain(k.toUpperCase());
    }
    // заглавная (Caps Lock/Shift) тоже выбирает
    await page.keyboard.press('Shift+N');
    test.info().annotations.push({ type: 'наблюдение', description: `Shift+N: Sticky note pressed=${await tool(page, 'Sticky note').getAttribute('aria-pressed')}` });
    // выбранный клавишей инструмент создаёт свой объект
    for (const [k, type, fx] of [['n', 'sticky', 0.25], ['s', 'shape', 0.5], ['t', 'text', 0.75]] as const) {
      await clickEmpty(page);
      const id = await createAt(page, () => page.keyboard.press(k), await onCanvas(page, fx, 0.3));
      await untilDoc(page, boardId, (d) => d.objects[id]?.type, (v) => expect(v).toBe(type));
    }
    // клавиша откреплённого инструмента тоже работает
    await allToolsBtn(page).click();
    await pin(page, 'Lasso').click();
    await page.keyboard.press('Escape');
    await expect(allToolsDialog(page)).toBeHidden();
    await page.keyboard.press('l');
    await allToolsBtn(page).click();
    await expect(allToolsDialog(page).getByRole('button', { name: 'Lasso', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.clear());
  } finally {
    await owner.close();
  }
});

test('CVS-25 keys for undo, redo, copy, paste, cut, duplicate, delete, zoom and moving', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    await seed(page, boardId, { 'qa-k': { type: 'sticky', x: 60, y: 60, width: 100, height: 100, fill: '#fff176' } });
    // копирование и вставка: вставленная копия выделена
    await select(page, 'qa-k');
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('ControlOrMeta+v');
    await expect(allObjects(page)).toHaveCount(2);
    const copy = (await selectedIds(page))[0];
    expect(copy).toBeTruthy();
    expect(copy).not.toBe('qa-k');
    // дубликат выделенной копии
    await page.keyboard.press('ControlOrMeta+d');
    await expect(allObjects(page)).toHaveCount(3);
    const dup = (await selectedIds(page))[0];
    expect([copy, 'qa-k']).not.toContain(dup);
    // удаление: Delete — дубликат (выделен), Backspace — копия (сверху, щелчок по центру)
    await page.keyboard.press('Delete');
    await expect(obj(page, dup)).toHaveCount(0);
    await clickEmpty(page);
    await obj(page, copy).click();
    await expect(obj(page, copy)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Backspace');
    await expect(allObjects(page)).toHaveCount(1);
    // отмена и повтор клавишами
    await clickEmpty(page);
    await page.keyboard.press(UNDO);
    await expect(allObjects(page)).toHaveCount(2);
    await page.keyboard.press(REDO);
    await expect(allObjects(page)).toHaveCount(1);
    await page.keyboard.press(UNDO);
    await expect(allObjects(page)).toHaveCount(2);
    await page.keyboard.press('Control+y');
    await expect(allObjects(page)).toHaveCount(1);
    // вырезание
    await select(page, 'qa-k');
    await page.keyboard.press('ControlOrMeta+x');
    await expect(allObjects(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+v');
    await expect(allObjects(page)).toHaveCount(1);
    // масштаб
    await clickEmpty(page);
    const z0 = await zoomLevel(page).textContent();
    await page.keyboard.press('+');
    await expect(zoomLevel(page)).not.toHaveText(z0 ?? '');
    const z1 = await zoomLevel(page).textContent();
    await page.keyboard.press('-');
    await expect(zoomLevel(page)).not.toHaveText(z1 ?? '');
    // перемещение вида стрелками: объект на экране сдвигается
    const only = (await objectIds(page))[0];
    const b0 = await boxOf(obj(page, only));
    await page.keyboard.press('ArrowRight');
    await expect.poll(async () => Math.round((await boxOf(obj(page, only))).x)).not.toBe(Math.round(b0.x));
    const b1 = await boxOf(obj(page, only));
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => Math.round((await boxOf(obj(page, only))).y)).not.toBe(Math.round(b1.y));
    // стрелки без выделения не двигают объект в документе
    const d = (await docState(page, boardId)).objects[only];
    expect(pick(d)).toBeTruthy();
  } finally {
    await owner.close();
  }
});

test('CVS-25 keys do not act on the board while typing in a field or while a modal dialog is open; Delete with nothing selected removes nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page, boardId } = owner;
  try {
    // новый текстовый объект: в редакторе буквы и Ctrl+Z относятся к полю
    const id = await (async () => {
      const before = await objectIds(page);
      await tool(page, 'Sticky note').click();
      const p = await onCanvas(page, 0.3, 0.35);
      await page.mouse.click(p.x, p.y);
      await expect(allObjects(page)).toHaveCount(before.length + 1);
      return (await objectIds(page)).find((x) => !before.includes(x))!;
    })();
    const editor = page.getByLabel('Object text');
    await expect(editor).toBeFocused();
    await page.keyboard.type('vlnst');
    await page.keyboard.press('Backspace');
    await page.keyboard.press(UNDO);
    await page.keyboard.press('Delete');
    await expect(tools(page).locator('[aria-pressed="true"]')).toHaveCount(1);
    const pressed = await tools(page).locator('[aria-pressed="true"]').getAttribute('aria-label') ?? await tools(page).locator('[aria-pressed="true"]').textContent();
    expect(['Select', 'Sticky note'], `инструмент не переключён буквами: ${pressed}`).toContain(pressed);
    await expect(obj(page, id), 'Ctrl+Z и Delete в поле не трогают доску').toHaveCount(1);
    await page.keyboard.press('Escape');
    await untilDoc(page, boardId, (d) => d.objects[id]?.text as string, (v) => expect(v).toMatch(/^vlns/));

    // поле вне холста — поле диалога Share
    await page.getByRole('button', { name: 'Share' }).click();
    const share = page.getByRole('dialog');
    await expect(share).toBeVisible();
    const field = share.locator('input').first();
    if (await field.count()) {
      await field.focus();
      await page.keyboard.press('n');
      await page.keyboard.press('Delete');
    }
    // открытый модальный диалог: клавиши сцены не срабатывают
    await page.keyboard.press('s');
    await page.keyboard.press('Delete');
    await page.keyboard.press(UNDO);
    await page.waitForTimeout(500);
    await expect(obj(page, id)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(share).toBeHidden();
    await expect(tool(page, 'Shape')).toHaveAttribute('aria-pressed', 'false');

    // All tools открыт: N и Delete не действуют на доску
    await select(page, id);
    await allToolsBtn(page).click();
    await page.keyboard.press('n');
    await page.keyboard.press('Delete');
    await page.waitForTimeout(400);
    await expect(obj(page, id)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(allToolsDialog(page)).toBeHidden();

    // Delete без выделения ничего не удаляет
    await clickEmpty(page);
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(500);
    expect(Object.keys((await docState(page, boardId)).objects)).toEqual([id]);
  } finally {
    await owner.close();
  }
});

// ---------- UI-03: диалоги закрываются одним Escape ----------

test('UI-03 every dialog on the board closes with a single Escape', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, opts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const { page } = owner;
  try {
    for (const open of [
      () => page.getByRole('button', { name: 'Share' }).click(),
      () => allToolsBtn(page).click(),
      () => allToolsBtn(page).click().then(() => allToolsDialog(page).getByRole('switch').first().focus()),
      () => allToolsBtn(page).click().then(() => allToolsDialog(page).getByRole('button', { name: 'Move Lasso down' }).click()),
    ]) {
      await open();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog'), 'диалог закрыт первым Escape').toBeHidden();
    }
    await page.evaluate(() => localStorage.clear());
  } finally {
    await owner.close();
  }
});
