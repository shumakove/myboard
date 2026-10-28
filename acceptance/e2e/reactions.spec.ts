// Приёмка T6.11 · реакции, флип-карточки, кубик: RCT-01…04, FLP-01…03, DICE-01…03; попутно MOB-01, SHR-04, ARCH.
// Сценарии — docs/qa/reports/T6.11.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.11.
// Наблюдение: DOM холста и панели, документ доски глазами позднего клиента по /api/ws, второй клиент.
// Код из apps/ не импортируется.
import type { Browser, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { docSeenByLateClient, dragBy, openGuest, openOwner, profileOpts, type Opts, type Point } from './camera';
import { boxOf, centerOf, obj, onCanvas, seed, selectionBar, Finger, type Obj } from './scene';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(240_000));
test.use({ actionTimeout: 15_000 });

// ---------- интерфейс (подписи из handoff T6.11) ----------

const reactionsBar = (page: Page) => page.getByRole('toolbar', { name: 'Reactions' });
const reactions = (page: Page) => page.locator('[data-object-id][data-type="reaction"]');
const flipcards = (page: Page) => page.locator('[data-object-id][data-type="flipcard"]');
const dice = (page: Page) => page.locator('[data-object-id][data-type="dice"]');
const barBtn = (page: Page, name: string) => selectionBar(page).getByRole('button', { name, exact: true });
const barSelect = (page: Page, name: string) => selectionBar(page).locator('select').and(selectionBar(page).getByLabel(name)).first();

const STICKY: Obj = { type: 'sticky', x: 60, y: 60, width: 160, height: 160, fill: '#fff59d', text: 'QA sticky' };
const DIE = (x: number, faces: number, value: number | null): Obj => ({ type: 'dice', x, y: 300, width: 96, height: 96, faces, value, roll: value === null ? 0 : 1, fill: '#ffffff' });

