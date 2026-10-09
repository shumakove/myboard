// Приёмка T6.2 · стикеры: STK-01…STK-05 (+ COL-01, CVS-07, CVS-08, CVS-22, UI-01…04 новых элементов).
// Сценарии — docs/qa/reports/T6.2.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.2.
// Наблюдение: DOM холста (вычисленные стили), документ доски глазами позднего клиента по /api/ws, второй клиент.
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, close, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, cameraBy, centerOf, Finger, obj, objectIds, onCanvas, seed, selectionBar, tool, tools, type Obj } from './scene';
import { hsl, hueDist, rgba, signature, transparent } from './ui';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(150_000));

const MAC = process.platform === 'darwin';
// начало и конец всего поля (текст стикера переносится по строкам)
const END = MAC ? 'Meta+ArrowDown' : 'Control+End';
const HOME = MAC ? 'Meta+ArrowUp' : 'Control+Home';

const editor = (page: Page) => page.getByRole('textbox', { name: 'Object text' });
const palette = (page: Page) => page.getByRole('toolbar', { name: 'Sticky note color' });
const swatch = (page: Page, name: string) => palette(page).getByRole('button', { name, exact: true });
const tagsBtn = (page: Page) => selectionBar(page).getByRole('button', { name: /^Tags/ });
const tagsGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Tags' });
const addTagField = (page: Page) => tagsGroup(page).getByLabel('Add tag');
const author = (page: Page, id: string) => obj(page, id).getByTestId('sticky-author');
const canvasTags = (page: Page, id: string) => obj(page, id).getByRole('list', { name: 'Tags' }).getByRole('listitem');

const guestOf = (browser: Browser, o: Opts, token: string, name = 'QA Guest') => openGuest(browser, o, token, name);
const optsOf = (f: Fx) => profileOpts(f);

const COLORS = { Yellow: '#fff176', Orange: '#ffb74d', Pink: '#f48fb1', Blue: '#81d4fa', Green: '#a5d6a7', Purple: '#ce93d8', White: '#ffffff' } as const;
const hexRgb = (h: string) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

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

