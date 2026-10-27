// Приёмка T6.10 · комментарии: CMT-01…CMT-04; попутно MOB-01, SHR-04, ARCH.
// Сценарии — docs/qa/reports/T6.10.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.10.
// Наблюдение: DOM холста и панели, документ доски глазами позднего клиента по /api/ws, второй и третий клиент.
// Код из apps/ не импортируется.
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, dragBy, openGuest, openOwner, profileOpts, Touch, type Opts, type Point } from './camera';
import { boxOf, cameraBy, centerOf, obj, onCanvas, seed, tool, tools, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

// ---------- интерфейс (подписи из handoff T6.10) ----------

const markers = (page: Page) => page.locator('button[data-comment-id]');
const marker = (page: Page, id: string) => page.locator(`button[data-comment-id="${id}"]`);
const commentsBtn = (page: Page) => tools(page).getByRole('group', { name: 'Board actions' }).getByRole('button', { name: /^Comments/ });
const panel = (page: Page) => page.getByRole('region', { name: 'Comments', exact: true });
const items = (page: Page) => panel(page).getByRole('list', { name: 'Comment threads' }).locator('[data-comment-item]');
const item = (page: Page, id: string) => panel(page).locator(`[data-comment-item="${id}"]`);
const messages = (page: Page) => panel(page).getByRole('list', { name: 'Messages' }).getByRole('listitem');
const field = (page: Page) => panel(page).getByRole('textbox', { name: 'Comment', exact: true });
const reply = (page: Page) => panel(page).getByRole('textbox', { name: 'Reply', exact: true });
const btn = (page: Page, name: string) => panel(page).getByRole('button', { name, exact: true });
const palette = (page: Page) => panel(page).getByRole('radiogroup', { name: 'Comment color' });
const people = (page: Page) => panel(page).getByRole('group', { name: 'Filter by people' });

const STICKY: Obj = { type: 'sticky', x: 60, y: 60, width: 160, height: 160, fill: '#fff59d', text: 'QA sticky' };
const REF: Obj = { type: 'shape', x: 500, y: 40, width: 40, height: 40 };

type Msg = { id: string; author: string; text: string; at: unknown };
type Thread = { anchor: { object: string | null; u?: number; v?: number; x?: number; y?: number }; color: string; resolved: boolean; createdBy?: string; messages: Msg[] };

async function docComments(page: Page, boardId: string) {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  return {
    comments: doc.getMap('comments').toJSON() as Record<string, Thread>,
    objects: doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>,
  };
}

async function untilComments(page: Page, boardId: string, check: (c: Record<string, Thread>) => void, timeout = 15_000) {
  let last: Record<string, Thread> = {};
  await expect(async () => {
    last = (await docComments(page, boardId)).comments;
    check(last);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}

const ids = async (page: Page) => (await markers(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-comment-id') ?? ''))).sort();
const itemIds = async (page: Page) => (await items(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-comment-item') ?? ''))).sort();
const colorOf = (page: Page, id: string) => marker(page, id).evaluate((e) => getComputedStyle(e).getPropertyValue('--comment-color').trim().toLowerCase());
/** Нижний левый угол метки (точка привязки по handoff). */
const anchorOf = async (page: Page, id: string): Promise<Point> => {
  const b = await boxOf(marker(page, id));
  return { x: b.x, y: b.y + b.height };
};
const near = (a: Point, b: Point, tol = 4) => {
  expect(Math.abs(a.x - b.x), `x ${a.x} ≈ ${b.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y), `y ${a.y} ≈ ${b.y}`).toBeLessThanOrEqual(tol);
};

async function openPanel(page: Page) {
  if (await panel(page).isVisible()) return;
  await commentsBtn(page).click();
  await expect(panel(page)).toBeVisible();
}

async function closePanel(page: Page) {
  if (!(await panel(page).isVisible())) return;
  await btn(page, 'Close').click();
  await expect(panel(page)).toHaveCount(0);
}

async function pickColor(page: Page, name: string) {
  const r = palette(page).getByRole('radio', { name, exact: true });
  await r.click();
  await expect(r).toBeChecked();
}

/** Новая ветка: клавиша O и щелчок в точке экрана; ввод текста и Post. Вернуть id ветки. */
async function startAt(page: Page, p: Point, text: string, color?: string): Promise<string> {
  const before = new Set(await ids(page));
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press('o');
  await page.mouse.click(p.x, p.y);
  await expect(panel(page).getByText('New comment', { exact: true })).toBeVisible();
  if (color) await pickColor(page, color);
  await field(page).fill(text);
  await btn(page, 'Post').click();
  await expect.poll(async () => (await ids(page)).filter((x) => !before.has(x)).length).toBe(1);
  return (await ids(page)).find((x) => !before.has(x))!;
}

/** Открыть ветку щелчком по метке. */
async function openThread(page: Page, id: string) {
  await marker(page, id).click();
  await expect(messages(page).first()).toBeVisible();
}

async function sendReply(page: Page, text: string) {
  const n = await messages(page).count();
  await reply(page).fill(text);
  await reply(page).press('Enter');
  await expect(messages(page)).toHaveCount(n + 1);
}

async function ownerAndGuest(browser: Browser, f: Fx, guestName = 'QA Guest') {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, { 'qa-s': STICKY, 'qa-ref': REF });
  const guest = await openGuest(browser, o, owner.token, guestName);
  await expect(obj(guest.page, 'qa-s')).toBeVisible();
  return { owner, guest, opts: o };
}

const msgTexts = async (page: Page) => (await messages(page).allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());

// ---------- CMT-01 ----------

test('CMT-01 comment on an object: the marker stays at the object when it is moved by the owner or by the participant; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const c = await startAt(page, centerOf(await boxOf(obj(page, 'qa-s'))), 'On the sticky');
    await expect(messages(page)).toHaveCount(1); // после Post открыта ветка
    const th = await untilComments(page, owner.boardId, (cm) => expect(cm[c]?.anchor?.object).toBe('qa-s'));
    expect(th[c].messages.map((m) => m.text)).toEqual(['On the sticky']);
    expect(th[c].messages[0].author).toBe(owner.name);

    // метка у объекта: смещение метки относительно объекта — у обоих одинаковое
    const rel = async (p: Page) => {
      const o = await boxOf(obj(p, 'qa-s'));
      const a = await anchorOf(p, c);
      return { x: (a.x - o.x) / o.width, y: (a.y - o.y) / o.height };
    };
    await expect(marker(guest.page, c)).toBeVisible();
    const r0 = await rel(page);
    expect(r0.x, 'метка над объектом или у его края').toBeGreaterThan(-0.2);
    expect(r0.x).toBeLessThan(1.2);
    expect(r0.y).toBeGreaterThan(-0.2);
    expect(r0.y).toBeLessThan(1.2);
    const rg = await rel(guest.page);
    near({ x: rg.x * 100, y: rg.y * 100 }, { x: r0.x * 100, y: r0.y * 100 }, 3);

    // владелец перетаскивает стикер — метка едет у обоих
    await closePanel(page);
    await page.keyboard.press('Escape');
    const a0 = await anchorOf(page, c);
    const g0 = await anchorOf(guest.page, c);
    const s = await boxOf(obj(page, 'qa-s'));
    const sg = await boxOf(obj(guest.page, 'qa-s'));
    await dragBy(page, { x: s.x + 30, y: s.y + s.height - 30 }, { x: 140, y: 90 });
    await expect.poll(async () => (await anchorOf(page, c)).x - a0.x).toBeGreaterThan(110);
    const s1 = await boxOf(obj(page, 'qa-s'));
    near(await anchorOf(page, c), { x: a0.x + s1.x - s.x, y: a0.y + s1.y - s.y }, 3);
    await expect.poll(async () => (await anchorOf(guest.page, c)).x - g0.x).toBeGreaterThan(110);
    const sg1 = await boxOf(obj(guest.page, 'qa-s'));
    near(await anchorOf(guest.page, c), { x: g0.x + sg1.x - sg.x, y: g0.y + sg1.y - sg.y }, 3);

    // участник перетаскивает стикер обратно — метка едет у владельца
    const a1 = await anchorOf(page, c);
    const gs = await boxOf(obj(guest.page, 'qa-s'));
    const s2 = await boxOf(obj(page, 'qa-s'));
    await dragBy(guest.page, { x: gs.x + 30, y: gs.y + gs.height - 30 }, { x: -100, y: 40 });
    await expect.poll(async () => (await anchorOf(page, c)).x - a1.x).toBeLessThan(-80);
    const s3 = await boxOf(obj(page, 'qa-s'));
    near(await anchorOf(page, c), { x: a1.x + s3.x - s2.x, y: a1.y + s3.y - s2.y }, 3);

    // после перезагрузки — метка там же относительно объекта
    const before = await rel(page);
    await page.reload();
    await expect(marker(page, c)).toBeVisible();
    const after = await rel(page);
    near({ x: after.x * 100, y: after.y * 100 }, { x: before.x * 100, y: before.y * 100 }, 3);
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CMT-01 comment at a point of the canvas stays at that board point when the view is panned and zoomed; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const cam0 = await cameraBy(page, 'qa-ref', REF);
    const P = cam0.toScreen({ x: 360, y: 300 }); // пустое место (локальные координаты сцены)
    const c = await startAt(page, P, 'On the board point');
    const th = await untilComments(page, owner.boardId, (cm) => expect(cm[c]?.anchor?.object ?? null).toBeNull());
    expect(typeof th[c].anchor.x).toBe('number');
    expect(typeof th[c].anchor.y).toBe('number');
    near(await anchorOf(page, c), P, 4);
    await closePanel(page);

    // сдвиг вида (средняя кнопка) — точка привязки остаётся в той же точке доски
    const worldOf = async (p: Page) => (await cameraBy(p, 'qa-ref', REF)).toWorld(await anchorOf(p, c));
    const w0 = await worldOf(page);
    const cv = await boxOf(canvas(page));
    await dragBy(page, { x: cv.x + cv.width * 0.6, y: cv.y + cv.height * 0.7 }, { x: -120, y: -80 }, 'middle');
    await page.waitForTimeout(300);
    const w1 = await worldOf(page);
    near(w1, w0, 3);
    // масштаб колесом с Ctrl
    await page.mouse.move(cv.x + cv.width * 0.5, cv.y + cv.height * 0.5);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -300);
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);
    const camZ = await cameraBy(page, 'qa-ref', REF);
    expect(Math.abs(camZ.zoom - cam0.zoom), 'масштаб изменился').toBeGreaterThan(0.05);
    near(await worldOf(page), w0, 3);

    // второй клиент и перезагрузка
    await expect(marker(guest.page, c)).toBeVisible();
    near(await worldOf(guest.page), w0, 3);
    await page.reload();
    await expect(marker(page, c)).toBeVisible();
    near(await worldOf(page), w0, 3);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CMT-01 SHR-04 participant by link attaches a comment to the owner object and to a point; the owner sees both with the participant name', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const g = guest.page;
  try {
    const c1 = await startAt(g, centerOf(await boxOf(obj(g, 'qa-s'))), 'Guest on sticky');
    const camG = await cameraBy(g, 'qa-ref', REF);
    await closePanel(g);
    const c2 = await startAt(g, camG.toScreen({ x: 380, y: 320 }), 'Guest on point');
    const th = await untilComments(owner.page, owner.boardId, (cm) => {
      expect(cm[c1]?.anchor.object).toBe('qa-s');
      expect(cm[c2]?.anchor.object ?? null).toBeNull();
    });
    expect(th[c1].messages[0].author).toBe('QA Guest');
    expect(th[c2].messages[0].author).toBe('QA Guest');
    await expect(marker(owner.page, c1)).toBeVisible();
    await expect(marker(owner.page, c2)).toBeVisible();
    await expect(marker(owner.page, c1)).toHaveAttribute('aria-label', /QA Guest/);
    await openThread(owner.page, c1);
    expect((await msgTexts(owner.page)).join(' ')).toContain('Guest on sticky');
    expect((await msgTexts(owner.page)).join(' ')).toContain('QA Guest');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CMT-01 negative: an empty comment is not created, Cancel creates nothing, no browser dialogs; deleting the commented object hides the marker and undo brings it back', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const dialogs: string[] = [];
    page.on('dialog', (d) => dialogs.push(d.type()));
    const S = centerOf(await boxOf(obj(page, 'qa-s')));
    await page.mouse.move(S.x, S.y);
    await page.keyboard.press('o');
    await page.mouse.click(S.x, S.y);
    await expect(panel(page).getByText('New comment', { exact: true })).toBeVisible();
    await expect(panel(page).getByText(/On Sticky note/)).toBeVisible();
    // пусто и одни пробелы — не отправляется
    await field(page).fill('   ');
    const post = btn(page, 'Post');
    if (await post.isEnabled()) await post.click();
    await page.waitForTimeout(800);
    expect(Object.keys((await docComments(page, owner.boardId)).comments)).toHaveLength(0);
    await btn(page, 'Cancel').click();
    await page.waitForTimeout(500);
    await expect(markers(page)).toHaveCount(0);
    await expect(page.locator('[data-comment-draft]')).toHaveCount(0);
    expect(Object.keys((await docComments(page, owner.boardId)).comments)).toHaveLength(0);

    // удаление объекта с комментарием
    const c = await startAt(page, S, 'Will be deleted');
    await expect(marker(guest.page, c)).toBeVisible();
    await closePanel(page);
    await obj(page, 'qa-s').click();
    await page.keyboard.press('Delete');
    await expect(obj(page, 'qa-s')).toHaveCount(0);
    await expect(marker(page, c)).toHaveCount(0);
    await expect(marker(guest.page, c)).toHaveCount(0);
    // ветка остаётся в списке (наблюдение по handoff)
    await openPanel(page);
    await expect(item(page, c)).toHaveCount(1);
    await closePanel(page);
    await page.keyboard.press('Control+z');
    await expect(obj(page, 'qa-s')).toBeVisible();
    await expect(marker(page, c)).toBeVisible();
    await expect(marker(guest.page, c)).toBeVisible();
    expect(dialogs).toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CMT-02 ----------

test('CMT-02 conversation: owner and participant reply in one thread; authors and order are the same on both sides and after reload; an empty reply is not sent', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  const g = guest.page;
  try {
    const c = await startAt(page, centerOf(await boxOf(obj(page, 'qa-s'))), 'First from owner');
    await openThread(g, c);
    await sendReply(g, 'Reply from guest');
    await expect(messages(page)).toHaveCount(2);
    await sendReply(page, 'Second from owner');
    await expect(messages(g)).toHaveCount(3);
    // пустой ответ
    await reply(page).fill('   ');
    await reply(page).press('Enter');
    const send = btn(page, 'Send');
    if (await send.isEnabled()) await send.click();
    await page.waitForTimeout(800);
    await expect(messages(page)).toHaveCount(3);

    const expectOrder = async (p: Page) => {
      const t = await msgTexts(p);
      expect(t).toHaveLength(3);
      expect(t[0]).toContain('First from owner');
      expect(t[0]).toContain(owner.name);
      expect(t[1]).toContain('Reply from guest');
      expect(t[1]).toContain('QA Guest');
      expect(t[2]).toContain('Second from owner');
      expect(t[2]).toContain(owner.name);
    };
    await expectOrder(page);
    await expectOrder(g);
    await expect(marker(g, c)).toHaveText(/3/);
    const th = await untilComments(page, owner.boardId, (cm) => expect(cm[c]?.messages).toHaveLength(3));
    expect(th[c].messages.map((m) => [m.author, m.text])).toEqual([
      [owner.name, 'First from owner'],
      ['QA Guest', 'Reply from guest'],
      [owner.name, 'Second from owner'],
    ]);
    // Shift+Enter — новая строка, а не отправка
    await reply(g).fill('Line 1');
    await reply(g).press('Shift+Enter');
    await reply(g).type('Line 2');
    await expect(messages(g)).toHaveCount(3);
    await reply(g).press('Enter');
    await expect(messages(g)).toHaveCount(4);
    await expect(messages(page)).toHaveCount(4);

    await g.reload();
    await expect(marker(g, c)).toBeVisible();
    await openThread(g, c);
    await expect(messages(g)).toHaveCount(4);
    const t = await msgTexts(g);
    expect(t[1]).toContain('Reply from guest');
    expect(t[3]).toMatch(/Line 1.*Line 2/);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CMT-02 resolve and reopen: the resolved flag reaches the second client and survives reload; the thread stays reachable', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  const g = guest.page;
  try {
    const c = await startAt(page, centerOf(await boxOf(obj(page, 'qa-s'))), 'Please fix');
    await expect(marker(g, c)).toBeVisible();
    await btn(page, 'Resolve').click();
    await expect(btn(page, 'Reopen')).toBeVisible();
    await expect(marker(page, c)).toHaveAttribute('data-resolved', 'true');
    await expect(marker(g, c)).toHaveAttribute('data-resolved', 'true');
    await expect(marker(g, c)).toHaveAttribute('aria-label', /resolved/i);
    await untilComments(page, owner.boardId, (cm) => expect(cm[c]?.resolved).toBe(true));
    await openPanel(g);
    await expect(item(g, c)).toContainText('Resolved');
    // Hide resolved скрывает и возвращает
    await panel(g).getByRole('checkbox', { name: 'Hide resolved' }).or(panel(g).getByRole('switch', { name: 'Hide resolved' })).or(btn(g, 'Hide resolved')).first().click();
    await expect(item(g, c)).toHaveCount(0);
    await panel(g).getByRole('checkbox', { name: 'Hide resolved' }).or(panel(g).getByRole('switch', { name: 'Hide resolved' })).or(btn(g, 'Hide resolved')).first().click();
    await expect(item(g, c)).toHaveCount(1);
    // после перезагрузки признак остаётся; участник открывает ветку снова
    await g.reload();
    await expect(marker(g, c)).toHaveAttribute('data-resolved', 'true');
    await openThread(g, c);
    await btn(g, 'Reopen').click();
    await expect(btn(g, 'Resolve')).toBeVisible();
    await expect(marker(page, c)).not.toHaveAttribute('data-resolved', 'true');
    await untilComments(page, owner.boardId, (cm) => expect(cm[c]?.resolved).toBe(false));
    await page.reload();
    await expect(marker(page, c)).toBeVisible();
    await expect(marker(page, c)).not.toHaveAttribute('data-resolved', 'true');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CMT-02 unread: a new comment and a new reply are marked unread for the other participant only; opening clears it for that participant only; reload keeps it read', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest, opts } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const second = await openGuest(browser, opts, owner.token, 'QA Second');
  const page = owner.page;
  const g = guest.page;
  const g2 = second.page;
  try {
    await expect(commentsBtn(g)).toHaveAccessibleName('Comments');
    const c = await startAt(page, centerOf(await boxOf(obj(page, 'qa-s'))), 'Look here');
    await closePanel(page); // открытая ветка отмечает новые сообщения прочитанными
    // у автора — не непрочитано
    await expect(marker(page, c)).not.toHaveAttribute('data-unread', 'true');
    await expect(commentsBtn(page)).toHaveAccessibleName('Comments');
    // у обоих участников — непрочитано
    for (const p of [g, g2]) {
      await expect(marker(p, c)).toHaveAttribute('data-unread', 'true');
      await expect(marker(p, c)).toHaveAttribute('aria-label', /1 unread/);
      await expect(commentsBtn(p)).toHaveAccessibleName('Comments, 1 unread');
    }
    await openPanel(g);
    await expect(item(g, c)).toHaveAttribute('data-unread', 'true');
    await expect(item(g, c)).toContainText('1 new');
    // первый участник открывает — у него прочитано, у второго — нет
    await item(g, c).click();
    await expect(messages(g)).toHaveCount(1);
    await expect(marker(g, c)).not.toHaveAttribute('data-unread', 'true');
    await expect(commentsBtn(g)).toHaveAccessibleName('Comments');
    await g2.waitForTimeout(500);
    await expect(marker(g2, c)).toHaveAttribute('data-unread', 'true');
    await expect(commentsBtn(g2)).toHaveAccessibleName('Comments, 1 unread');

    // ответ участника — непрочитан у владельца и у второго участника, у автора — нет
    await sendReply(g, 'Done');
    await expect(marker(g, c)).not.toHaveAttribute('data-unread', 'true');
    await expect(marker(page, c)).toHaveAttribute('data-unread', 'true');
    await expect(commentsBtn(page)).toHaveAccessibleName('Comments, 1 unread');
    await expect(marker(g2, c)).toHaveAttribute('aria-label', /2 unread/);
    await expect(commentsBtn(g2)).toHaveAccessibleName(/^Comments, [12] unread$/);

    // перезагрузка: прочитанное остаётся прочитанным, непрочитанное — непрочитанным
    await g.reload();
    await expect(marker(g, c)).toBeVisible();
    await expect(marker(g, c)).not.toHaveAttribute('data-unread', 'true');
    await page.reload();
    await expect(marker(page, c)).toHaveAttribute('data-unread', 'true');
    await openThread(page, c);
    await expect(marker(page, c)).not.toHaveAttribute('data-unread', 'true');
    await page.reload();
    await expect(marker(page, c)).toBeVisible();
    await expect(marker(page, c)).not.toHaveAttribute('data-unread', 'true');
    // у второго участника всё ещё непрочитано
    await expect(marker(g2, c)).toHaveAttribute('data-unread', 'true');
    // новое сообщение, пока ветка открыта у участника, сразу прочитано
    await openThread(g, c);
    await openThread(page, c);
    await sendReply(page, 'While open');
    await expect(messages(g)).toHaveCount(3);
    await g.waitForTimeout(500);
    await expect(marker(g, c)).not.toHaveAttribute('data-unread', 'true');
  } finally {
    await second.close();
    await guest.close();
    await owner.close();
  }
});

// ---------- CMT-03 ----------

test('CMT-03 comment color: chosen for a new thread and changed on an existing one; the marker color reaches the second client and survives reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  const g = guest.page;
  try {
    const cam = await cameraBy(page, 'qa-ref', REF);
    // цвет по умолчанию есть
    const c0 = await startAt(page, cam.toScreen({ x: 340, y: 300 }), 'Default color');
    const d0 = (await untilComments(page, owner.boardId, (cm) => expect(cm[c0]?.color).toMatch(/^#[0-9a-f]{6}$/i)))[c0].color.toLowerCase();
    expect(await colorOf(page, c0)).not.toBe('');
    await closePanel(page);
    // новая ветка синим
    const c1 = await startAt(page, cam.toScreen({ x: 420, y: 300 }), 'Blue one', 'Blue');
    const blue = (await untilComments(page, owner.boardId, (cm) => expect(cm[c1]?.color).toBeTruthy()))[c1].color.toLowerCase();
    expect(blue, 'выбранный цвет отличается от цвета по умолчанию').not.toBe(d0);
    await expect.poll(() => colorOf(page, c1)).toBe(blue);
    await expect.poll(() => colorOf(g, c1)).toBe(blue);
    // участник меняет цвет существующей ветки
    await openThread(g, c0);
    await pickColor(g, 'Red');
    const red = (await untilComments(page, owner.boardId, (cm) => expect(cm[c0]?.color.toLowerCase()).not.toBe(d0)))[c0].color.toLowerCase();
    expect(red).not.toBe(blue);
    await expect.poll(() => colorOf(page, c0)).toBe(red);
    await expect.poll(() => colorOf(g, c0)).toBe(red);
    // цвет метки действительно виден (фон или обводка отличаются у красной и синей)
    const paint = (p: Page, id: string) => marker(p, id).evaluate((e) => {
      const s = getComputedStyle(e);
      return `${s.backgroundColor}|${s.borderColor}|${s.color}`;
    });
    expect(await paint(page, c0)).not.toBe(await paint(page, c1));
    await page.reload();
    await expect(marker(page, c0)).toBeVisible();
    await expect.poll(() => colorOf(page, c0)).toBe(red);
    await expect.poll(() => colorOf(page, c1)).toBe(blue);
    // образец в списке
    await openPanel(page);
    await expect(item(page, c0)).toHaveCount(1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CMT-04 ----------

test('CMT-04 filter by people: the participant by link name keeps only threads where they wrote (started or replied); owner filter; both; clearing shows all; canvas markers follow', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  const g = guest.page;
  try {
    const cam = await cameraBy(page, 'qa-ref', REF);
    const A = await startAt(page, cam.toScreen({ x: 330, y: 300 }), 'Owner only');
    await closePanel(page);
    const C = await startAt(page, cam.toScreen({ x: 430, y: 300 }), 'Owner then guest');
    await closePanel(page);
    const camG = await cameraBy(g, 'qa-ref', REF);
    const B = await startAt(g, camG.toScreen({ x: 380, y: 380 }), 'Guest only');
    await closePanel(g);
    await openThread(g, C);
    await sendReply(g, 'Guest reply');
    await closePanel(g);

    await openPanel(page);
    await expect(items(page)).toHaveCount(3);
    const toggles = people(page).getByRole('button');
    await expect(toggles).toHaveCount(2);
    const guestT = people(page).getByRole('button', { name: 'QA Guest', exact: true });
    const ownerT = people(page).getByRole('button', { name: owner.name, exact: true });
    await guestT.click();
    await expect(guestT).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => itemIds(page)).toEqual([B, C].sort());
    await expect.poll(() => ids(page)).toEqual([B, C].sort());
    await guestT.click();
    await ownerT.click();
    await expect.poll(() => itemIds(page)).toEqual([A, C].sort());
    await expect.poll(() => ids(page)).toEqual([A, C].sort());
    await guestT.click();
    await expect.poll(() => itemIds(page)).toEqual([A, B, C].sort());
    await guestT.click();
    await ownerT.click();
    await expect(ownerT).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => itemIds(page)).toEqual([A, B, C].sort());
    await expect.poll(() => ids(page)).toEqual([A, B, C].sort());

    // у участника — тот же фильтр по своему имени
    await openPanel(g);
    await people(g).getByRole('button', { name: 'QA Guest', exact: true }).click();
    await expect.poll(() => itemIds(g)).toEqual([B, C].sort());
    // фильтр одного не влияет на другого
    await expect.poll(() => ids(page)).toEqual([A, B, C].sort());
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- MOB-01 (попутно) ----------

test('CMT-01 CMT-02 MOB-01 on a phone a comment is started with the Comment tool and a tap on empty space, the panel fits the screen width, a reply is sent', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    // инструмент Comment из All tools и касание пустого места
    await tool(page, 'All tools').tap();
    await page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Comment', exact: true }).tap();
    const p = await onCanvas(page, 0.5, 0.6);
    await (await Touch.of(page)).tap(p);
    await expect(panel(page).getByText('New comment', { exact: true })).toBeVisible();
    await field(page).fill('From phone');
    await btn(page, 'Post').tap();
    await expect(markers(page)).toHaveCount(1);
    const c = (await ids(page))[0];
    await expect(messages(page)).toHaveCount(1);
    const vw = page.viewportSize()!.width;
    const pb = await boxOf(panel(page));
    expect(pb.x).toBeGreaterThanOrEqual(-1);
    expect(pb.x + pb.width).toBeLessThanOrEqual(vw + 1);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(sw, 'нет горизонтальной прокрутки').toBeLessThanOrEqual(vw + 1);
    await reply(page).fill('Reply on phone');
    await btn(page, 'Send').tap();
    await expect(messages(page)).toHaveCount(2);
    await untilComments(page, owner.boardId, (cm) => expect(cm[c]?.messages.map((m) => m.text)).toEqual(['From phone', 'Reply on phone']));
    await expect(marker(guest.page, c)).toHaveAttribute('data-unread', 'true');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- ARCH ----------

test('ARCH CMT-01…04 comments live in the board document `comments` (anchor, messages, color, resolved), not in `objects`; editing makes no mutating HTTP requests', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const page = owner.page;
  try {
    const mutating: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) mutating.push(`${r.method()} ${r.url()}`);
    });
    const before = Object.keys((await docComments(page, owner.boardId)).objects).sort();
    const c = await startAt(page, centerOf(await boxOf(obj(page, 'qa-s'))), 'Arch', 'Green');
    await sendReply(page, 'Arch reply');
    await btn(page, 'Resolve').click();
    const d = await docComments(page, owner.boardId);
    expect(Object.keys(d.objects).sort(), 'в objects комментарий не попадает').toEqual(before);
    const t = d.comments[c];
    expect(t).toBeTruthy();
    expect(t.anchor.object).toBe('qa-s');
    expect(t.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(t.resolved).toBe(true);
    expect(t.messages.map((m) => m.text)).toEqual(['Arch', 'Arch reply']);
    expect(mutating, 'правки комментариев идут через WebSocket sync').toEqual([]);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CMT-02 CMT-04 observation: a participant by link who enters the same name as the owner', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, { 'qa-s': STICKY, 'qa-ref': REF });
  const twin = await openGuest(browser, o, owner.token, owner.name);
  try {
    const c = await startAt(twin.page, centerOf(await boxOf(obj(twin.page, 'qa-s'))), 'From the namesake');
    await expect(marker(owner.page, c)).toBeVisible();
    await owner.page.waitForTimeout(1000);
    const unread = await marker(owner.page, c).getAttribute('data-unread');
    await openPanel(owner.page);
    const people = await panel(owner.page).getByRole('group', { name: 'Filter by people' }).getByRole('button').count();
    test.info().annotations.push({ type: 'наблюдение', description: `у владельца data-unread=${unread}; кнопок в Filter by people: ${people}` });
    console.log(`наблюдение CMT-02/CMT-04 (тёзка): у владельца data-unread=${unread}; кнопок в Filter by people: ${people}`);
  } finally {
    await twin.close();
    await owner.close();
  }
});