type Raw = Record<string, Record<string, unknown>>;
const rawObjects = async (page: Page, boardId: string) => (await docSeenByLateClient(page, `board=${boardId}`)).getMap('objects').toJSON() as Raw;
async function untilRaw(page: Page, boardId: string, check: (o: Raw) => void, timeout = 15_000): Promise<Raw> {
  let last: Raw = {};
  await expect(async () => {
    last = await rawObjects(page, boardId);
    check(last);
  }).toPass({ timeout, intervals: [300, 600, 1000] });
  return last;
}
const ofType = (o: Raw, t: string) => Object.entries(o).filter(([, v]) => v.type === t);
const ids = async (l: ReturnType<Page['locator']>) => (await l.evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();

async function ownerAndGuest(browser: Browser, f: Fx, items: Record<string, Obj>, guestName = 'QA Guest') {
  const o = profileOpts(f);
  const owner = await openOwner(browser, o);
  await seed(owner.page, owner.boardId, items);
  const guest = await openGuest(browser, o, owner.token, guestName);
  for (const id of Object.keys(items)) await expect(obj(guest.page, id)).toBeAttached();
  return { owner, guest, opts: o };
}

/** Инструмент «Реакция» (U), выбор изображения на вкладке. */
async function reactionTool(page: Page, image = 'Heart reaction', tab = 'Emotions') {
  await page.keyboard.press('Escape');
  await page.mouse.move(5, 5);
  await page.keyboard.press('u');
  await expect(reactionsBar(page)).toBeVisible();
  await reactionsBar(page).getByRole('tab', { name: tab, exact: true }).click();
  const b = reactionsBar(page).getByRole('button', { name: image, exact: true });
  await b.click();
  await expect(b).toHaveAttribute('aria-pressed', 'true');
}

/** Поставить реакцию щелчком в точке; вернуть id новой реакции. */
async function placeReaction(page: Page, p: Point, holdMs = 0): Promise<string> {
  const before = new Set(await ids(reactions(page)));
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  if (holdMs) await page.waitForTimeout(holdMs);
  await page.mouse.up();
  await expect.poll(async () => (await ids(reactions(page))).filter((x) => !before.has(x)).length).toBe(1);
  return (await ids(reactions(page))).find((x) => !before.has(x))!;
}

/** Создать объект инструментом по клавише щелчком в точке холста; вернуть id. */
async function createBy(page: Page, key: string, list: ReturnType<Page['locator']>, p: Point): Promise<string> {
  const before = new Set(await ids(list));
  await page.keyboard.press('Escape');
  await page.mouse.move(p.x, p.y);
  await page.keyboard.press(key);
  await page.mouse.click(p.x, p.y);
  await expect.poll(async () => (await ids(list)).filter((x) => !before.has(x)).length).toBe(1);
  return (await ids(list)).find((x) => !before.has(x))!;
}

async function selectOnly(page: Page, idsToSelect: string[]) {
  await page.keyboard.press('Escape');
  for (let i = 0; i < idsToSelect.length; i++) {
    const b = await boxOf(obj(page, idsToSelect[i]));
    if (i > 0) await page.keyboard.down('Shift');
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.7);
    if (i > 0) await page.keyboard.up('Shift');
  }
  for (const id of idsToSelect) await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

const rel = async (page: Page, child: string, parent: string) => {
  const c = await boxOf(obj(page, child));
  const p = await boxOf(obj(page, parent));
  return { x: c.x - p.x, y: c.y - p.y };
};
const near = (a: Point, b: Point, tol = 3) => {
  expect(Math.abs(a.x - b.x), `x ${a.x} ≈ ${b.x}`).toBeLessThanOrEqual(tol);
  expect(Math.abs(a.y - b.y), `y ${a.y} ≈ ${b.y}`).toBeLessThanOrEqual(tol);
};

/** PNG заданного размера, нарисованный в браузере. */
async function pngOf(page: Page, w: number, h: number, color: string): Promise<Buffer> {
  const b64 = await page.evaluate(
    ({ w, h, color }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d')!;
      g.fillStyle = color;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#000';
      g.fillRect(0, 0, w / 4, h / 4);
      return c.toDataURL('image/png').split(',')[1];
    },
    { w, h, color },
  );
  return Buffer.from(b64, 'base64');
}

// ---------- RCT-01 ----------

test('RCT-01 reaction stamped on an object moves with it (own client, second client, reload); participant stamps on owner object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { 'qa-s': STICKY });
  const page = owner.page;
  try {
    const sb = await boxOf(obj(page, 'qa-s'));
    await reactionTool(page, 'Heart reaction');
    const r1 = await placeReaction(page, { x: sb.x + sb.width * 0.75, y: sb.y + sb.height * 0.25 });
    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[r1]?.parent).toBe('qa-s'));
    expect(doc[r1].type).toBe('reaction');

    // участник по ссылке ставит реакцию на объект владельца
    const gb = await boxOf(obj(guest.page, 'qa-s'));
    await reactionTool(guest.page, 'Thumbs up reaction');
    const r2 = await placeReaction(guest.page, { x: gb.x + gb.width * 0.25, y: gb.y + gb.height * 0.75 });
    await expect(obj(page, r2)).toBeVisible();
    await untilRaw(page, owner.boardId, (o) => expect(o[r2]?.parent).toBe('qa-s'));

    const before1 = await rel(page, r1, 'qa-s');
    const before2 = await rel(page, r2, 'qa-s');
    const absBefore = await boxOf(obj(guest.page, r1));
    near(await rel(guest.page, r1, 'qa-s'), before1);

    // владелец двигает стикер
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const s = await boxOf(obj(page, 'qa-s'));
    // за середину стикера (по углам стоят реакции; отдельно реакция не перетаскивается — наблюдение)
    await dragBy(page, centerOf(s), { x: 180, y: 90 });
    await expect.poll(async () => (await boxOf(obj(guest.page, 'qa-s'))).x).toBeGreaterThan(gb.x + 100);
    near(await rel(page, r1, 'qa-s'), before1);
    near(await rel(page, r2, 'qa-s'), before2);
    await expect.poll(async () => (await boxOf(obj(guest.page, r1))).x - absBefore.x).toBeGreaterThan(100);
    near(await rel(guest.page, r1, 'qa-s'), before1);
    near(await rel(guest.page, r2, 'qa-s'), before2);

    // после перезагрузки
    await guest.page.reload();
    await expect(obj(guest.page, r1)).toBeVisible();
    near(await rel(guest.page, r1, 'qa-s'), before1);
    near(await rel(guest.page, r2, 'qa-s'), before2);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('RCT-01 boundary: several reactions on one object; deleting the object leaves no orphan reaction; empty canvas (observation)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const owner = await openOwner(browser, o);
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { 'qa-s': STICKY });
    const sb = await boxOf(obj(page, 'qa-s'));
    await reactionTool(page, 'Party reaction');
    const a = await placeReaction(page, { x: sb.x + 40, y: sb.y + 40 });
    const b = await placeReaction(page, { x: sb.x + 110, y: sb.y + 110 });
    expect(a).not.toBe(b);

    // пустой холст — наблюдение
    const empty = await onCanvas(page, 0.75, 0.75);
    await page.mouse.click(empty.x, empty.y);
    await page.waitForTimeout(600);
    const onEmpty = (await ids(reactions(page))).length - 2;
    test.info().annotations.push({ type: 'observation', description: `реакций на пустом холсте после щелчка: ${onEmpty}` });

    // удаление объекта
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(sb.x + 20, sb.y + sb.height - 20);
    await expect(obj(page, 'qa-s')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(obj(page, 'qa-s')).toHaveCount(0);
    await expect(obj(page, a)).toHaveCount(0);
    await expect(obj(page, b)).toHaveCount(0);
    const doc = await untilRaw(page, owner.boardId, (x) => expect(x['qa-s']).toBeUndefined());
    expect(doc[a], 'реакция удалённого объекта не висит в objects').toBeUndefined();
    expect(doc[b]).toBeUndefined();
  } finally {
    await owner.close();
  }
});