/** Инструмент Sticky note (или Sticky stack), цвет из палитры, щелчок по холсту. */
async function placeSticky(page: Page, fx: number, fy: number, color?: keyof typeof COLORS, isMobile = false, toolName = 'Sticky note'): Promise<string> {
  const before = new Set(await objectIds(page));
  if (toolName === 'Sticky stack') {
    await press(tool(page, 'All tools'), isMobile);
    await press(page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Sticky stack', exact: true }), isMobile);
  } else {
    await press(tool(page, toolName), isMobile);
  }
  await expect(palette(page)).toBeVisible();
  if (color) {
    await press(swatch(page, color), isMobile);
    await expect(swatch(page, color)).toHaveAttribute('aria-pressed', 'true');
  }
  const p = await onCanvas(page, fx, fy);
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  return waitNew(page, before);
}

async function exitEdit(page: Page) {
  for (let i = 0; i < 3 && (await editor(page).isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await expect(editor(page)).toBeHidden();
}

async function clickEmpty(page: Page) {
  const p = await onCanvas(page, 0.05, 0.9);
  await page.mouse.click(p.x, p.y);
}

async function selectObj(page: Page, id: string) {
  const b = await boxOf(obj(page, id));
  await page.mouse.click(b.x + b.width - 8, b.y + 12);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

async function openEditorOn(page: Page, id: string) {
  await selectObj(page, id);
  await selectionBar(page).getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

type DocObj = { fields: Record<string, unknown>; text: string; tags: unknown };
async function docObject(page: Page, query: string, id: string): Promise<DocObj | null> {
  const doc = await docSeenByLateClient(page, query);
  const o = doc.getMap('objects').get(id);
  if (!(o instanceof Y.Map)) return null;
  const t = o.get('text');
  const tags = o.get('tags');
  return {
    fields: o.toJSON() as Record<string, unknown>,
    text: t instanceof Y.Text ? t.toString() : String(t ?? ''),
    tags: tags instanceof Y.Array ? { yarray: tags.toArray() } : tags,
  };
}

async function untilObject(page: Page, query: string, id: string, check: (o: DocObj) => void) {
  await expect(async () => {
    const o = await docObject(page, query, id);
    expect(o, `объект ${id} в документе`).not.toBeNull();
    check(o!);
  }).toPass({ timeout: 15_000, intervals: [300, 600, 1000] });
}

async function addTag(page: Page, tag: string, via: 'enter' | 'button' = 'enter') {
  if (!(await tagsGroup(page).isVisible())) await tagsBtn(page).click();
  await expect(tagsGroup(page)).toBeVisible();
  await addTagField(page).fill(tag);
  if (via === 'enter') await addTagField(page).press('Enter');
  else await tagsGroup(page).getByRole('button', { name: 'Add', exact: true }).click();
}

/** Размер шрифта первого абзаца стикера и выходит ли текст за его рамку. */
async function fontOf(page: Page, id: string) {
  return obj(page, id).evaluate((e) => {
    const p = e.querySelector('.rich-text p, .rich-text li, .rich-text h1') ?? e;
    const rt = e.querySelector('.rich-text') as HTMLElement | null;
    const box = e.getBoundingClientRect();
    let bottom = 0;
    let right = 0;
    if (rt) {
      const r = document.createRange();
      r.selectNodeContents(rt);
      for (const rc of Array.from(r.getClientRects())) {
        if (rc.width < 0.5) continue;
        bottom = Math.max(bottom, rc.bottom);
        right = Math.max(right, rc.right);
      }
    }
    return { size: parseFloat(getComputedStyle(p).fontSize), overflowY: bottom - box.bottom, overflowX: right - box.right, fit: e.getAttribute('data-font-fit') };
  });
}

async function setSel(page: Page, label: string, option: string) {
  await selectionBar(page).getByRole('combobox', { name: label, exact: true }).selectOption({ label: option });
}

/** Перетащить мышью из `from` в `to` с порогом начала перетаскивания. */
async function dragMouse(page: Page, from: Point, to: Point) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

// ---------- STK-01 ----------

test('STK-01 color chosen in the palette before placing gives a sticky note of that color with text; other notes keep their color; persists and reaches a participant', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const pink = await placeSticky(page, 0.3, 0.3, 'Pink');
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('Pink idea');
    await exitEdit(page);
    await clickEmpty(page);
    const blue = await placeSticky(page, 0.6, 0.3, 'Blue');
    await page.keyboard.type('Blue idea');
    await exitEdit(page);
    await clickEmpty(page);
    const q = `board=${owner.boardId}`;
    await untilObject(page, q, pink, (d) => {
      expect(d.fields.type).toBe('sticky');
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Pink);
      expect(d.text.trim()).toBe('Pink idea');
    });
    await untilObject(page, q, blue, (d) => {
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Blue);
      expect(d.text.trim()).toBe('Blue idea');
    });
    const bg = (p: Page, id: string) => obj(p, id).evaluate((e) => getComputedStyle(e).backgroundColor);
    for (const p of [page, guest.page]) {
      await expect(obj(p, pink)).toContainText('Pink idea');
      await expect(obj(p, blue)).toContainText('Blue idea');
      expect(await bg(p, pink), 'цвет розового стикера').toBe(hexRgb(COLORS.Pink));
      expect(await bg(p, blue), 'цвет голубого стикера').toBe(hexRgb(COLORS.Blue));
    }
    await page.reload();
    await expect(obj(page, pink)).toContainText('Pink idea');
    expect(await bg(page, pink)).toBe(hexRgb(COLORS.Pink));
    expect(await bg(page, blue)).toBe(hexRgb(COLORS.Blue));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-01 dragging a color swatch from the palette onto the canvas creates a sticky note of that color at the drop point; dropping back on the palette creates nothing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const REF: Obj = { type: 'shape', x: 0, y: 0, width: 40, height: 40 };
    await seed(page, owner.boardId, { 'qa-ref': REF });
    const cam = await cameraBy(page, 'qa-ref', REF);
    await tool(page, 'Sticky note').click();
    await expect(palette(page)).toBeVisible();
    await swatch(page, 'Yellow').click();
    // отпускание обратно на панели — стикера нет
    const g = centerOf(await boxOf(swatch(page, 'Green')));
    const pur = centerOf(await boxOf(swatch(page, 'Purple')));
    await dragMouse(page, g, pur);
    await page.waitForTimeout(500);
    expect(await objectIds(page), 'отпускание на панели не создаёт стикер').toEqual(['qa-ref']);
    // перетаскивание образца на холст
    const P = await onCanvas(page, 0.6, 0.55);
    const before = new Set(await objectIds(page));
    await dragMouse(page, centerOf(await boxOf(swatch(page, 'Green'))), P);
    const id = await waitNew(page, before);
    await exitEdit(page).catch(() => undefined);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      expect(d.fields.type).toBe('sticky');
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Green);
      expect(d.tags, 'пустой Y.Array тегов').toEqual({ yarray: [] });
    });
    const b = await boxOf(obj(page, id));
    const c = centerOf(b);
    close(c.x, P.x, 0, 25);
    close(c.y, P.y, 0, 25);
    const w = cam.toWorld(P);
    expect(w).toBeTruthy();
  } finally {
    await owner.close();
  }
});

