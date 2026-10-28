// Приёмка T6.12 · заметка доски: NTE-01…NTE-03 (+ COL-01 для заметки, SHR-04, CVS-07, MOB-01).
// Сценарии — docs/qa/reports/T6.12.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.12.
// Наблюдение: панель заметки в DOM, положение объекта относительно холста, документ доски глазами
// позднего клиента по /api/ws (корень `notes`), запросы страницы, второй клиент (владелец / участник по ссылке).
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, varuint, type Opts } from './camera';
import { boxOf, centerOf, obj, objectIds, onCanvas, seed, selected, tool, tools, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(150_000));

const noteBtn = (page: Page) => tools(page).getByRole('button', { name: 'Note', exact: true });
const panel = (page: Page) => page.getByRole('region', { name: 'Board note' });
const pin = (page: Page) => panel(page).getByRole('switch', { name: 'Open for everyone' });
const editBtn = (page: Page) => panel(page).getByRole('button', { name: 'Edit note', exact: true });
const editor = (page: Page) => panel(page).getByRole('textbox', { name: 'Object text' });
const slashMenu = (page: Page) => page.getByRole('menu', { name: 'Insert block' });
const linkDialog = (page: Page) => page.getByRole('dialog', { name: 'Choose object to link' });
const DOC_BLOCKS = ['Text', 'Heading 1', 'Heading 2', 'Heading 3', 'Bulleted list', 'Numbered list', 'To-do list', 'Divider', 'Link to object'];

const HOME: Obj = { type: 'shape', x: 40, y: 40, width: 120, height: 80 };
const FAR: Obj = { type: 'sticky', x: 20_000, y: 14_000, width: 200, height: 200, text: 'Far Goal' };

const optsOf = (f: Fx) => profileOpts(f);

async function press(l: Locator, isMobile: boolean) {
  if (isMobile) await l.tap();
  else await l.click();
}

async function openNote(page: Page, isMobile = false) {
  if (!(await panel(page).isVisible())) await press(noteBtn(page), isMobile);
  await expect(panel(page)).toBeVisible();
}

async function startEdit(page: Page, isMobile = false) {
  await openNote(page, isMobile);
  if (!(await editor(page).isVisible())) await press(editBtn(page), isMobile);
  await expect(editor(page)).toBeVisible();
  await editor(page).focus();
}