// ---------- RCT-02 ----------

test('RCT-02 hovering a reaction shows who stamped it: participant name at owner, owner name at participant', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { 'qa-s': STICKY }, 'Guest Ann');
  try {
    const sb = await boxOf(obj(owner.page, 'qa-s'));
    await reactionTool(owner.page, 'Heart reaction');
    const mine = await placeReaction(owner.page, { x: sb.x + 40, y: sb.y + 40 });
    const gb = await boxOf(obj(guest.page, 'qa-s'));
    await reactionTool(guest.page, 'Thumbs up reaction');
    const theirs = await placeReaction(guest.page, { x: gb.x + 120, y: gb.y + 120 });

    for (const [p, id, who] of [
      [owner.page, theirs, 'Guest Ann'],
      [guest.page, mine, owner.name],
    ] as const) {
      await p.keyboard.press('Escape');
      await p.keyboard.press('v');
      await p.mouse.move(5, 5);
      await expect(obj(p, id)).toBeVisible();
      await obj(p, id).hover();
      const tip = p.getByRole('tooltip').filter({ hasText: who });
      await expect(tip).toBeVisible();
      await expect(tip).toContainText(who);
    }
    // у владельца над чужой реакцией не его имя
    await owner.page.mouse.move(5, 5);
    await obj(owner.page, theirs).hover();
    await expect(owner.page.getByRole('tooltip').filter({ hasText: owner.name })).toHaveCount(0);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- RCT-03 ----------

test('RCT-03 holding the mouse button grows the reaction, release stops; short click gives normal size; size persists for second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { 'qa-s': { ...STICKY, width: 320, height: 320 } });
  const page = owner.page;
  try {
    const sb = await boxOf(obj(page, 'qa-s'));
    await reactionTool(page, 'Heart reaction');
    const small = await placeReaction(page, { x: sb.x + 40, y: sb.y + 40 });

    // удержание: размер растёт во время удержания
    const p = { x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 };
    const before = new Set(await ids(reactions(page)));
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    const sizes: number[] = [];
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(250);
      const d = page.getByTestId('reaction-draft');
      sizes.push((await d.count()) ? (await boxOf(d)).width : 0);
    }
    await page.mouse.up();
    expect(sizes[sizes.length - 1], `размеры при удержании ${sizes}`).toBeGreaterThan(sizes[1] + 20);
    await expect.poll(async () => (await ids(reactions(page))).filter((x) => !before.has(x)).length).toBe(1);
    const big = (await ids(reactions(page))).find((x) => !before.has(x))!;
    const bigW = (await boxOf(obj(page, big))).width;
    const smallW = (await boxOf(obj(page, small))).width;
    expect(bigW, 'выросшая реакция больше обычной').toBeGreaterThan(smallW * 1.5);
    // после отпускания рост прекращается
    await page.waitForTimeout(800);
    expect(Math.abs((await boxOf(obj(page, big))).width - bigW)).toBeLessThanOrEqual(1);

    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[big]).toBeTruthy());
    expect(Number(doc[big].width)).toBeGreaterThan(Number(doc[small].width) * 1.5);

    // второй клиент и перезагрузка: соотношение размеров то же
    const ratio = bigW / smallW;
    await expect(obj(guest.page, big)).toBeVisible();
    const g = (await boxOf(obj(guest.page, big))).width / (await boxOf(obj(guest.page, small))).width;
    expect(Math.abs(g - ratio)).toBeLessThan(0.1);
    await page.reload();
    await expect(obj(page, big)).toBeVisible();
    const r = (await boxOf(obj(page, big))).width / (await boxOf(obj(page, small))).width;
    expect(Math.abs(r - ratio)).toBeLessThan(0.1);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('RCT-03 MOB-01 holding a finger grows the reaction on a phone', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { 'qa-s': { ...STICKY, x: 20, y: 20, width: 200, height: 200 } });
    // инструмент — через список всех инструментов (клавиатуры на телефоне нет)
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /All tools/ }).click();
    await page.getByRole('button', { name: /^Reaction/ }).first().click();
    await expect(reactionsBar(page)).toBeVisible();
    await reactionsBar(page).getByRole('tab', { name: 'Emotions', exact: true }).click();
    await reactionsBar(page).getByRole('button', { name: 'Heart reaction', exact: true }).click();
    const sb = await boxOf(obj(page, 'qa-s'));
    const f = await Finger.of(page);
    const tapAt = { x: sb.x + sb.width * 0.25, y: sb.y + sb.height * 0.25 };
    await f.down(tapAt);
    await f.up();
    await expect(reactions(page)).toHaveCount(1);
    const small = (await ids(reactions(page)))[0];
    const holdAt = { x: sb.x + sb.width * 0.7, y: sb.y + sb.height * 0.4 };
    await f.down(holdAt);
    await f.hold(1500);
    await f.up();
    await expect(reactions(page)).toHaveCount(2);
    const big = (await ids(reactions(page))).find((x) => x !== small)!;
    expect((await boxOf(obj(page, big))).width).toBeGreaterThan((await boxOf(obj(page, small))).width * 1.5);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sw, 'без горизонтальной прокрутки').toBeLessThanOrEqual(1);
  } finally {
    await owner.close();
  }
});