test('STK-01 link participant picks a color and places a sticky note; the owner sees color and text without reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const id = await placeSticky(guest.page, 0.4, 0.4, 'Orange');
    await guest.page.keyboard.type('From guest');
    await exitEdit(guest.page);
    await expect(obj(owner.page, id)).toContainText('From guest');
    expect(await obj(owner.page, id).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(hexRgb(COLORS.Orange));
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- STK-02 ----------

test('STK-02 auto fit: a long text gets a smaller font than a short one and stays inside the sticky note', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.35, 0.35);
    await page.keyboard.type('Hi');
    await exitEdit(page);
    await clickEmpty(page);
    await page.waitForTimeout(300);
    const short = await fontOf(page, id);
    await openEditorOn(page, id);
    await page.keyboard.press(END);
    await page.keyboard.type(' — this sticky note now carries a much longer sentence that would not fit at the original size at all');
    await exitEdit(page);
    await clickEmpty(page);
    await expect(async () => {
      const long = await fontOf(page, id);
      expect(long.size, `авто: длинный текст мельче (${short.size} → ${long.size})`).toBeLessThan(short.size);
      expect(long.overflowY, 'текст не выходит за низ стикера').toBeLessThanOrEqual(1);
      expect(long.overflowX, 'текст не выходит за правый край').toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5000 });
    // второй клиент тоже подгоняет (наблюдение handoff: ±1–2 px)
    await expect(async () => {
      const g = await fontOf(guest.page, id);
      expect(g.size).toBeLessThan(short.size);
      expect(g.overflowY).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5000 });
    await untilObject(page, `board=${owner.boardId}`, id, (d) => expect(d.fields.fontSize ?? 'auto').toBe('auto'));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-02 manual font size: the size is kept whatever the text length, reaches another client and survives reload; Auto brings fitting back', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.35, 0.35);
    await page.keyboard.type('Short');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await setSel(page, 'Font size', '24');
    await expect.poll(async () => (await fontOf(page, id)).size).toBe(24);
    await openEditorOn(page, id);
    await page.keyboard.press(END);
    await page.keyboard.type(' plus some more words that are long enough');
    await exitEdit(page);
    await clickEmpty(page);
    await page.waitForTimeout(400);
    expect((await fontOf(page, id)).size, 'ручной размер не меняется от длины текста').toBe(24);
    await expect.poll(async () => (await fontOf(guest.page, id)).size).toBe(24);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => expect(Number(d.fields.fontSize)).toBe(24));
    await page.reload();
    await expect(obj(page, id)).toBeVisible();
    await expect.poll(async () => (await fontOf(page, id)).size).toBe(24);
    await selectObj(page, id);
    await setSel(page, 'Font size', 'Auto');
    await expect.poll(async () => (await fontOf(page, id)).size, 'Auto снова подгоняет').not.toBe(24);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => expect(d.fields.fontSize ?? 'auto').toBe('auto'));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-02 boundary: a very long text in auto mode stays inside the sticky note at a small but positive size', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const words = Array.from({ length: 30 }, (_, i) => `word${i}`).join(' ');
    await seed(page, owner.boardId, { 'qa-long': { type: 'sticky', x: 40, y: 40, width: 200, height: 200, fill: COLORS.Yellow, text: words } });
    await expect(async () => {
      const f = await fontOf(page, 'qa-long');
      expect(f.size).toBeGreaterThanOrEqual(6);
      expect(f.overflowY, 'текст помещается').toBeLessThanOrEqual(1);
    }).toPass({ timeout: 5000 });
  } finally {
    await owner.close();
  }
});

// ---------- STK-03 ----------