async function stopEdit(page: Page) {
  for (let i = 0; i < 3 && (await editor(page).isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await expect(editor(page)).toBeHidden();
  await expect(panel(page), 'конец правки не закрывает панель').toBeVisible();
}

/** Текст корня `notes` документа доски глазами нового клиента. */
async function notesText(page: Page, boardId: string): Promise<string> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  return dumpNotes(doc.getXmlFragment('notes'));
}

/** Содержимое `notes` строкой: текст, вставки (дельта) и атрибуты узлов. */
function dumpNotes(frag: Y.XmlFragment): string {
  return JSON.stringify(
    frag.toArray().map((n) =>
      n instanceof Y.XmlText ? { attrs: n.getAttributes(), delta: n.toDelta() } : n instanceof Y.XmlElement ? { attrs: n.getAttributes(), xml: n.toString() } : String(n),
    ),
  );
}

/** BUG-027: в корне `notes` ровно один текст заметки, и он содержит все слова. */
async function expectOneNoteText(page: Page, boardId: string, words: string[]) {
  await expect(async () => {
    const frag = (await docSeenByLateClient(page, `board=${boardId}`)).getXmlFragment('notes');
    const nodes = frag.toArray();
    expect(nodes.length, `узлов в notes: ${dumpNotes(frag)}`).toBe(1);
    expect(nodes[0]).toBeInstanceOf(Y.XmlText);
    const text = (nodes[0] as Y.XmlText).toString();
    for (const w of words) expect(text, `в тексте заметки нет ${w}: ${dumpNotes(frag)}`).toContain(w);
  }).toPass({ timeout: 15_000 });
}

/** Записать обновление Yjs в документ доски по каналу страницы (sync update). */
async function putUpdate(page: Page, query: string, update: Uint8Array) {
  const bytes = [...varuint(0), ...varuint(2), ...varuint(update.length), ...update];
  await page.evaluate(
    async ({ query, bytes }) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?${query}`);
      ws.binaryType = 'arraybuffer';
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('канал не открылся'));
      });
      ws.send(new Uint8Array(bytes));
      await new Promise((r) => setTimeout(r, 500));
      ws.close();
    },
    { query, bytes },
  );
}

async function pickBlock(page: Page, name: string) {
  await page.keyboard.type('/');
  await expect(slashMenu(page)).toBeVisible();
  await slashMenu(page).getByRole('menuitem', { name, exact: true }).click();
  await expect(slashMenu(page)).toBeHidden();
}

async function insertLink(page: Page, search: string, label: RegExp) {
  await pickBlock(page, 'Link to object');
  await expect(linkDialog(page)).toBeVisible();
  await linkDialog(page).getByLabel('Find object').fill(search);
  await linkDialog(page).getByRole('list', { name: 'Board objects' }).getByRole('button', { name: label }).click();
  await expect(linkDialog(page)).toBeHidden();
}

/** Центр объекта внутри видимой части холста. */
async function expectInView(page: Page, id: string) {
  await expect(async () => {
    const c = await boxOf(canvas(page));
    const vw = page.viewportSize()!;
    const o = centerOf(await boxOf(obj(page, id)));
    expect(o.x, `объект ${id} по x на холсте`).toBeGreaterThan(Math.max(c.x, 0));
    expect(o.x).toBeLessThan(Math.min(c.x + c.width, vw.width));
    expect(o.y, `объект ${id} по y на холсте`).toBeGreaterThan(Math.max(c.y, 0));
    expect(o.y).toBeLessThan(Math.min(c.y + c.height, vw.height));
  }).toPass({ timeout: 10_000 });
}

async function expectOutOfView(page: Page, id: string) {
  const c = await boxOf(canvas(page));
  const b = await obj(page, id).boundingBox();
  if (!b) return;
  const m = centerOf(b);
  expect(m.x < c.x || m.x > c.x + c.width || m.y < c.y || m.y > c.y + c.height, `объект ${id} пока вне вида`).toBe(true);
}

async function reload(page: Page) {
  await page.reload();
  await expect(canvas(page)).toBeVisible();
}

// ---------- NTE-01 ----------

test('NTE-01 note opens in a separate panel apart from the canvas and closes; canvas, camera and objects stay unchanged', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { home: HOME });
    await expect(panel(page)).toBeHidden();
    const before = await boxOf(obj(page, 'home'));
    const ids = await objectIds(page);
    await noteBtn(page).click();
    await expect(panel(page)).toBeVisible();
    await expect(noteBtn(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByText('Board note')).toBeVisible();
    // панель — не объект холста
    expect(await panel(page).locator('xpath=ancestor-or-self::*[@data-object-id]').count(), 'панель не внутри объекта сцены').toBe(0);
    await startEdit(page);
    await page.keyboard.type('Agenda for today');
    await stopEdit(page);
    await expect(panel(page)).toContainText('Agenda for today');
    expect(await objectIds(page), 'заметка не создаёт объект на холсте').toEqual(ids);
    expect(await boxOf(obj(page, 'home')), 'камера не сдвинулась').toEqual(before);
    await panel(page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel(page)).toBeHidden();
    await expect(noteBtn(page)).toHaveAttribute('aria-pressed', 'false');
    // ARCH: текст — в `notes`, не в `objects`
    const doc = await docSeenByLateClient(page, `board=${owner.boardId}`);
    expect(dumpNotes(doc.getXmlFragment('notes'))).toContain('Agenda for today');
    expect(JSON.stringify(doc.getMap('objects').toJSON())).not.toContain('Agenda for today');
  } finally {
    await owner.close();
  }
});

test('NTE-01 TXT-04 note slash menu offers the same blocks as a document and inserts heading, lists and divider', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    // пункты меню «/» в документе на холсте
    await tool(page, 'All tools').click();
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Document', exact: true }).click();
    const p = await onCanvas(page, 0.3, 0.3);
    await page.mouse.click(p.x, p.y);
    const docEditor = page.getByRole('textbox', { name: 'Object text' });
    await expect(docEditor).toBeVisible();
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    const docItems = await slashMenu(page).getByRole('menuitem').allInnerTexts();
    await page.keyboard.press('Escape');
    for (let i = 0; i < 3 && (await docEditor.isVisible()); i++) await page.keyboard.press('Escape');

    await startEdit(page);
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    const noteItems = await slashMenu(page).getByRole('menuitem').allInnerTexts();
    expect(noteItems.map((s) => s.trim()), 'меню «/» заметки = меню документа').toEqual(docItems.map((s) => s.trim()));
    for (const n of DOC_BLOCKS) await expect(slashMenu(page).getByRole('menuitem', { name: n, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(slashMenu(page)).toBeHidden();
    await expect(editor(page), 'Escape закрывает только меню').toBeVisible();
    await page.keyboard.press('Backspace');

    await pickBlock(page, 'Heading 1');
    await page.keyboard.type('Plan');
    await page.keyboard.press('Enter');
    await pickBlock(page, 'Bulleted list');
    await page.keyboard.type('first point');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await pickBlock(page, 'To-do list');
    await page.keyboard.type('buy milk');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await pickBlock(page, 'Divider');
    await stopEdit(page);

    await expect(panel(page).locator('h1')).toHaveText('Plan');
    await expect(panel(page).locator('li').filter({ hasText: 'first point' })).toBeVisible();
    await expect(panel(page).locator('hr')).toHaveCount(1);
    // TXT-02: флажок списка дел отмечается без входа в правку
    const box = panel(page).getByRole('checkbox').first();
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(box).toBeChecked();
    await expect(editor(page)).toBeHidden();
    // быстрая разметка «#» и «-»
    await startEdit(page);
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## Next');
    await page.keyboard.press('Enter');
    await stopEdit(page);
    await expect(panel(page).getByRole('heading', { level: 2, name: 'Next' })).toBeVisible();
    await reload(page);
    await openNote(page);
    await expect(panel(page).locator('h1')).toHaveText('Plan');
    await expect(panel(page).getByRole('checkbox').first()).toBeChecked();
  } finally {
    await owner.close();
  }
});

test('NTE-01 COL-01 SHR-04 note text reaches the other client live and survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'Note Guest');
  try {
    await openNote(guest.page);
    await startEdit(owner.page);
    await owner.page.keyboard.type('Owner wrote this');
    await expect(panel(guest.page), 'участник видит правку владельца без перезагрузки').toContainText('Owner wrote this', { timeout: 10_000 });
    await stopEdit(owner.page);
    await startEdit(guest.page);
    await guest.page.keyboard.press('Control+End');
    await guest.page.keyboard.type(' and guest added');
    await stopEdit(guest.page);
    await expect(panel(owner.page)).toContainText('and guest added', { timeout: 10_000 });
    await reload(owner.page);
    await openNote(owner.page);
    await expect(panel(owner.page)).toContainText('Owner wrote this and guest added');
  } finally {
    await guest.close();
    await owner.close();
  }
});

/** Два клиента одновременно пишут в заметку; `seedText` — исходный текст (пусто — пустая заметка). */
async function concurrentWrite(browser: Browser, o: Opts, seedText: string) {
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'Note Guest');
  try {
    if (seedText) {
      await startEdit(owner.page);
      await owner.page.keyboard.type(seedText);
      await stopEdit(owner.page);
      await openNote(guest.page);
      await expect(panel(guest.page)).toContainText(seedText);
    }
    // каждый открывает правку и сразу пишет; оба — одновременно (для пустой заметки — оба начинают её)
    // владелец пишет в конец, участник — в начало (одна позиция дала бы посимвольное чередование)
    const write = async (page: Page, word: string, key: string) => {
      await openNote(page);
      await press(editBtn(page), false);
      await page.keyboard.press(key);
      await page.keyboard.type(word);
    };
    await Promise.all([write(owner.page, ' OWNERWORD ', 'Control+End'), write(guest.page, ' GUESTWORD ', 'Control+Home')]);
    await owner.page.waitForTimeout(1500);
    for (const page of [owner.page, guest.page]) {
      for (let i = 0; i < 3 && (await editor(page).isVisible()); i++) await page.keyboard.press('Escape');
    }
    for (const [who, page] of [['владелец', owner.page], ['участник', guest.page]] as const) {
      await expect(panel(page), `${who} видит текст владельца`).toContainText('OWNERWORD', { timeout: 10_000 });
      await expect(panel(page), `${who} видит текст участника`).toContainText('GUESTWORD', { timeout: 10_000 });
    }
    await expectOneNoteText(owner.page, owner.boardId, ['OWNERWORD', 'GUESTWORD']);
    await reload(owner.page);
    await openNote(owner.page);
    await expect(panel(owner.page)).toContainText('OWNERWORD');
    await expect(panel(owner.page)).toContainText('GUESTWORD');
  } finally {
    await guest.close();
    await owner.close();
  }
}

test('NTE-01 COL-01 two clients typing into the note at once keep both texts', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  await concurrentWrite(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }), 'Shared start');
});

test('NTE-01 COL-01 two clients starting an empty note at once keep both texts', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  await concurrentWrite(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }), '');
});

test('NTE-01 COL-01 participant writing an empty note offline keeps the text after reconnect next to the owner text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'Note Guest');
  try {
    // участник без связи начинает пустую заметку, владелец в это же время — тоже
    await guest.context.setOffline(true);
    await startEdit(guest.page);
    await guest.page.keyboard.type('GUESTWORD');
    await stopEdit(guest.page);
    await startEdit(owner.page);
    await owner.page.keyboard.type('OWNERWORD');
    await stopEdit(owner.page);
    await guest.context.setOffline(false);
    for (const [who, page] of [['владелец', owner.page], ['участник', guest.page]] as const) {
      await expect(panel(page), `${who} видит текст владельца`).toContainText('OWNERWORD', { timeout: 20_000 });
      await expect(panel(page), `${who} видит текст участника`).toContainText('GUESTWORD', { timeout: 20_000 });
    }
    await expectOneNoteText(owner.page, owner.boardId, ['OWNERWORD', 'GUESTWORD']);
    // правки после восстановления идут в тот же текст у обоих
    await startEdit(guest.page);
    await guest.page.keyboard.press('Control+End');
    await guest.page.keyboard.type(' AFTERSYNC');
    await stopEdit(guest.page);
    await expect(panel(owner.page)).toContainText('AFTERSYNC', { timeout: 10_000 });
    await expectOneNoteText(owner.page, owner.boardId, ['OWNERWORD', 'GUESTWORD', 'AFTERSYNC']);
    await reload(guest.page);
    await openNote(guest.page);
    for (const w of ['OWNERWORD', 'GUESTWORD', 'AFTERSYNC']) await expect(panel(guest.page)).toContainText(w);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('NTE-01 COL-01 both clients writing an empty note offline keep both texts after reconnect', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'Note Guest');
  try {
    await owner.page.context().setOffline(true);
    await guest.context.setOffline(true);
    for (const [page, word] of [[owner.page, 'OWNERWORD'], [guest.page, 'GUESTWORD']] as const) {
      await startEdit(page);
      await page.keyboard.type(word);
      await stopEdit(page);
    }
    await owner.page.context().setOffline(false);
    await guest.context.setOffline(false);
    for (const [who, page] of [['владелец', owner.page], ['участник', guest.page]] as const) {
      await expect(panel(page), `${who} видит текст владельца`).toContainText('OWNERWORD', { timeout: 20_000 });
      await expect(panel(page), `${who} видит текст участника`).toContainText('GUESTWORD', { timeout: 20_000 });
    }
    await expectOneNoteText(owner.page, owner.boardId, ['OWNERWORD', 'GUESTWORD']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('NTE-01 COL-01 note written earlier as a node with a random id is shown, edited in place and keeps its text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  try {
    // заметка прежнего формата: один Y.XmlText от обычного (случайного) клиента
    const legacy = new Y.Doc();
    expect(legacy.clientID).not.toBe(0);
    legacy.getXmlFragment('notes').insert(0, [new Y.XmlText('Legacy note text')]);
    await putUpdate(owner.page, `board=${owner.boardId}`, Y.encodeStateAsUpdate(legacy));
    await reload(owner.page);
    await openNote(owner.page);
    await expect(panel(owner.page), 'прежняя заметка показана').toContainText('Legacy note text');
    const guest = await openGuest(browser, o, owner.token, 'Note Guest');
    try {
      await openNote(guest.page);
      await expect(panel(guest.page)).toContainText('Legacy note text');
      // оба правят прежнюю заметку одновременно
      const write = async (page: Page, word: string, key: string) => {
        await press(editBtn(page), false);
        await expect(editor(page)).toBeVisible();
        await page.keyboard.press(key);
        await page.keyboard.type(word);
      };
      await Promise.all([write(owner.page, ' OWNERPLUS', 'Control+End'), write(guest.page, 'GUESTPLUS ', 'Control+Home')]);
      await owner.page.waitForTimeout(1500);
      await stopEdit(owner.page);
      await stopEdit(guest.page);
      // закрепление прежней заметки — флаг на том же узле
      await pin(owner.page).click();
      await expect(pin(guest.page)).toBeChecked({ timeout: 10_000 });
      for (const page of [owner.page, guest.page]) {
        for (const w of ['Legacy note text', 'OWNERPLUS', 'GUESTPLUS']) await expect(panel(page)).toContainText(w, { timeout: 10_000 });
      }
      await expectOneNoteText(owner.page, owner.boardId, ['Legacy note text', 'OWNERPLUS', 'GUESTPLUS']);
      const frag = (await docSeenByLateClient(owner.page, `board=${owner.boardId}`)).getXmlFragment('notes');
      const node = frag.get(0) as Y.XmlText;
      expect(node._item?.id.client, 'узел прежней заметки сохранён').toBe(legacy.clientID);
      expect(node.getAttribute('openForAll')).toBe(true);
      await reload(owner.page);
      await expect(panel(owner.page), 'закреплённая прежняя заметка открыта при входе').toBeVisible();
      for (const w of ['Legacy note text', 'OWNERPLUS', 'GUESTPLUS']) await expect(panel(owner.page)).toContainText(w);
    } finally {
      await guest.close();
    }
  } finally {
    await owner.close();
  }
});

test('NTE-01 CVS-07 Ctrl+Z in the note undoes the note edit and leaves the canvas intact', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { home: HOME });
    await startEdit(page);
    await page.keyboard.type('keep');
    await page.waitForTimeout(2000);
    await page.keyboard.type(' drop');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+z');
    await expect(editor(page)).not.toContainText('drop');
    await expect(editor(page)).toContainText('keep');
    await page.keyboard.press('Control+y');
    await expect(editor(page)).toContainText('keep drop');
    await stopEdit(page);
    await expect(obj(page, 'home'), 'объект холста цел').toBeVisible();
  } finally {
    await owner.close();
  }
});

// ---------- NTE-02 ----------

test('NTE-02 pinned note opens on entry for the owner and a new participant; unpinned stays closed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  try {
    const page = owner.page;
    // без закрепления: при входе закрыта (в том числе с непустой заметкой)
    await startEdit(page);
    await page.keyboard.type('Welcome, read me first');
    await stopEdit(page);
    await reload(page);
    await page.waitForTimeout(1500);
    await expect(panel(page), 'не закреплена — при входе закрыта').toBeHidden();
    const g0 = await openGuest(browser, o, owner.token, 'Early Guest');
    await g0.page.waitForTimeout(1500);
    await expect(panel(g0.page)).toBeHidden();
    await g0.close();

    await openNote(page);
    await expect(pin(page)).not.toBeChecked();
    await pin(page).click();
    await expect(pin(page)).toBeChecked();
    // ARCH: флаг — в `notes` документа
    await expect.poll(async () => notesText(page, owner.boardId), { timeout: 10_000 }).toMatch(/"openForAll":true/);

    await reload(page);
    await expect(panel(page), 'владелец при входе видит заметку').toBeVisible({ timeout: 15_000 });
    await expect(panel(page)).toContainText('Welcome, read me first');
    const g1 = await openGuest(browser, o, owner.token, 'New Guest');
    await expect(panel(g1.page), 'новый участник при входе видит заметку').toBeVisible({ timeout: 15_000 });
    await expect(panel(g1.page)).toContainText('Welcome, read me first');
    await expect(pin(g1.page), 'флаг общий').toBeChecked();
    // закрыть у себя может каждый
    await panel(g1.page).getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel(g1.page)).toBeHidden();
    await expect(panel(page), 'закрытие у участника не закрывает у владельца').toBeVisible();
    // снять закрепление может участник по ссылке (SHR-04)
    await openNote(g1.page);
    await pin(g1.page).click();
    await expect(pin(g1.page)).not.toBeChecked();
    await expect(pin(page)).not.toBeChecked({ timeout: 10_000 });
    await g1.close();
    await reload(page);
    await page.waitForTimeout(1500);
    await expect(panel(page), 'после снятия — при входе закрыта').toBeHidden();
  } finally {
    await owner.close();
  }
});

test('NTE-02 SHR-04 participant pins the note and the owner gets it open on entry', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'Pin Guest');
  try {
    await startEdit(guest.page);
    await guest.page.keyboard.type('Guest rules');
    await stopEdit(guest.page);
    await pin(guest.page).click();
    await expect(pin(guest.page)).toBeChecked();
    // наблюдение: у уже вошедшего владельца панель не обязана открыться («при входе»)
    await owner.page.waitForTimeout(1000);
    test.info().annotations.push({ type: 'наблюдение', description: `у уже вошедшего владельца панель открыта: ${await panel(owner.page).isVisible()}` });
    await reload(owner.page);
    await expect(panel(owner.page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(owner.page)).toContainText('Guest rules');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- NTE-03 ----------

test('NTE-03 object link in the note moves the view to the object for the author, another participant and after reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await openGuest(browser, o, owner.token, 'Link Guest');
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { home: HOME, far: FAR });
    await expectOutOfView(page, 'far');
    await startEdit(page);
    await page.keyboard.type('See ');
    await insertLink(page, 'far', /Far Goal/);
    await stopEdit(page);
    const link = panel(page).getByRole('button', { name: /Far Goal/ });
    await expect(link).toBeVisible();
    // ARCH: ссылка — идентификатор объекта из `objects`
    expect(await notesText(page, owner.boardId)).toMatch(/"objectLink":"far"/);
    await link.click();
    await expectInView(page, 'far');
    await expect(panel(page)).toBeVisible();

    await expect(obj(guest.page, 'far')).toBeAttached();
    await expectOutOfView(guest.page, 'far');
    await openNote(guest.page);
    await panel(guest.page).getByRole('button', { name: /Far Goal/ }).click();
    await expectInView(guest.page, 'far');

    // вид после перезагрузки может восстановиться у объекта: проверяем, что ссылка сохранилась и ведёт к нему
    await reload(page);
    await openNote(page);
    await panel(page).getByRole('button', { name: /Far Goal/ }).click();
    await expectInView(page, 'far');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('NTE-03 link to an object inside a far frame moves the view to it; link to a deleted object does not break the board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, {
      home: HOME,
      frm: { type: 'frame', x: -15_000, y: 9_000, width: 800, height: 600, title: 'Far frame' },
      kid: { type: 'sticky', parent: 'frm', x: 500, y: 300, width: 200, height: 200, text: 'Child Task' },
      gone: { type: 'sticky', x: 5_000, y: 5_000, width: 200, height: 200, text: 'Doomed Item' },
    });
    await startEdit(page);
    await insertLink(page, 'child', /Child Task/);
    await page.keyboard.press('Enter');
    await insertLink(page, 'doomed', /Doomed Item/);
    await stopEdit(page);
    await expectOutOfView(page, 'kid');
    await panel(page).getByRole('button', { name: /Child Task/ }).click();
    await expectInView(page, 'kid');
    // удалить объект: Delete на выделенном
    await panel(page).getByRole('button', { name: /Doomed Item/ }).click();
    await expectInView(page, 'gone');
    await expect(selected(page)).toHaveCount(1);
    await canvas(page).focus();
    await page.keyboard.press('Delete');
    await expect(obj(page, 'gone')).toHaveCount(0);
    const missing = panel(page).getByRole('button', { name: /Missing object/ });
    await expect(missing).toBeVisible();
    await expect(missing).toBeDisabled();
    await expect(panel(page).getByRole('button', { name: /Child Task/ })).toBeEnabled();
  } finally {
    await owner.close();
  }
});

// ---------- телефон ----------

test('NTE-01 NTE-03 MOB-01 note on a phone: open by tap, type, link tap moves the view', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { home: HOME, far: FAR });
    await startEdit(page, true);
    await page.keyboard.type('Phone note ');
    await insertLink(page, 'far', /Far Goal/);
    await stopEdit(page);
    const pb = await boxOf(panel(page));
    const vw = page.viewportSize()!;
    expect(pb.x, 'панель в пределах экрана').toBeGreaterThanOrEqual(0);
    expect(pb.x + pb.width).toBeLessThanOrEqual(vw.width + 1);
    await expect(panel(page)).toContainText('Phone note');
    await expectOutOfView(page, 'far');
    await panel(page).getByRole('button', { name: /Far Goal/ }).tap();
    await expectInView(page, 'far');
    const fb = await boxOf(obj(page, 'far'));
    const visibleCenter = centerOf(fb);
    const covered = visibleCenter.x >= pb.x && visibleCenter.x <= pb.x + pb.width && visibleCenter.y >= pb.y && visibleCenter.y <= pb.y + pb.height;
    test.info().annotations.push({ type: 'наблюдение', description: `центр объекта под панелью заметки: ${covered}` });
  } finally {
    await owner.close();
  }
});

test('NTE-02 MOB-01 pinned note opens on entry on a phone and can be closed', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  try {
    await startEdit(owner.page, true);
    await owner.page.keyboard.type('Mobile pinned');
    await stopEdit(owner.page);
    await pin(owner.page).tap();
    await expect(pin(owner.page)).toBeChecked();
    const g = await openGuest(browser, o, owner.token, 'Phone Guest');
    await expect(panel(g.page)).toBeVisible({ timeout: 15_000 });
    await expect(panel(g.page)).toContainText('Mobile pinned');
    await panel(g.page).getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(panel(g.page)).toBeHidden();
    await g.close();
  } finally {
    await owner.close();
  }
});

// ---------- архитектура ----------

test('NTE-01 ARCH note edits travel over the WebSocket only, without changing HTTP requests to /api', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const mutating: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) mutating.push(`${r.method()} ${r.url()}`);
    });
    await startEdit(page);
    await page.keyboard.type('Only websocket');
    await stopEdit(page);
    await pin(page).click();
    await expect.poll(async () => notesText(page, owner.boardId), { timeout: 10_000 }).toContain('Only websocket');
    expect(mutating, 'изменяющие HTTP-запросы').toEqual([]);
    const doc = await docSeenByLateClient(page, `board=${owner.boardId}`);
    expect(Object.keys(doc.getMap('objects').toJSON())).toEqual([]);
    expect(doc.getXmlFragment('notes').length, 'заметка — в корне notes').toBeGreaterThan(0);
  } finally {
    await owner.close();
  }
});