// ---------- RCT-04 ----------

test('RCT-04 several image sets for reactions; recently used appear in Recent (latest first, no duplicates)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { 'qa-s': { ...STICKY, width: 300, height: 300 } });
    await page.mouse.move(5, 5);
    await page.keyboard.press('u');
    const bar = reactionsBar(page);
    await expect(bar).toBeVisible();
    const sets: Record<string, string[]> = {};
    for (const tab of ['Emotions', 'Votes', 'Stamps']) {
      await bar.getByRole('tab', { name: tab, exact: true }).click();
      sets[tab] = await bar.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '').filter((x) => x.endsWith(' reaction')));
      expect(sets[tab].length, `набор ${tab}`).toBeGreaterThan(1);
    }
    expect(new Set(sets.Votes).size).toBe(sets.Votes.length);
    expect(sets.Emotions).not.toEqual(sets.Votes);
    expect(sets.Votes).not.toEqual(sets.Stamps);

    const sb = await boxOf(obj(page, 'qa-s'));
    const use = async (tab: string, name: string, k: number) => {
      await reactionTool(page, name, tab);
      await placeReaction(page, { x: sb.x + 40 + k * 50, y: sb.y + 60 });
    };
    await use('Votes', sets.Votes[0], 0);
    await use('Stamps', sets.Stamps[1], 1);
    await use('Votes', sets.Votes[0], 2);
    if (!(await bar.isVisible())) await page.keyboard.press('u');
    await expect(bar).toBeVisible();
    await bar.getByRole('tab', { name: 'Recent', exact: true }).click();
    const recent = await bar.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '').filter((x) => x.endsWith(' reaction')));
    expect(recent.slice(0, 2)).toEqual([sets.Votes[0], sets.Stamps[1]]);
    expect(new Set(recent).size, 'без дублей').toBe(recent.length);
    // недавние переживают перезагрузку (наблюдение — хранятся в браузере)
    await page.reload();
    await expect(obj(page, 'qa-s')).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(async () => {
      await page.keyboard.press('u');
      await expect(reactionsBar(page)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await reactionsBar(page).getByRole('tab', { name: 'Recent', exact: true }).click();
    const after = await reactionsBar(page).getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? '').filter((x) => x.endsWith(' reaction')));
    test.info().annotations.push({ type: 'observation', description: `Recent после перезагрузки: ${after.join(', ')}` });
  } finally {
    await owner.close();
  }
});

// ---------- FLP-01 / FLP-03 ----------