test('STK-03 tags are added and removed on a sticky note, shown on it, kept without # and reach another client after reload; empty and duplicate tags are not added', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.35, 0.35);
    await page.keyboard.type('Login fails');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await addTag(page, '#urgent');
    await addTag(page, 'backend', 'button');
    await addTag(page, 'urgent');
    await addTagField(page).fill('   ');
    await addTagField(page).press('Enter');
    await expect(canvasTags(page, id)).toHaveText(['urgent', 'backend']);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => expect(d.tags).toEqual({ yarray: ['urgent', 'backend'] }));
    await expect(canvasTags(guest.page, id)).toHaveText(['urgent', 'backend']);
    await tagsGroup(page).getByRole('button', { name: 'Remove tag backend', exact: true }).click();
    await expect(canvasTags(page, id)).toHaveText(['urgent']);
    await expect(canvasTags(guest.page, id)).toHaveText(['urgent']);
    await guest.page.reload();
    await expect(canvasTags(guest.page, id)).toHaveText(['urgent']);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => expect(d.tags).toEqual({ yarray: ['urgent'] }));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-03 CVS-22 sticky note shows its author: the user name for the owner, the entered name for a link participant; editing by another keeps the author', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token, 'Guest Mira');
  try {
    const mine = await placeSticky(owner.page, 0.3, 0.3);
    await owner.page.keyboard.type('owner note');
    await exitEdit(owner.page);
    await clickEmpty(owner.page);
    const theirs = await placeSticky(guest.page, 0.6, 0.5);
    await guest.page.keyboard.type('guest note');
    await exitEdit(guest.page);
    await clickEmpty(guest.page);
    for (const p of [owner.page, guest.page]) {
      await expect(author(p, mine)).toHaveText(owner.name);
      await expect(author(p, theirs)).toHaveText('Guest Mira');
    }
    // владелец правит стикер участника — автор не меняется
    await openEditorOn(owner.page, theirs);
    await owner.page.keyboard.press(END);
    await owner.page.keyboard.type(' edited');
    await exitEdit(owner.page);
    await expect(obj(guest.page, theirs)).toContainText('guest note edited');
    await expect(author(guest.page, theirs)).toHaveText('Guest Mira');
    await owner.page.reload();
    await expect(author(owner.page, theirs)).toHaveText('Guest Mira');
    await expect(author(owner.page, mine)).toHaveText(owner.name);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-03 the Show author switch hides and shows the author name for everyone (shown by default)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.35, 0.35);
    await page.keyboard.type('who wrote me');
    await exitEdit(page);
    await expect(author(page, id)).toBeVisible();
    await expect(author(guest.page, id)).toBeVisible();
    const sw = selectionBar(page).getByRole('switch', { name: 'Show author' });
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(author(page, id)).toBeHidden();
    await expect(author(guest.page, id)).toBeHidden();
    await sw.click();
    await expect(author(guest.page, id)).toHaveText(owner.name);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-03 COL-01 first tags added at the same time by two clients on a new sticky note are both kept', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const id = await placeSticky(owner.page, 0.35, 0.35);
    await owner.page.keyboard.type('shared');
    await exitEdit(owner.page);
    await expect(obj(guest.page, id)).toContainText('shared');
    await selectObj(guest.page, id);
    for (const p of [owner.page, guest.page]) {
      await tagsBtn(p).click();
      await expect(tagsGroup(p)).toBeVisible();
    }
    await addTagField(owner.page).fill('alpha');
    await addTagField(guest.page).fill('beta');
    // оба отправляют без ожидания друг друга: первый тег у обоих — на пустом массиве
    await Promise.all([addTagField(owner.page).press('Enter'), addTagField(guest.page).press('Enter')]);
    for (const p of [owner.page, guest.page]) {
      await expect(async () => {
        const t = (await canvasTags(p, id).allTextContents()).sort();
        expect(t).toEqual(['alpha', 'beta']);
      }).toPass({ timeout: 10_000 });
    }
    await untilObject(owner.page, `board=${owner.boardId}`, id, (d) => {
      const arr = (d.tags as { yarray?: string[] }).yarray ?? [];
      expect([...arr].sort()).toEqual(['alpha', 'beta']);
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-03 CVS-08 search finds a sticky note by a tag added in the interface', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.35, 0.35);
    await page.keyboard.type('Plain words');
    await exitEdit(page);
    await addTag(page, 'qasearchtag');
    await expect(canvasTags(page, id)).toHaveText(['qasearchtag']);
    await clickEmpty(page);
    await tools(page).getByRole('button', { name: 'Search', exact: true }).click();
    const panel = page.getByRole('search', { name: 'Search board' });
    await panel.getByLabel('Search text and tags').fill('#qasearchtag');
    const res = panel.getByRole('list', { name: 'Search results' }).getByRole('button');
    await expect(res).toHaveCount(1);
    await expect(res.first()).toContainText('qasearchtag');
    await res.first().click();
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await expect(obj(page, id)).toBeInViewport();
  } finally {
    await owner.close();
  }
});


test('STK-02 STK-03 auto fit keeps the text clear of the tags and author line at the bottom', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.35, 0.35);
    await page.keyboard.type('A fairly long sentence for the sticky note that needs a smaller font to fit together with its tags and author');
    await exitEdit(page);
    for (const t of ['design', 'backend', 'release-candidate']) await addTag(page, t);
    await clickEmpty(page);
    await page.waitForTimeout(400);
    const gap = await obj(page, id).evaluate((e) => {
      const rt = e.querySelector('.rich-text')!;
      const r = document.createRange();
      r.selectNodeContents(rt);
      const bottom = Math.max(...Array.from(r.getClientRects()).filter((x) => x.width > 0.5).map((x) => x.bottom));
      const footer = e.querySelector('.sticky-footer, [data-testid="sticky-author"]')!.getBoundingClientRect();
      const tags = e.querySelector('[aria-label="Tags"]')?.getBoundingClientRect();
      return { bottom, footerTop: Math.min(footer.top, tags?.top ?? Infinity), box: e.getBoundingClientRect().bottom, tagsBottom: tags?.bottom ?? 0 };
    });
    expect(gap.bottom, 'текст не заходит на строку тегов и автора').toBeLessThanOrEqual(gap.footerTop + 1);
    expect(gap.tagsBottom, 'теги внутри стикера').toBeLessThanOrEqual(gap.box + 1);
  } finally {
    await owner.close();
  }
});