test('FLP-01 FLP-03 flip card: front and back text, image on a side, flip direction, per-side font size and style; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { 'qa-s': STICKY });
  const page = owner.page;
  try {
    const card = await createBy(page, 'h', flipcards(page), await onCanvas(page, 0.45, 0.65));
    await expect(obj(page, card)).toHaveAttribute('data-side', 'front');
    await expect(barBtn(page, 'Flip')).toBeVisible();

    // лицевая сторона: текст, размер, жирный
    await barBtn(page, 'Edit text').click();
    const ta = page.getByRole('textbox', { name: 'Flip card side text' });
    await ta.fill('Front QA');
    await page.keyboard.press('Escape');
    await selectOnly(page, [card]);
    await barSelect(page, 'Font size').selectOption('36');
    await barSelect(page, 'Style').selectOption({ label: 'Bold' });
    await barSelect(page, 'Flip direction').selectOption({ label: 'Vertical' });
    // картинка на лицевой стороне
    const png = await pngOf(page, 1200, 800, '#e53935');
    await selectionBar(page).getByLabel('Side image').setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: png });
    await expect(obj(page, card).locator('.flip-face[data-side="front"] img')).toBeVisible();

    // переворот, оборот: текст, размер, курсив
    await barBtn(page, 'Flip').click();
    await expect(obj(page, card)).toHaveAttribute('data-side', 'back');
    await expect(selectionBar(page).getByText('Back side', { exact: true })).toBeVisible();
    await barBtn(page, 'Edit text').click();
    await page.getByRole('textbox', { name: 'Flip card side text' }).fill('Back QA');
    await page.keyboard.press('Escape');
    await selectOnly(page, [card]);
    await barSelect(page, 'Font size').selectOption('14');
    await barSelect(page, 'Style').selectOption({ label: 'Italic' });

    const doc = await untilRaw(page, owner.boardId, (o) => {
      expect(o[card]?.text).toBe('Front QA');
      expect(o[card]?.backText).toBe('Back QA');
      expect(o[card]?.flipped).toBe(true);
      expect(o[card]?.direction).toBe('vertical');
      expect(o[card]?.frontFontSize).toBe(36);
      expect(o[card]?.backFontSize).toBe(14);
    });
    expect(doc[card].frontFontStyle).not.toBe(doc[card].backFontStyle);
    test.info().annotations.push({ type: 'observation', description: `frontImage: ${String(doc[card].frontImage).slice(0, 30)}… (${String(doc[card].frontImage).length} символов); backImage: ${doc[card].backImage}` });

    // второй клиент и перезагрузка: стороны, направление, картинка только на лице, оформление сторон
    for (const p of [guest.page, page]) {
      if (p === page) await p.reload();
      const c = obj(p, card);
      await expect(c).toHaveAttribute('data-side', 'back');
      await expect(c.locator('.flip-inner')).toHaveAttribute('data-direction', 'vertical');
      const front = c.locator('.flip-face[data-side="front"]');
      const back = c.locator('.flip-face[data-side="back"]');
      await expect(front).toContainText('Front QA');
      await expect(back).toContainText('Back QA');
      await expect(front.locator('img')).toHaveCount(1);
      await expect(back.locator('img')).toHaveCount(0);
      const style = async (l: typeof front) =>
        l.evaluate((e) => {
          const t = [...e.querySelectorAll('*')].find((n) => n.textContent?.trim() && !n.children.length) ?? e;
          const s = getComputedStyle(t);
          return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), italic: s.fontStyle === 'italic' };
        });
      const fs = await style(front);
      const bs = await style(back);
      expect(fs.size / bs.size, `лицо ${fs.size}, оборот ${bs.size}`).toBeCloseTo(36 / 14, 0);
      expect(fs.weight).toBeGreaterThanOrEqual(600);
      expect(fs.italic).toBe(false);
      expect(bs.italic).toBe(true);
      expect(bs.weight).toBeLessThan(600);
    }

    // направление: Horizontal — поворот вокруг вертикальной оси (наблюдение по transform)
    const t = await obj(guest.page, card).locator('.flip-inner').evaluate((e) => getComputedStyle(e).transform);
    test.info().annotations.push({ type: 'observation', description: `transform перевёрнутой (vertical): ${t}` });
    expect(t).not.toBe('none');
  } finally {
    await guest.close();
    await owner.close();
  }
});