test('STK-03 hostile tag text and participant name are shown as text and not executed; an over-long tag is cut to the limit', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const evil = '<img src=x onerror="window.__qa=1">';
  const guest = await guestOf(browser, o, owner.token, evil);
  try {
    const g = guest.page;
    const id = await placeSticky(g, 0.35, 0.35);
    await g.keyboard.type('xss');
    await exitEdit(g);
    await addTag(g, '<b onmouseover=alert(1)>x</b>');
    await addTag(g, 'y'.repeat(60));
    for (const p of [owner.page, g]) {
      await expect(author(p, id)).toHaveText(evil);
      await expect(obj(p, id).locator('img, b')).toHaveCount(0);
      expect(await p.evaluate(() => (window as unknown as { __qa?: number }).__qa)).toBeUndefined();
    }
    await untilObject(owner.page, `board=${owner.boardId}`, id, (d) => {
      const arr = (d.tags as { yarray?: string[] }).yarray ?? [];
      expect(arr).toContain('<b onmouseover=alert(1)>x</b>');
      expect(arr.every((t) => t.length <= 40), `теги не длиннее 40: ${arr.map((t) => t.length)}`).toBe(true);
    });
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-01 MOB-06 on a phone a color swatch dragged by finger onto the canvas creates a sticky note of that color', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await press(tool(page, 'Sticky note'), true);
    await expect(palette(page)).toBeVisible();
    const f = await Finger.of(page);
    const from = centerOf(await boxOf(swatch(page, 'Purple')));
    const to = await onCanvas(page, 0.5, 0.35);
    const before = new Set(await objectIds(page));
    await f.down(from);
    await f.hold(60);
    await f.moveTo(from, to, 14);
    await f.up();
    const id = await waitNew(page, before);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      expect(d.fields.type).toBe('sticky');
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Purple);
    });
  } finally {
    await owner.close();
  }
});

test('STK-02 auto fit follows a resize: a larger sticky note gets a larger font, a manual size does not change', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const text = 'Resize me so the words get more room to breathe here';
    await seed(page, owner.boardId, {
      'qa-auto': { type: 'sticky', x: 20, y: 20, width: 140, height: 140, fill: COLORS.Yellow, text },
      'qa-fixed': { type: 'sticky', x: 300, y: 20, width: 140, height: 140, fill: COLORS.Blue, text, fontSize: 14 },
    });
    await page.waitForTimeout(400);
    const a0 = (await fontOf(page, 'qa-auto')).size;
    expect((await fontOf(page, 'qa-fixed')).size).toBe(14);
    for (const id of ['qa-auto', 'qa-fixed']) {
      await selectObj(page, id);
      const h = centerOf(await boxOf(page.locator('[data-handle="se"]')));
      await dragMouse(page, h, { x: h.x + 120, y: h.y + 120 });
      await clickEmpty(page);
    }
    await expect.poll(async () => (await fontOf(page, 'qa-auto')).size, `авто растёт со стикером (было ${a0})`).toBeGreaterThan(a0);
    expect((await fontOf(page, 'qa-fixed')).size, 'ручной размер не меняется').toBe(14);
  } finally {
    await owner.close();
  }
});

// ---------- STK-04 ----------

test('STK-04 Tab while editing a sticky note creates the next sticky note next to it and moves typing there; Tab again makes a third', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const first = await placeSticky(page, 0.2, 0.3, 'Purple');
    await page.keyboard.type('first');
    let before = new Set(await objectIds(page));
    await page.keyboard.press('Tab');
    const second = await waitNew(page, before);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('second');
    before = new Set(await objectIds(page));
    await page.keyboard.press('Tab');
    const third = await waitNew(page, before);
    await page.keyboard.type('third');
    await exitEdit(page);
    const q = `board=${owner.boardId}`;
    const d1 = (await docObject(page, q, first))!;
    await untilObject(page, q, third, (d) => expect(d.text.trim()).toBe('third'));
    const d2 = (await docObject(page, q, second))!;
    const d3 = (await docObject(page, q, third))!;
    expect(d1.text.trim()).toBe('first');
    expect(d2.text.trim()).toBe('second');
    for (const d of [d1, d2, d3]) expect(d.tags, 'у нового стикера сразу пустой Y.Array тегов').toEqual({ yarray: [] });
    for (const d of [d2, d3]) {
      expect(d.fields.type).toBe('sticky');
      expect(String(d.fields.fill).toLowerCase(), 'тот же цвет (наблюдение)').toBe(COLORS.Purple);
    }
    const r = (d: DocObj) => d.fields as { x: number; y: number; width: number; height: number };
    // рядом и без перекрытия
    const overlap = (a: ReturnType<typeof r>, b: ReturnType<typeof r>) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap(r(d1), r(d2)), 'второй не перекрывает первый').toBe(false);
    expect(overlap(r(d2), r(d3)), 'третий не перекрывает второй').toBe(false);
    const gap = (a: ReturnType<typeof r>, b: ReturnType<typeof r>) => Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width), b.y - (a.y + a.height), a.y - (b.y + b.height));
    expect(gap(r(d1), r(d2)), 'второй рядом с первым').toBeLessThanOrEqual(r(d1).width / 2);
    expect(gap(r(d2), r(d3)), 'третий рядом со вторым').toBeLessThanOrEqual(r(d2).width / 2);
    await expect(obj(guest.page, third)).toContainText('third');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-04 Tab outside sticky note editing does not create a sticky note (selected sticky, text block editing)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const id = await placeSticky(page, 0.3, 0.3);
    await page.keyboard.type('only me');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    expect(await objectIds(page), 'Tab у выделенного стикера без правки').toEqual([id]);
    await clickEmpty(page);
    const before = new Set(await objectIds(page));
    await tool(page, 'Text').click();
    const p = await onCanvas(page, 0.6, 0.5);
    await page.mouse.click(p.x, p.y);
    await expect(editor(page)).toBeVisible();
    const t = await waitNew(page, before);
    await page.keyboard.type('- item');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    expect((await objectIds(page)).sort(), 'Tab в тексте стикер не создаёт').toEqual([id, t].sort());
    await exitEdit(page);
  } finally {
    await owner.close();
  }
});