// Q-006 (ожидает ответа владельца): по ARCHITECTURE.md, раздел 6 «Файлы», файл лежит в MEDIA_ROOT и отдаётся по
// /api/media/{id}; в dev/T6.11 картинка стороны — data URL в документе. Тест фиксирует фактическое хранение и
// неоспоримое (картинка ограничена 640 px, видна только на своей стороне); проверка /api/media — после ответа.
test('FLP-01 ARCH side image storage (Q-006): image stays bounded and is delivered with the board document', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const card = await createBy(page, 'h', flipcards(page), await onCanvas(page, 0.45, 0.65));
    const png = await pngOf(page, 2400, 1600, '#43a047');
    await selectionBar(page).getByLabel('Side image').setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: png });
    const img = obj(page, card).locator('.flip-face[data-side="front"] img');
    await expect(img).toBeVisible();
    const src = (await img.getAttribute('src')) ?? '';
    const doc = await untilRaw(page, owner.boardId, (o) => expect(o[card]?.frontImage).toBeTruthy());
    const stored = String(doc[card].frontImage);
    const natural = await img.evaluate((e) => [(e as HTMLImageElement).naturalWidth, (e as HTMLImageElement).naturalHeight]);
    test.info().annotations.push({ type: 'observation', description: `src: ${src.slice(0, 30)}…; frontImage в документе: ${stored.slice(0, 30)}… (${stored.length} символов, исходный PNG ${png.length} байт); размер ${natural.join('×')}` });
    if (src.startsWith('data:')) {
      expect(Math.max(...natural), 'картинка в документе уменьшена до 640 px').toBeLessThanOrEqual(640);
      expect(stored).toBe(src);
    } else {
      expect(src).toMatch(/\/api\/media\//);
    }
    expect(doc[card].backImage ?? null).toBeNull();
  } finally {
    await owner.close();
  }
});

// ---------- FLP-02 ----------