test('STK-04 link participant creates the next sticky note with Tab; the owner sees both', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const g = guest.page;
    const a = await placeSticky(g, 0.3, 0.4);
    await g.keyboard.type('guest one');
    const before = new Set(await objectIds(g));
    await g.keyboard.press('Tab');
    const b = await waitNew(g, before);
    await g.keyboard.type('guest two');
    await exitEdit(g);
    await expect(obj(owner.page, a)).toContainText('guest one');
    await expect(obj(owner.page, b)).toContainText('guest two');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- STK-05 ----------

async function pullFrom(page: Page, stackId: string, to: Point): Promise<string> {
  const before = new Set(await objectIds(page));
  await dragMouse(page, centerOf(await boxOf(obj(page, stackId))), to);
  return waitNew(page, before);
}

test('STK-05 sticky stack with a color and tags: dragging from it puts sticky notes of its color and tags on the canvas; the stack stays', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const q = `board=${owner.boardId}`;
    const stack = await placeSticky(page, 0.25, 0.3, 'Orange', false, 'Sticky stack');
    await exitEdit(page).catch(() => undefined);
    await untilObject(page, q, stack, (d) => {
      expect(d.fields.type).toBe('stack');
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Orange);
    });
    await selectObj(page, stack);
    await addTag(page, 'sprint');
    await addTag(page, 'team-a');
    await expect(canvasTags(page, stack)).toHaveText(['sprint', 'team-a']);
    await clickEmpty(page);
    const stackBox = await boxOf(obj(page, stack));
    const P1 = await onCanvas(page, 0.6, 0.35);
    const s1 = await pullFrom(page, stack, P1);
    await exitEdit(page).catch(() => undefined);
    await clickEmpty(page);
    const P2 = await onCanvas(page, 0.6, 0.7);
    const s2 = await pullFrom(page, stack, P2);
    await exitEdit(page).catch(() => undefined);
    await clickEmpty(page);
    const after = await boxOf(obj(page, stack));
    close(after.x, stackBox.x, 0, 2);
    close(after.y, stackBox.y, 0, 2);
    for (const [id, P] of [[s1, P1], [s2, P2]] as const) {
      await untilObject(page, q, id, (d) => {
        expect(d.fields.type).toBe('sticky');
        expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Orange);
        expect(d.tags).toEqual({ yarray: ['sprint', 'team-a'] });
      });
      const c = centerOf(await boxOf(obj(page, id)));
      close(c.x, P.x, 0, 30);
      close(c.y, P.y, 0, 30);
      await expect(canvasTags(guest.page, id)).toHaveText(['sprint', 'team-a']);
    }
    // смена тегов и цвета стопки не меняет уже вытянутые стикеры
    await selectObj(page, stack);
    if (!(await tagsGroup(page).isVisible())) await tagsBtn(page).click();
    await tagsGroup(page).getByRole('button', { name: 'Remove tag team-a', exact: true }).click();
    await expect(canvasTags(page, stack)).toHaveText(['sprint']);
    const fill = selectionBar(page).getByRole('combobox', { name: 'Fill', exact: true });
    if (await fill.isVisible()) await fill.selectOption({ label: 'Blue' });
    await page.waitForTimeout(500);
    await untilObject(page, q, s1, (d) => {
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Orange);
      expect(d.tags).toEqual({ yarray: ['sprint', 'team-a'] });
    });
    await page.reload();
    await expect(obj(page, stack)).toBeVisible();
    await expect(canvasTags(page, s2)).toHaveText(['sprint', 'team-a']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('STK-05 link participant pulls a sticky note from a stack; the owner sees it with the stack color and tags', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const stack = await placeSticky(page, 0.25, 0.3, 'Green', false, 'Sticky stack');
    await exitEdit(page).catch(() => undefined);
    await selectObj(page, stack);
    await addTag(page, 'retro');
    await clickEmpty(page);
    const g = guest.page;
    await expect(canvasTags(g, stack)).toHaveText(['retro']);
    const id = await pullFrom(g, stack, await onCanvas(g, 0.6, 0.5));
    await exitEdit(g).catch(() => undefined);
    await expect(obj(page, id)).toBeVisible();
    expect(await obj(page, id).evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(hexRgb(COLORS.Green));
    await expect(canvasTags(page, id)).toHaveText(['retro']);
    await expect(author(page, id)).toHaveText('QA Guest');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- COL-01, CVS-07 ----------

test('COL-01 two clients type into one sticky note at the same time; both edits survive on both sides', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const id = await placeSticky(owner.page, 0.35, 0.35);
    await owner.page.keyboard.type('middle');
    await exitEdit(owner.page);
    await expect(obj(guest.page, id)).toContainText('middle');
    await openEditorOn(owner.page, id);
    await openEditorOn(guest.page, id);
    await owner.page.keyboard.press(END);
    await guest.page.keyboard.press(HOME);
    await Promise.all([owner.page.keyboard.type(' ownerend', { delay: 30 }), guest.page.keyboard.type('gueststart ', { delay: 30 })]);
    await exitEdit(owner.page);
    await exitEdit(guest.page);
    for (const p of [owner.page, guest.page]) await expect(obj(p, id)).toContainText('gueststart middle ownerend');
    await untilObject(owner.page, `board=${owner.boardId}`, id, (d) => expect(d.text.trim()).toBe('gueststart middle ownerend'));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 undo and redo of own sticky note creation, text and tag leave the other client sticky note alone', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const theirs = await placeSticky(guest.page, 0.65, 0.6);
    await guest.page.keyboard.type('guest keeps');
    await exitEdit(guest.page);
    await expect(obj(page, theirs)).toContainText('guest keeps');
    const mine = await placeSticky(page, 0.3, 0.3);
    await page.keyboard.type('mine');
    await exitEdit(page);
    await addTag(page, 'undoable');
    await expect(canvasTags(page, mine)).toHaveText(['undoable']);
    await clickEmpty(page);
    const undo = tools(page).getByRole('button', { name: 'Undo', exact: true });
    const redo = tools(page).getByRole('button', { name: 'Redo', exact: true });
    await undo.click();
    await expect(canvasTags(page, mine), 'первый Undo снимает тег').toHaveCount(0);
    let steps = 1;
    while ((await obj(page, mine).count()) > 0 && steps < 8) {
      await undo.click();
      await page.waitForTimeout(200);
      steps++;
    }
    await expect(obj(page, mine), `свой стикер отменён за ${steps} шагов`).toHaveCount(0);
    await expect(obj(guest.page, mine)).toHaveCount(0);
    for (const p of [page, guest.page]) await expect(obj(p, theirs)).toContainText('guest keeps');
    for (let i = 0; i < steps; i++) {
      await redo.click();
      await page.waitForTimeout(200);
    }
    await expect(obj(page, mine)).toContainText('mine');
    await expect(canvasTags(guest.page, mine)).toHaveText(['undoable']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 in a text block typing and deleting are separate undo steps: undo brings back the deleted characters', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const before = new Set(await objectIds(page));
    await tool(page, 'Text').click();
    const p = await onCanvas(page, 0.35, 0.35);
    await page.mouse.click(p.x, p.y);
    await expect(editor(page)).toBeVisible();
    const id = await waitNew(page, before);
    await page.keyboard.type('hello');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(editor(page)).toHaveText('hel');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor(page)).toHaveText('hello');
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(editor(page)).toHaveText('hel');
    await exitEdit(page);
    await expect(obj(page, id)).toContainText('hel');
  } finally {
    await owner.close();
  }
});

// ---------- UI, MOB, ARCH ----------

async function expectNeutralOrAccent(root: Locator, accent: string, what: string, skip = '.sticky-swatch-color') {
  const styles = await root.evaluate((r, skipSel) =>
    [r, ...Array.from(r.querySelectorAll('*'))].flatMap((e) => {
      if (e.matches(skipSel)) return [];
      const rect = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (rect.width < 1 || rect.height < 1 || cs.visibility === 'hidden' || cs.display === 'none') return [];
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') return [];
      if (e.tagName === 'OPTION') return [];
      const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0) || e.tagName === 'INPUT' || e.tagName === 'SELECT';
      const bw = Math.max(...['top', 'right', 'bottom', 'left'].map((s) => parseFloat(cs.getPropertyValue(`border-${s}-width`))));
      const out: { label: string; c: string }[] = [];
      const label = (e.getAttribute('aria-label') ?? (e.textContent ?? '').trim()).slice(0, 30);
      if (own) out.push({ label: `текст ${label}`, c: cs.color });
      if (bw > 0) out.push({ label: `рамка ${label}`, c: cs.borderTopColor });
      return out;
    }), skip);
  const ah = hsl(accent).h;
  for (const s of styles) {
    const v = rgba(s.c);
    const ok = !v || transparent(s.c) || (v[0] === v[1] && v[1] === v[2]) || (hsl(s.c).s > 0.25 && hueDist(hsl(s.c).h, ah) <= 12);
    expect.soft(ok, `${what}: ${s.label} ${s.c} — чистый серый или акцент`).toBe(true);
  }
}

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