test('FLP-02 flip one card (button and corner toggle) and all selected cards at once; other objects untouched; participant flips, owner sees', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { 'qa-s': { ...STICKY, x: 20, y: 20, width: 100, height: 100 } });
  const page = owner.page;
  try {
    const a = await createBy(page, 'h', flipcards(page), await onCanvas(page, 0.3, 0.55));
    const b = await createBy(page, 'h', flipcards(page), await onCanvas(page, 0.55, 0.55));
    const c = await createBy(page, 'h', flipcards(page), await onCanvas(page, 0.3, 0.85));
    for (const id of [a, b, c]) await expect(obj(guest.page, id)).toHaveAttribute('data-side', 'front');

    // одна карточка — кнопкой Flip
    await selectOnly(page, [a]);
    await barBtn(page, 'Flip').click();
    await expect(obj(page, a)).toHaveAttribute('data-side', 'back');
    await expect(obj(guest.page, a)).toHaveAttribute('data-side', 'back');
    await expect(obj(page, b)).toHaveAttribute('data-side', 'front');

    // одна карточка — кнопкой в углу у участника
    await guest.page.keyboard.press('Escape');
    await obj(guest.page, b).hover();
    await obj(guest.page, b).locator('button[data-flip-toggle]').click();
    await expect(obj(guest.page, b)).toHaveAttribute('data-side', 'back');
    await expect(obj(page, b)).toHaveAttribute('data-side', 'back');

    // все выделенные разом (с не-карточкой в выделении)
    await selectOnly(page, [a, b, c, 'qa-s']);
    const all = selectionBar(page).getByRole('button', { name: /^Flip all/ });
    await expect(all).toBeVisible();
    const sticky0 = (await rawObjects(page, owner.boardId))['qa-s'];
    await all.click();
    const sides = async (p: Page) => Promise.all([a, b, c].map((id) => obj(p, id).getAttribute('data-side')));
    const after = await sides(page);
    test.info().annotations.push({ type: 'observation', description: `стороны после Flip all (было back, back, front): ${after.join(', ')}` });
    expect(after, 'каждая выделенная карточка перевернулась').toEqual(['front', 'front', 'back']);
    await expect.poll(() => sides(guest.page)).toEqual(['front', 'front', 'back']);
    const doc = await rawObjects(page, owner.boardId);
    expect({ ...doc['qa-s'] }).toEqual({ ...sticky0 });

    await guest.page.reload();
    await expect.poll(() => sides(guest.page)).toEqual(['front', 'front', 'back']);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- DICE-01 ----------

test('DICE-01 dice with 4, 6, 8, 10, 12 or 20 faces and color; second client and reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { 'qa-s': STICKY });
  const page = owner.page;
  try {
    const d = await createBy(page, 'x', dice(page), await onCanvas(page, 0.5, 0.7));
    const opts = await barSelect(page, 'Faces').evaluate((e) => [...(e as HTMLSelectElement).options].map((o) => o.value));
    expect(opts).toEqual(['4', '6', '8', '10', '12', '20']);
    for (const n of ['4', '8', '10', '12', '20']) {
      await barSelect(page, 'Faces').selectOption(n);
      await expect(obj(page, d)).toHaveAttribute('aria-label', new RegExp(`^Dice d${n}:`));
      await expect(obj(guest.page, d)).toHaveAttribute('aria-label', new RegExp(`^Dice d${n}:`));
    }
    const bg0 = await obj(guest.page, d).locator('.dice-body').evaluate((e) => getComputedStyle(e).backgroundColor);
    await barSelect(page, 'Fill').selectOption({ label: 'Purple' });
    await expect.poll(() => obj(guest.page, d).locator('.dice-body').evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(bg0);
    const bg = await obj(guest.page, d).locator('.dice-body').evaluate((e) => getComputedStyle(e).backgroundColor);
    await guest.page.reload();
    await expect(obj(guest.page, d)).toHaveAttribute('aria-label', /^Dice d20:/);
    expect(await obj(guest.page, d).locator('.dice-body').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(bg);
    const doc = await rawObjects(page, owner.boardId);
    expect(doc[d].faces).toBe(20);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- DICE-02 ----------

test('DICE-02 many rolls stay within 1…N and reach both extremes (d4, d6, d20)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { d4: DIE(20, 4, null), d6: DIE(140, 6, null), d20: DIE(260, 20, null) });
    await expect(obj(page, 'd6')).toHaveAttribute('aria-label', 'Dice d6: not rolled');
    for (const [id, n, rolls] of [
      ['d4', 4, 80],
      ['d6', 6, 100],
      ['d20', 20, 300],
    ] as const) {
      await selectOnly(page, [id]);
      const roll = barBtn(page, 'Roll');
      const seen: number[] = [];
      for (let i = 0; i < rolls; i++) {
        await roll.click();
        const label = (await obj(page, id).getAttribute('aria-label')) ?? '';
        const m = label.match(/^Dice d(\d+): (\d+)$/);
        expect(m, label).not.toBeNull();
        seen.push(Number(m![2]));
      }
      const bad = seen.filter((v) => !Number.isInteger(v) || v < 1 || v > n);
      expect(bad, `d${n}: значения вне 1…${n}`).toEqual([]);
      const uniq = [...new Set(seen)].sort((x, y) => x - y);
      test.info().annotations.push({ type: 'observation', description: `d${n}: ${rolls} бросков, значения ${uniq.join(',')}` });
      expect(uniq[0]).toBe(1);
      expect(uniq[uniq.length - 1]).toBe(n);
      if (n <= 6) expect(uniq.length).toBe(n);
      // счётчик бросков в документе вырос на число бросков — каждое нажатие давало бросок
      const doc = await untilRaw(page, owner.boardId, (o) => expect(Number(o[id]?.roll)).toBeGreaterThanOrEqual(rolls));
      expect(doc[id].value).toBe(seen[seen.length - 1]);
    }
  } finally {
    await owner.close();
  }
});

test('DICE-02 rolled value is the same for the participant and after reload; simultaneous rolls by two clients converge to one value', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, { qd: DIE(100, 20, null) });
  try {
    const label = (p: Page) => obj(p, 'qd').getAttribute('aria-label');
    // бросок участника виден владельцу
    await selectOnly(guest.page, ['qd']);
    await barBtn(guest.page, 'Roll').click();
    const v = await label(guest.page);
    expect(v).toMatch(/^Dice d20: \d+$/);
    await expect.poll(() => label(owner.page)).toBe(v);

    // одновременные броски: 10 попыток
    for (let i = 0; i < 10; i++) {
      await selectOnly(owner.page, ['qd']);
      await selectOnly(guest.page, ['qd']);
      await Promise.all([barBtn(owner.page, 'Roll').click(), barBtn(guest.page, 'Roll').click()]);
      await expect.poll(async () => (await label(owner.page)) === (await label(guest.page)), { timeout: 10_000 }).toBe(true);
      const l = await label(owner.page);
      const doc = await untilRaw(owner.page, owner.boardId, (o) => expect(`Dice d20: ${o.qd?.value}`).toBe(l));
      expect(Number(doc.qd.value)).toBeGreaterThanOrEqual(1);
    }
    const final = await label(owner.page);
    await guest.page.reload();
    await expect(obj(guest.page, 'qd')).toHaveAttribute('aria-label', final!);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- DICE-03 ----------

test('DICE-03 several selected dice show the sum of last values; recalculated after a roll; non-dice ignored', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const { owner, guest } = await ownerAndGuest(browser, { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }, {
    a: DIE(20, 6, 3),
    b: DIE(140, 20, 17),
    c: DIE(260, 8, 5),
    'qa-s': { ...STICKY, x: 20, y: 20, width: 100, height: 100 },
  });
  const page = owner.page;
  try {
    const sum = selectionBar(page).locator('output.dice-sum');
    await selectOnly(page, ['a']);
    test.info().annotations.push({ type: 'observation', description: `сумма у одного кубика: ${(await sum.count()) ? await sum.innerText() : 'нет'}` });
    await selectOnly(page, ['a', 'b']);
    await expect(sum).toHaveText(/Sum:\s*20$/);
    await selectOnly(page, ['a', 'b', 'c', 'qa-s']);
    await expect(sum).toHaveText(/Sum:\s*25$/);

    const value = async (p: Page, id: string) => Number(((await obj(p, id).getAttribute('aria-label')) ?? '').split(': ')[1]);
    // повторный бросок одного кубика другим участником — сумма пересчитана
    for (let i = 0; i < 3; i++) {
      await selectOnly(guest.page, ['b']);
      await barBtn(guest.page, 'Roll').click();
      const vb = await value(guest.page, 'b');
      await expect.poll(() => value(page, 'b')).toBe(vb);
      await expect(sum).toHaveText(new RegExp(`Sum:\\s*${3 + vb + 5}$`));
    }
    // Roll all
    await selectionBar(page).getByRole('button', { name: /^Roll all/ }).click();
    const total = (await value(page, 'a')) + (await value(page, 'b')) + (await value(page, 'c'));
    await expect(sum).toHaveText(new RegExp(`Sum:\\s*${total}$`));
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- MOB-01 ----------

test('MOB-01 FLP-02 DICE-02 on a phone: flip toggle and roll by touch, no horizontal scroll', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    await seed(page, owner.boardId, { qd: { ...DIE(20, 6, null), y: 20 } });
    const p = await onCanvas(page, 0.3, 0.55);
    const f = await Finger.of(page);
    await f.down(p);
    await f.up();
    await page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: /All tools/ }).click();
    await page.getByRole('button', { name: /^Flip card/ }).first().click();
    const q = await onCanvas(page, 0.3, 0.72);
    await f.down(q);
    await f.up();
    await expect(flipcards(page)).toHaveCount(1);
    const card = (await ids(flipcards(page)))[0];
    const toggle = obj(page, card).locator('button[data-flip-toggle]');
    // снять выделение, чтобы панель выделения не закрывала карточку на узком экране
    const empty = await onCanvas(page, 0.06, 0.97);
    await f.down(empty);
    await f.up();
    await expect(obj(page, card)).toHaveAttribute('aria-selected', 'false');
    await expect(toggle, 'кнопка переворота видна на сенсорном экране без наведения').toBeVisible();
    const tb = await boxOf(toggle);
    await f.down(centerOf(tb));
    await f.up();
    await expect(obj(page, card)).toHaveAttribute('data-side', 'back');

    await page.keyboard.press('Escape');
    const db = await boxOf(obj(page, 'qd'));
    await f.down(centerOf(db));
    await f.up();
    await expect(obj(page, 'qd')).toHaveAttribute('aria-selected', 'true');
    await barBtn(page, 'Roll').tap();
    await expect(obj(page, 'qd')).toHaveAttribute('aria-label', /^Dice d6: [1-6]$/);
    const sw = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(sw).toBeLessThanOrEqual(1);
  } finally {
    await owner.close();
  }
});

// ---------- ARCH ----------

test('ARCH RCT FLP DICE objects live in board document `objects` with `type`; editing makes no mutating HTTP requests', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const page = owner.page;
  try {
    const mutating: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(r.method())) mutating.push(`${r.method()} ${r.url()}`);
    });
    await seed(page, owner.boardId, { 'qa-s': STICKY });
    const sb = await boxOf(obj(page, 'qa-s'));
    await reactionTool(page, 'Heart reaction');
    await placeReaction(page, { x: sb.x + 50, y: sb.y + 50 });
    const card = await createBy(page, 'h', flipcards(page), await onCanvas(page, 0.45, 0.7));
    await barBtn(page, 'Flip').click();
    const d = await createBy(page, 'x', dice(page), await onCanvas(page, 0.75, 0.7));
    await barBtn(page, 'Roll').click();
    const doc = await untilRaw(page, owner.boardId, (o) => {
      expect(ofType(o, 'reaction').length).toBe(1);
      expect(o[card]?.type).toBe('flipcard');
      expect(o[d]?.type).toBe('dice');
      expect(o[d]?.value).not.toBeNull();
    });
    expect(ofType(doc, 'reaction')[0][1].parent).toBe('qa-s');
    expect(mutating, 'правки идут через WebSocket sync').toEqual([]);
  } finally {
    await owner.close();
  }
});