test('UI-01 UI-03 sticky note palette and the tags row follow the common style; swatches show keyboard focus', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const accent = (await signature(page, page.getByRole('button', { name: 'Share', exact: true })))['background-color'];
    await tool(page, 'Sticky note').click();
    await expect(palette(page)).toBeVisible();
    await expectFloatingPanel(palette(page), 'палитра Sticky note color');
    await expectNeutralOrAccent(palette(page), accent, 'палитра Sticky note color');
    await swatch(page, 'Yellow').focus();
    await page.keyboard.press('Tab');
    const fo = await page.locator(':focus').evaluate((e) => { const cs = getComputedStyle(e); return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`; });
    expect.soft(/none\|0px\|none/.test(fo), `видимый фокус образца: ${fo}`).toBe(false);
    const p = await onCanvas(page, 0.35, 0.35);
    await page.mouse.click(p.x, p.y);
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('styled');
    await exitEdit(page);
    await addTag(page, 'look');
    await page.waitForTimeout(600); // переход цвета рамки поля в фокусе (промежуточные оттенки — не стиль), как в text.spec.ts
    await expectFloatingPanel(tagsGroup(page), 'строка Tags');
    await expectNeutralOrAccent(selectionBar(page), accent, 'панель Selection с Tags');
  } finally {
    await owner.close();
  }
});

test('UI-04 MOB-06 on a phone a sticky note is placed by tap in the chosen color; palette and tags row fit the screen with 44x44 targets', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
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
      for (const t of await root.locator('button, select, input, [role="switch"]').all()) {
        if (!(await t.isVisible())) continue;
        const tb = await boxOf(t);
        if (Math.round(tb.width) < 44 || Math.round(tb.height) < 44) small.push(`${what}: ${(await t.getAttribute('aria-label')) ?? (await t.textContent())?.trim()} ${Math.round(tb.width)}×${Math.round(tb.height)}`);
      }
    };
    await press(tool(page, 'Sticky note'), true);
    await expect(palette(page)).toBeVisible();
    await checkTargets(palette(page), 'палитра');
    const id = await placeSticky(page, 0.4, 0.4, 'Blue', true);
    await page.keyboard.type('phone');
    await exitEdit(page);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Blue);
      expect(d.text.trim()).toBe('phone');
    });
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await press(tagsBtn(page), true);
    await expect(tagsGroup(page)).toBeVisible();
    await addTagField(page).fill('mobile');
    await addTagField(page).press('Enter');
    await expect(canvasTags(page, id)).toHaveText(['mobile']);
    await tagsGroup(page).scrollIntoViewIfNeeded();
    await checkTargets(tagsGroup(page), 'строка Tags');
    const sw = await page.evaluate(() => document.documentElement.scrollWidth);
    expect.soft(sw, 'нет горизонтальной прокрутки').toBeLessThanOrEqual(vw + 1);
    expect.soft(small, 'цели меньше 44×44').toEqual([]);
  } finally {
    await owner.close();
  }
});

test('STK-05 MOB-06 on a phone a finger drag from a sticky stack pulls a sticky note of its color', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-stack': { type: 'stack', x: 20, y: 40, width: 120, height: 120, fill: COLORS.Pink } as Obj });

    const f = await Finger.of(page);
    const from = centerOf(await boxOf(obj(page, 'qa-stack')));
    const to = await onCanvas(page, 0.6, 0.7);
    const before = new Set(await objectIds(page));
    await f.down(from);
    await f.hold(60);
    await f.moveTo(from, to, 12);
    await f.up();
    const id = await waitNew(page, before);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      expect(d.fields.type).toBe('sticky');
      expect(String(d.fields.fill).toLowerCase()).toBe(COLORS.Pink);
    });
  } finally {
    await owner.close();
  }
});

test('ARCH creating, editing and tagging sticky notes sends no HTTP requests to /api and no localhost; everything survives a reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, optsOf({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = owner.page;
    const api: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api') && u.pathname !== '/api/ws' && r.resourceType() !== 'websocket') api.push(`${r.method()} ${u.pathname}`);
      expect(r.url()).not.toContain('localhost');
    });
    const id = await placeSticky(page, 0.3, 0.3, 'Green');
    await page.keyboard.type('arch');
    await page.keyboard.press('Tab');
    await page.keyboard.type('next');
    await exitEdit(page);
    await addTag(page, 'arch');
    await setSel(page, 'Font size', '18');
    await page.waitForTimeout(500);
    expect(api, 'нет HTTP-запросов к /api при работе со стикерами').toEqual([]);
    await page.reload();
    await expect(obj(page, id)).toContainText('arch');
    await expect(canvas(page)).toBeVisible();
    expect((await objectIds(page)).length).toBe(2);
  } finally {
    await owner.close();
  }
});
