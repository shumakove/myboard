// Приёмка T6.1 · текст и документ: TXT-01…TXT-08, COL-01 для текста (+ CVS-07, CVS-24, UI-01…04 новых элементов).
// Сценарии — docs/qa/reports/T6.1.md (зафиксированы до чтения handoff). Подписи интерфейса — из handoff T6.1.
// Наблюдение: DOM холста (вычисленные стили, разметка показа), документ доски глазами позднего клиента
// по /api/ws (поле `text` — Y.Text, форматирование — дельта), системный буфер браузера, второй клиент.
import type { Browser, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';
import { canvas, docSeenByLateClient, openGuest, openOwner, profileOpts, type Opts } from './camera';
import { boxOf, centerOf, Finger, handle, obj, objectIds, onCanvas, seed, selectionBar, tool, tools, type Obj } from './scene';
import { hsl, hueDist, rgba, signature, transparent } from './ui';

// На macOS Home/End в поле ввода не двигают курсор: начало и конец строки — ⌘←/⌘→.
const MAC = process.platform === 'darwin';
const HOME = MAC ? 'Meta+ArrowLeft' : 'Home';
const END = MAC ? 'Meta+ArrowRight' : 'End';
const SHIFT_HOME = MAC ? 'Shift+Meta+ArrowLeft' : 'Shift+Home';
// начало и конец всего поля (строка может переноситься)
const DOC_START = MAC ? 'Meta+ArrowUp' : 'Control+Home';
const DOC_END = MAC ? 'Meta+ArrowDown' : 'Control+End';

type Fx = { baseURL?: string; viewport: Opts['viewport']; hasTouch: boolean; isMobile: boolean; userAgent?: string; deviceScaleFactor?: number };
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(150_000));

const editor = (page: Page) => page.getByRole('textbox', { name: 'Object text' });
const fmtBar = (page: Page) => page.getByRole('toolbar', { name: 'Text formatting' });
const slashMenu = (page: Page) => page.getByRole('menu', { name: 'Insert block' });
const linkDialog = (page: Page) => page.getByRole('dialog', { name: 'Choose object to link' });
const styleGroup = (page: Page) => selectionBar(page).getByRole('group', { name: 'Text style' });

const guestOf = (browser: Browser, o: Opts, token: string, name = 'QA Guest') => openGuest(browser, o, token, name);

async function press(page: Page, l: Locator, isMobile: boolean) {
  if (isMobile) await l.tap();
  else await l.click();
}

/** Щелчок/касание инструментом по точке холста; возвращает id нового объекта (редактор открыт). */
async function place(page: Page, toolName: string, fx: number, fy: number, isMobile = false): Promise<string> {
  const before = new Set(await objectIds(page));
  if (toolName === 'Document') {
    await press(page, tool(page, 'All tools'), isMobile);
    await press(page, page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Document', exact: true }), isMobile);
  } else {
    await press(page, tool(page, toolName), isMobile);
  }
  const p = await onCanvas(page, fx, fy);
  if (isMobile) await page.touchscreen.tap(p.x, p.y);
  else await page.mouse.click(p.x, p.y);
  await expect(editor(page)).toBeVisible();
  let id = '';
  await expect(async () => {
    id = (await objectIds(page)).find((x) => !before.has(x)) ?? '';
    expect(id, 'новый объект на холсте').not.toBe('');
  }).toPass({ timeout: 5000 });
  return id;
}

/** Выделить слово в открытом редакторе (Selection API — без зависимости от раскладки клавиш ОС). */
async function selectWord(page: Page, word: string) {
  await editor(page).evaluate((root, w) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = (n.textContent ?? '').indexOf(w);
      if (i >= 0) {
        (root as HTMLElement).focus();
        getSelection()!.setBaseAndExtent(n, i, n, i + w.length);
        return;
      }
    }
    throw new Error(`нет слова ${w}`);
  }, word);
  await page.waitForTimeout(100);
}

/** Выйти из редактора (первый Escape может закрывать меню «/»). */
async function exitEdit(page: Page) {
  for (let i = 0; i < 3 && (await editor(page).isVisible()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
  await expect(editor(page)).toBeHidden();
}

/** Пустая точка холста (левый нижний угол, мимо миникарты) — снять выделение. */
async function clickEmpty(page: Page) {
  const p = await onCanvas(page, 0.05, 0.9);
  await page.mouse.click(p.x, p.y);
}

/** Объект документа доски глазами позднего клиента: поля и дельта текста. */
async function docObject(page: Page, query: string, id: string): Promise<{ fields: Record<string, unknown>; delta: { insert: unknown; attributes?: Record<string, unknown> }[]; text: string } | null> {
  const doc = await docSeenByLateClient(page, query);
  const o = doc.getMap('objects').get(id);
  if (!(o instanceof Y.Map)) return null;
  const t = o.get('text');
  const delta = t instanceof Y.Text ? (t.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) : [{ insert: String(t ?? '') }];
  return { fields: o.toJSON() as Record<string, unknown>, delta, text: t instanceof Y.Text ? t.toString() : String(t ?? '') };
}

async function untilObject(page: Page, query: string, id: string, check: (o: NonNullable<Awaited<ReturnType<typeof docObject>>>) => void) {
  await expect(async () => {
    const o = await docObject(page, query, id);
    expect(o, `объект ${id} в документе`).not.toBeNull();
    check(o!);
  }).toPass({ timeout: 15_000, intervals: [300, 600, 1000] });
}

/** Вычисленный стиль показа объекта на холсте (сам элемент и его первый абзац). */
async function shown(page: Page, id: string) {
  return obj(page, id).evaluate((e) => {
    const cs = getComputedStyle(e);
    const p = e.querySelector('.rich-text p, .rich-text h1, .rich-text li') ?? e;
    const ps = getComputedStyle(p);
    return {
      fontFamily: ps.fontFamily,
      fontSize: parseFloat(ps.fontSize),
      color: ps.color,
      fontWeight: Number(ps.fontWeight),
      fontStyle: ps.fontStyle,
      deco: (() => {
        // text-decoration не наследуется в вычисленном стиле: собрать с абзаца и его предков до объекта
        const out: string[] = [];
        for (let n: Element | null = p; n; n = n === e ? null : n.parentElement) out.push(getComputedStyle(n).textDecorationLine);
        return out.join(' ');
      })(),
      align: ps.textAlign,
      lineHeight: parseFloat(ps.lineHeight),
      bg: cs.backgroundColor,
    };
  });
}

async function setSel(page: Page, label: string, option: string) {
  const bar = selectionBar(page);
  let field = bar.getByRole('combobox', { name: label, exact: true });
  if (!(await field.isVisible())) {
    const toggle = bar.getByRole('button', { name: 'Text style', exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
    field = styleGroup(page).getByRole('combobox', { name: label, exact: true });
  }
  await field.selectOption({ label: option });
}

/** Выделить объект щелчком по его краю (не по ссылке и флажку внутри). */
async function selectObj(page: Page, id: string) {
  const b = await boxOf(obj(page, id));
  await page.mouse.click(b.x + b.width - 6, b.y + b.height / 2);
  await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
}

/** Внешний редактор: отдельная страница с contenteditable вне доски (тот же браузер — тот же системный буфер). */
async function externalEditor(page: Page, html = '') {
  const ext = await page.context().newPage();
  await ext.goto(`data:text/html,${encodeURIComponent(`<!doctype html><meta charset=utf-8><div id=src>${html}</div><div contenteditable id=ed style="min-height:40px;border:1px solid"></div>`)}`);
  return ext;
}

/** Скопировать во внешнем редакторе фрагмент `#src` в системный буфер. */
async function copyExternal(page: Page, html: string) {
  const ext = await externalEditor(page, html);
  await ext.evaluate(() => {
    const r = document.createRange();
    r.selectNodeContents(document.getElementById('src')!);
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(r);
  });
  await ext.keyboard.press('ControlOrMeta+c');
  await ext.close();
}

// ---------- TXT-01 ----------

test('TXT-01 text block: font, size, color, style, alignment, line spacing and background are chosen, persist and reach another client', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.3, 0.3);
    await page.keyboard.type('Quarterly plan');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    const before = await shown(page, id);
    await setSel(page, 'Font', 'Serif');
    await setSel(page, 'Font size', '48');
    await setSel(page, 'Text color', 'Blue');
    await setSel(page, 'Style', 'Bold');
    await setSel(page, 'Align', 'Center');
    await setSel(page, 'Line spacing', '2');
    await setSel(page, 'Background', 'Yellow');
    const check = async (p: Page) => {
      await expect(async () => {
        const s = await shown(p, id);
        expect(s.fontFamily, 'шрифт сменился').not.toBe(before.fontFamily);
        expect(s.fontFamily.toLowerCase()).toContain('serif');
        expect(s.fontSize).toBe(48);
        expect(s.color, 'цвет текста сменился').not.toBe(before.color);
        const c = rgba(s.color)!;
        expect(c[2], 'синий').toBeGreaterThan(c[0]);
        expect(s.fontWeight).toBeGreaterThanOrEqual(700);
        expect(s.align).toBe('center');
        expect(s.lineHeight).toBeCloseTo(96, 0);
        expect(transparent(s.bg), `фон ${s.bg}`).toBe(false);
      }).toPass({ timeout: 10_000 });
    };
    await check(page);
    await check(guest.page);
    await page.reload();
    await expect(obj(page, id)).toBeVisible();
    await check(page);
    // остальные начертания
    await selectObj(page, id);
    for (const [opt, test_] of [
      ['Italic', (s: Awaited<ReturnType<typeof shown>>) => s.fontStyle === 'italic'],
      ['Underline', (s: Awaited<ReturnType<typeof shown>>) => s.deco.includes('underline')],
      ['Strikethrough', (s: Awaited<ReturnType<typeof shown>>) => s.deco.includes('line-through')],
    ] as const) {
      await setSel(page, 'Style', opt);
      await expect.poll(async () => test_(await shown(guest.page, id)), { message: `начертание ${opt} у второго клиента` }).toBe(true);
    }
    for (const [opt, v] of [['Left', 'left'], ['Right', 'right']] as const) {
      await setSel(page, 'Align', opt);
      await expect.poll(async () => (await shown(guest.page, id)).align).toBe(v);
    }
    await setSel(page, 'Background', 'None');
    await expect.poll(async () => transparent((await shown(guest.page, id)).bg), { message: 'фон снят' }).toBe(true);
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TXT-01 a fragment inside the text gets bold, italic, underline and strikethrough from the editor', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.3, 0.3);
    await page.keyboard.type('alpha beta gamma delta');
    await selectWord(page, 'alpha');
    await page.keyboard.press('ControlOrMeta+b');
    await selectWord(page, 'beta');
    await fmtBar(page).getByRole('button', { name: 'Italic', exact: true }).click();
    await selectWord(page, 'gamma');
    await fmtBar(page).getByRole('button', { name: 'Underline', exact: true }).click();
    await selectWord(page, 'delta');
    await fmtBar(page).getByRole('button', { name: 'Strikethrough', exact: true }).click();
    await exitEdit(page);
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt.locator('strong')).toHaveText('alpha');
    await expect(rt.locator('em')).toHaveText('beta');
    await expect(rt.locator('u')).toHaveText('gamma');
    await expect(rt.locator('s')).toHaveText('delta');
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      const attr = (w: string) => d.delta.find((x) => x.insert === w)?.attributes ?? {};
      expect(attr('alpha')).toMatchObject({ bold: true });
      expect(attr('beta')).toMatchObject({ italic: true });
      expect(attr('gamma')).toMatchObject({ underline: true });
      expect(attr('delta')).toMatchObject({ strike: true });
    });
  } finally {
    await owner.close();
  }
});

test('TXT-01 link participant creates and formats a text block like the owner', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = guest.page;
    const id = await place(page, 'Text', 0.3, 0.3, isMobile);
    await page.keyboard.type('Guest note');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await setSel(page, 'Font size', '32');
    await setSel(page, 'Align', 'Center');
    await expect.poll(async () => (await shown(owner.page, id)).fontSize).toBe(32);
    await expect.poll(async () => (await shown(owner.page, id)).align).toBe('center');
    await expect(obj(owner.page, id)).toContainText('Guest note');
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TXT-01 TXT-08 BUG-011 block frame follows the text after a larger font size and after pasting rich text onto the canvas', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.3, 0.3);
    await page.keyboard.type('Several words that wrap onto more lines when large');
    await exitEdit(page);
    await setSel(page, 'Font size', '72');
    await page.waitForTimeout(800);
    const fit = await obj(page, id).evaluate((e) => {
      const r = e.getBoundingClientRect();
      const c = (e.querySelector('.rich-text') ?? e).getBoundingClientRect();
      return { frame: r.height, content: c.height };
    });
    expect.soft(fit.content, `текст ${fit.content}px помещается в рамку ${fit.frame}px`).toBeLessThanOrEqual(fit.frame + 2);
    // высоту пересчитывает сменивший размер (ограничение handoff) — второй клиент видит ту же рамку
    const guest = await guestOf(browser, o, owner.token);
    try {
      await expect(async () => {
        const g = await obj(guest.page, id).evaluate((e) => ({ frame: e.getBoundingClientRect().height, content: (e.querySelector('.rich-text') ?? e).getBoundingClientRect().height }));
        expect(g.content, `у участника текст ${g.content}px в рамке ${g.frame}px`).toBeLessThanOrEqual(g.frame + 2);
        expect(g.frame, 'рамка выросла и у участника').toBeGreaterThan(fit.frame / 2);
      }).toPass({ timeout: 10_000 });
    } finally {
      await guest.close();
    }
    // вставка внешнего HTML на холст
    await copyExternal(page, EXTERNAL);
    await page.bringToFront();
    const before = new Set(await objectIds(page));
    await clickEmpty(page);
    await page.keyboard.press('ControlOrMeta+v');
    let pasted = '';
    await expect(async () => {
      pasted = (await objectIds(page)).find((x) => !before.has(x)) ?? '';
      expect(pasted).not.toBe('');
    }).toPass({ timeout: 5000 });
    await page.waitForTimeout(500);
    const fit2 = await obj(page, pasted).evaluate((e) => ({ frame: e.getBoundingClientRect().height, content: (e.querySelector('.rich-text') ?? e).getBoundingClientRect().height }));
    expect.soft(fit2.content, `вставленный текст ${fit2.content}px в рамке ${fit2.frame}px`).toBeLessThanOrEqual(fit2.frame + 2);
  } finally {
    await owner.close();
  }
});

// ---------- TXT-02 ----------

test('TXT-02 headings, bulleted, numbered and nested lists and links are shown on the canvas', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  let dialogs = 0;
  owner.page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.25, 0.2);
    const pick = async (item: string) => {
      await page.keyboard.type('/');
      await expect(slashMenu(page)).toBeVisible();
      await slashMenu(page).getByRole('menuitem', { name: item, exact: true }).click();
      await expect(slashMenu(page)).toBeHidden();
    };
    await pick('Heading 1');
    await page.keyboard.type('Main');
    await page.keyboard.press('Enter');
    await pick('Heading 2');
    await page.keyboard.type('Sub');
    await page.keyboard.press('Enter');
    await pick('Bulleted list');
    await page.keyboard.type('one');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Tab');
    await page.keyboard.type('nested');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.type('three');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await pick('Numbered list');
    await page.keyboard.type('first');
    await page.keyboard.press('Enter');
    await page.keyboard.type('second');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('site');
    await page.keyboard.press(SHIFT_HOME);
    await fmtBar(page).getByRole('button', { name: 'Link', exact: true }).click();
    await page.getByLabel('Link URL').fill('https://example.com/docs');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.keyboard.press(END);
    await page.keyboard.press('Enter');
    await page.keyboard.type('evil');
    await page.keyboard.press(SHIFT_HOME);
    await fmtBar(page).getByRole('button', { name: 'Link', exact: true }).click();
    await page.getByLabel('Link URL').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await exitEdit(page);
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt.locator('h1')).toHaveText('Main');
    await expect(rt.locator('h2')).toHaveText('Sub');
    await expect(rt.locator('li[data-list="bullet"]').filter({ hasText: 'one' })).toHaveCount(1);
    await expect(rt.locator('li[data-list="bullet"]').filter({ hasText: 'three' })).toHaveCount(1);
    const nested = rt.locator('li').filter({ hasText: 'nested' });
    await expect(nested).toHaveClass(/ql-indent-1/);
    const indentOf = async (t: string) => (await boxOf(rt.locator('li').filter({ hasText: t }))).x + (await rt.locator('li').filter({ hasText: t }).evaluate((e) => parseFloat(getComputedStyle(e).paddingLeft)));
    expect(await indentOf('nested'), 'вложенный пункт с большим отступом').toBeGreaterThan(await indentOf('one'));
    await expect(rt.locator('li[data-list="ordered"]')).toHaveCount(2);
    const a = rt.locator('a', { hasText: 'site' });
    await expect(a).toHaveAttribute('href', 'https://example.com/docs');
    await expect(a).toHaveAttribute('target', '_blank');
    await expect(a).toHaveAttribute('rel', /noopener/);
    await expect(rt.locator('a[href^="javascript"]')).toHaveCount(0);
    await expect(rt).toContainText('evil');
    // ссылка открывается в новой вкладке
    const popup = page.context().waitForEvent('page', { timeout: 10_000 });
    await a.click({ modifiers: ['ControlOrMeta'] }).catch(() => undefined);
    const tab = await popup.catch(() => null);
    if (!tab) {
      await a.click();
      expect(await page.context().waitForEvent('page', { timeout: 10_000 }).then(() => true).catch(() => false), 'ссылка открывает вкладку').toBe(true);
    }
    expect(dialogs, 'javascript: не исполнился').toBe(0);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      const lines = d.delta.filter((x) => typeof x.insert === 'string' && (x.insert as string).includes('\n') && x.attributes);
      expect(lines.some((x) => x.attributes!.header === 1)).toBe(true);
      expect(lines.some((x) => x.attributes!.list === 'bullet' && x.attributes!.indent === 1)).toBe(true);
    });
  } finally {
    await owner.close();
  }
});

test('TXT-02 to-do item is checked with one click without entering edit mode; another client sees it', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const id = isMobile ? await place(page, 'Text', 0.3, 0.3, true) : await place(page, 'Text', 0.3, 0.3);
    await page.keyboard.type('[] buy milk');
    await page.keyboard.press('Enter');
    await page.keyboard.type('call Bob');
    await exitEdit(page);
    // снять выделение: у выделенного блока на телефоне маркер размера закрывает флажок (BUG-016, отдельный тест)
    if (isMobile) {
      const e = await onCanvas(page, 0.05, 0.9);
      await page.touchscreen.tap(e.x, e.y);
      await expect(obj(page, id)).toHaveAttribute('aria-selected', 'false');
    } else await clickEmpty(page);
    const box = page.getByRole('checkbox', { name: 'Done' });
    await expect(box).toHaveCount(2);
    const first = obj(page, id).getByRole('checkbox', { name: 'Done' }).first();
    await expect(first).not.toBeChecked();
    const at = await boxOf(obj(page, id));
    await press(page, first, isMobile);
    await expect(first).toBeChecked();
    await expect(editor(page), 'редактор не открылся').toBeHidden();
    const after = await boxOf(obj(page, id));
    expect(Math.abs(after.x - at.x) + Math.abs(after.y - at.y), 'блок не сдвинулся').toBeLessThan(1);
    const g = obj(guest.page, id).getByRole('checkbox', { name: 'Done' });
    await expect(g.first()).toBeChecked();
    await expect(g.nth(1)).not.toBeChecked();
    // участник снимает отметку тем же щелчком
    await press(guest.page, g.first(), isMobile);
    await expect(g.first()).not.toBeChecked();
    await expect(editor(guest.page)).toBeHidden();
    await expect(first).not.toBeChecked();
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      const lists = d.delta.filter((x) => x.attributes?.list).map((x) => x.attributes!.list);
      expect(lists).toEqual(['unchecked', 'unchecked']);
    });
    await press(page, obj(page, id).getByRole('checkbox', { name: 'Done' }).nth(1), isMobile);
    await expect(g.nth(1)).toBeChecked();
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TXT-03 ----------

test('TXT-03 shortcuts: # makes a heading, - * 1. make lists, -- becomes an em dash; # inside a line stays text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.25, 0.2);
    for (const line of ['# Big', '## Small']) {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
    }
    await page.keyboard.type('a # b -- c');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- dash item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('* star item');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('1. numbered');
    await exitEdit(page);
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt.locator('h1')).toHaveText('Big');
    await expect(rt.locator('h2')).toHaveText('Small');
    await expect(rt.locator('p', { hasText: 'a # b' })).toHaveText('a # b — c');
    await expect(rt.locator('li[data-list="bullet"]')).toHaveText(['dash item', 'star item']);
    await expect(rt.locator('li[data-list="ordered"]')).toHaveText('numbered');
    await expect(rt).not.toContainText('--');
    // в документе тоже
    const doc = await place(page, 'Document', 0.6, 0.35);
    await page.keyboard.type('# Doc title');
    await page.keyboard.press('Enter');
    await page.keyboard.type('x -- y');
    await exitEdit(page);
    await expect(obj(page, doc).locator('h1')).toHaveText('Doc title');
    await expect(obj(page, doc)).toContainText('x — y');
  } finally {
    await owner.close();
  }
});

// ---------- TXT-04 ----------

test('TXT-04 slash opens the insert menu in a text; keyboard and mouse pick a block; Escape closes it and keeps the text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.25, 0.2);
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    for (const n of ['Heading 1', 'Bulleted list', 'Numbered list', 'To-do list']) await expect(slashMenu(page).getByRole('menuitem', { name: n, exact: true })).toBeVisible();
    // фильтр и клавиатура
    await page.keyboard.type('head');
    await expect(slashMenu(page).getByRole('menuitem', { name: 'Bulleted list', exact: true })).toBeHidden();
    await page.keyboard.press('Enter');
    await expect(slashMenu(page)).toBeHidden();
    await page.keyboard.type('Picked by keyboard');
    await page.keyboard.press('Enter');
    // мышь
    await page.keyboard.type('/');
    await slashMenu(page).getByRole('menuitem', { name: 'To-do list', exact: true }).click();
    await page.keyboard.type('todo');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    // Escape закрывает меню, «/» остаётся текстом, правка продолжается
    await page.keyboard.type('a ');
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(slashMenu(page)).toBeHidden();
    await expect(editor(page)).toBeVisible();
    await page.keyboard.type('x');
    // «/» внутри слова — обычный символ
    await page.keyboard.type(' and/or');
    await expect(slashMenu(page)).toBeHidden();
    await exitEdit(page);
    await expect(tool(page, 'Select')).toHaveAttribute('aria-pressed', 'true');
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt.locator('h1')).toHaveText('Picked by keyboard');
    await expect(rt.locator('li[data-list="unchecked"]')).toHaveText('todo');
    await expect(rt).toContainText('a /x and/or');
    expect(await rt.textContent()).not.toMatch(/^\//);
  } finally {
    await owner.close();
  }
});

test('TXT-04 TXT-06 slash menu in a document offers divider and link to object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await place(page, 'Document', 0.35, 0.35);
    await page.keyboard.type('/');
    for (const n of ['Heading 1', 'Bulleted list', 'Numbered list', 'To-do list', 'Divider', 'Link to object']) await expect(slashMenu(page).getByRole('menuitem', { name: n, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(slashMenu(page)).toBeHidden();
    await expect(editor(page)).toBeVisible();
  } finally {
    await owner.close();
  }
});

test('TXT-04 slash menu near the bottom edge is fully visible and not covered by other panels', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await place(page, 'Document', 0.85, 0.8);
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    const vh = page.viewportSize()!.height;
    const vw = page.viewportSize()!.width;
    const items = await slashMenu(page).getByRole('menuitem').all();
    for (const it of items) {
      const b = await boxOf(it);
      const name = (await it.textContent())?.trim();
      expect.soft(b.y + b.height <= vh && b.x + b.width <= vw && b.y >= 0, `пункт «${name}» в окне`).toBe(true);
      const c = centerOf(b);
      const top = await page.evaluate(([x, y]) => {
        const e = document.elementFromPoint(x, y);
        return e ? (e.closest('[role="menuitem"]')?.textContent ?? e.tagName) : null;
      }, [c.x, c.y] as const);
      expect.soft(top?.trim(), `пункт «${name}» не перекрыт`).toBe(name);
    }
  } finally {
    await owner.close();
  }
});

/** Поставить документ в точку холста и проверить, что кнопки панели Text formatting в окне и не перекрыты; документ удаляется. */
async function formattingBarVisible(page: Page, fx: number, fy: number) {
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  await place(page, 'Document', fx, fy);
  await expect(fmtBar(page)).toBeVisible();
  for (const b of await fmtBar(page).getByRole('button').all()) {
    const bb = await boxOf(b);
    const name = (await b.getAttribute('aria-label')) ?? (await b.textContent());
    const at = `(${fx}, ${fy}): ${Math.round(bb.x)},${Math.round(bb.y)} ${Math.round(bb.width)}×${Math.round(bb.height)}`;
    expect.soft(bb.y >= 0 && bb.x >= 0 && bb.x + bb.width <= vw && bb.y + bb.height <= vh, `кнопка «${name}» в окне ${at}`).toBe(true);
    const c = centerOf(bb);
    const own = await b.evaluate((el, [x, y]) => {
      const e = document.elementFromPoint(x, y);
      return !!e && (e === el || el.contains(e)) ? true : `${e?.tagName}.${e?.className} «${(e?.getAttribute('aria-label') ?? '').slice(0, 30)}»`;
    }, [c.x, c.y] as const);
    expect.soft(own === true, `кнопка «${name}» не перекрыта ${at}: ${own}`).toBe(true);
  }
  await exitEdit(page);
  await page.keyboard.press('Delete');
  await expect(page.locator('[data-object-id][data-type="document"]')).toHaveCount(0);
}

test('TXT-04 BUG-012 formatting bar of a document at the top edge of the canvas is not covered by other panels', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    // документ у верхнего края холста: поле частично или целиком над краем и прямо под краем
    for (const [fx, fy] of [[0.3, 0.03], [0.5, 0.03], [0.85, 0.03], [0.3, 0.3], [0.85, 0.3]] as const) await formattingBarVisible(owner.page, fx, fy);
  } finally {
    await owner.close();
  }
});

test('TXT-04 BUG-017 formatting bar of a document in the top left corner of the canvas is not covered by the tool and view panels', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  test.fail(true, 'BUG-017: у документа, заходящего под панель Tools у верхнего края, панель Text formatting над полем — за окном и под панелью View');
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    await formattingBarVisible(owner.page, 0.1, 0.3);
  } finally {
    await owner.close();
  }
});

test('TXT-04 BUG-013 slash on the empty line right after a divider opens the insert menu', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await place(page, 'Document', 0.35, 0.3);
    await page.keyboard.type('Intro');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await slashMenu(page).getByRole('menuitem', { name: 'Divider', exact: true }).click();
    await expect(slashMenu(page)).toBeHidden();
    await page.waitForTimeout(500);
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible({ timeout: 3000 });
  } finally {
    await owner.close();
  }
});

// ---------- TXT-05 ----------

test('TXT-05 new text block takes the last font size and color of this session; another session starts from defaults', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    const gDefault = await place(guest.page, 'Text', 0.2, 0.7);
    await guest.page.keyboard.type('guest default');
    await exitEdit(guest.page);
    const def = await shown(guest.page, gDefault);
    const a = await place(page, 'Text', 0.2, 0.2);
    await page.keyboard.type('first');
    await exitEdit(page);
    await setSel(page, 'Font size', '48');
    await setSel(page, 'Text color', 'Blue');
    const styleA = await shown(page, a);
    expect(styleA.fontSize).toBe(48);
    const b = await place(page, 'Text', 0.5, 0.2);
    await page.keyboard.type('second');
    await exitEdit(page);
    const styleB = await shown(page, b);
    expect(styleB.fontSize, 'размер унаследован').toBe(48);
    expect(styleB.color, 'цвет унаследован').toBe(styleA.color);
    // перезагрузка той же вкладки — та же сессия
    await page.reload();
    await expect(canvas(page)).toBeVisible();
    // дождаться загрузки документа, иначе «новый» объект спутается с уже существующими
    for (const x of [a, b, gDefault]) await expect(obj(page, x)).toBeAttached();
    const c = await place(page, 'Text', 0.2, 0.45);
    await page.keyboard.type('after reload');
    await exitEdit(page);
    expect((await shown(page, c)).fontSize).toBe(48);
    expect((await shown(page, c)).color).toBe(styleA.color);
    // смена только цвета сохраняет запомненный размер
    await setSel(page, 'Text color', 'Green');
    await expect.poll(async () => (await shown(page, c)).color, { message: 'цвет сменился на зелёный' }).not.toBe(styleA.color);
    const green = (await shown(page, c)).color;
    const d = await place(page, 'Text', 0.5, 0.45);
    await page.keyboard.type('only color');
    await exitEdit(page);
    expect((await shown(page, d)).fontSize).toBe(48);
    expect((await shown(page, d)).color).toBe(green);
    // другой участник (своя сессия) — по умолчанию
    const g2 = await place(guest.page, 'Text', 0.5, 0.7);
    await guest.page.keyboard.type('guest again');
    await exitEdit(guest.page);
    const gs = await shown(guest.page, g2);
    expect(gs.fontSize).toBe(def.fontSize);
    expect(gs.color).toBe(def.color);
    expect(def.fontSize).not.toBe(48);
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- TXT-06 ----------

const FAR: Obj = { type: 'shape', x: 15_000, y: 11_000, width: 240, height: 120, text: 'Budget review' };

async function buildDocument(page: Page) {
  const id = await place(page, 'Document', 0.35, 0.3);
  const pick = async (item: string) => {
    await page.keyboard.type('/');
    await expect(slashMenu(page), `меню «/» перед ${item}`).toBeVisible();
    await slashMenu(page).getByRole('menuitem', { name: item, exact: true }).click();
    await expect(slashMenu(page)).toBeHidden();
  };
  await page.keyboard.type('Intro paragraph');
  await page.keyboard.press('Enter');
  await pick('Heading 2');
  await page.keyboard.type('Section');
  await page.keyboard.press('Enter');
  await pick('Bulleted list');
  await page.keyboard.type('point');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await pick('Link to object');
  await expect(linkDialog(page)).toBeVisible();
  await linkDialog(page).getByLabel('Find object').fill('budget');
  await linkDialog(page).getByRole('list', { name: 'Board objects' }).getByRole('button', { name: /Budget review/ }).click();
  await expect(linkDialog(page)).toBeHidden();
  await page.keyboard.press('Enter');
  // «/» в строке сразу после разделителя — отдельный тест (BUG-013); здесь разделитель последним
  await pick('Divider');
  await exitEdit(page);
  return id;
}

test('TXT-06 document of text, list, heading, divider and object link persists and reaches another client; link leads to the object', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-far': FAR });
    const id = await buildDocument(page);
    const verify = async (p: Page) => {
      const d = obj(p, id);
      await expect(d).toHaveAttribute('data-type', 'document');
      await expect(d.locator('p', { hasText: 'Intro paragraph' })).toHaveCount(1);
      await expect(d.locator('h2')).toHaveText('Section');
      await expect(d.locator('li')).toHaveText('point');
      await expect(d.getByRole('separator')).toHaveCount(1);
      await expect(d.getByRole('button', { name: /Budget review/ })).toBeVisible();
    };
    await verify(page);
    await verify(guest.page);
    await page.reload();
    await expect(obj(page, id)).toBeVisible();
    await verify(page);
    // переход по ссылке у обоих клиентов
    for (const p of [page, guest.page]) {
      const far = obj(p, 'qa-far');
      const c = await boxOf(canvas(p));
      const isIn = async () => {
        const b = await far.boundingBox();
        if (!b) return false;
        const m = centerOf(b);
        return m.x > c.x && m.x < c.x + c.width && m.y > c.y && m.y < c.y + c.height;
      };
      expect(await isIn(), 'объект сначала вне вида').toBe(false);
      await obj(p, id).getByRole('button', { name: /Budget review/ }).click();
      await expect.poll(isIn, { message: 'камера у объекта' }).toBe(true);
      await expect(far).toHaveAttribute('aria-selected', 'true');
      await p.reload();
      await expect(canvas(p)).toBeVisible();
      // вернуть вид к документу
      if (!(await obj(p, id).isVisible())) {
        await p.evaluate(() => localStorage.clear());
        await p.reload();
      }
      await expect(obj(p, id)).toBeVisible();
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('TXT-06 link to an object that was deleted shows it is missing and does not move the view', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await seed(page, owner.boardId, { 'qa-far': FAR });
    const id = await buildDocument(page);
    // удалить объект через интерфейс: перейти к нему, Delete, вернуться
    await obj(page, id).getByRole('button', { name: /Budget review/ }).click();
    await expect(obj(page, 'qa-far')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Delete');
    await expect(obj(page, 'qa-far')).toHaveCount(0);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(obj(page, id)).toBeVisible();
    const link = obj(page, id).getByText('Missing object');
    await expect(link).toBeVisible();
    const before = await boxOf(obj(page, id));
    await link.click({ force: true });
    await page.waitForTimeout(800);
    const after = await boxOf(obj(page, id));
    expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y), 'вид не сдвинулся').toBeLessThan(2);
  } finally {
    await owner.close();
  }
});

// ---------- TXT-07 ----------

test('TXT-07 selected text blocks are copied as rich HTML and plain text that an external editor accepts', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const a = await place(page, 'Text', 0.25, 0.2);
    await page.keyboard.type('# Title A');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- item one');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('bold');
    await page.keyboard.press(SHIFT_HOME);
    await page.keyboard.press('ControlOrMeta+b');
    await exitEdit(page);
    await page.keyboard.press('ControlOrMeta+c');
    let ext = await externalEditor(page);
    await ext.locator('#ed').click();
    await ext.keyboard.press('ControlOrMeta+v');
    const ed = ext.locator('#ed');
    await expect(ed.locator('h1')).toHaveText('Title A');
    await expect(ed.locator('li')).toHaveText(/item one/);
    await expect(ed.locator('strong, b')).toHaveText('bold');
    await ext.close();
    // простой текст (внешний редактор без форматирования)
    ext = await page.context().newPage();
    await ext.goto('data:text/html,<textarea id=t cols=60 rows=8></textarea>');
    await ext.locator('#t').click();
    await ext.keyboard.press('ControlOrMeta+v');
    await expect(ext.locator('#t')).toHaveValue(/Title A[\s\S]*item one[\s\S]*bold/);
    await ext.close();
    // несколько блоков
    const b = await place(page, 'Text', 0.25, 0.6);
    await page.keyboard.type('Second block');
    await exitEdit(page);
    await page.keyboard.down('Shift');
    await page.mouse.click((await boxOf(obj(page, a))).x + 4, (await boxOf(obj(page, a))).y + 4);
    await page.keyboard.up('Shift');
    await expect(obj(page, a)).toHaveAttribute('aria-selected', 'true');
    await expect(obj(page, b)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ControlOrMeta+c');
    ext = await page.context().newPage();
    await ext.goto('data:text/html,<textarea id=t cols=60 rows=8></textarea>');
    await ext.locator('#t').click();
    await ext.keyboard.press('ControlOrMeta+v');
    await expect(ext.locator('#t')).toHaveValue(/Title A/);
    await expect(ext.locator('#t')).toHaveValue(/Second block/);
    await ext.close();
  } finally {
    await owner.close();
  }
});

// ---------- TXT-08 ----------

const EXTERNAL = `<h1>Report</h1><p>Normal <b>strong part</b> and <i>slanted</i> and <u>under</u> and <span style="font-weight:700">styled bold</span></p>
<ul><li>level one<ul><li>level two</li></ul></li></ul><ol><li>step</li></ol><p><a href="https://example.org/x">a link</a></p>`;

test('TXT-08 rich text from an external document pastes into the editor with headings, lists, links and emphasis', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.25, 0.15);
    await page.keyboard.type('Start: ');
    await copyExternal(page, EXTERNAL);
    await page.bringToFront();
    await editor(page).focus();
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(300);
    await exitEdit(page);
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt.locator('h1')).toContainText('Report');
    await expect(rt.locator('strong', { hasText: 'strong part' })).toHaveCount(1);
    await expect(rt.locator('strong', { hasText: 'styled bold' })).toHaveCount(1);
    await expect(rt.locator('em', { hasText: 'slanted' })).toHaveCount(1);
    await expect(rt.locator('u', { hasText: 'under' })).toHaveCount(1);
    await expect(rt.locator('li[data-list="bullet"]', { hasText: 'level one' })).toHaveCount(1);
    await expect(rt.locator('li', { hasText: 'level two' })).toHaveClass(/ql-indent-1/);
    await expect(rt.locator('li[data-list="ordered"]', { hasText: 'step' })).toHaveCount(1);
    await expect(rt.locator('a[href="https://example.org/x"]')).toHaveText('a link');
    await expect(rt).toContainText('Start:');
  } finally {
    await owner.close();
  }
});

test('TXT-08 pasting external rich text onto the canvas creates a formatted text block; plain text stays text', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await copyExternal(page, EXTERNAL);
    await page.bringToFront();
    const before = new Set(await objectIds(page));
    await clickEmpty(page);
    await page.keyboard.press('ControlOrMeta+v');
    let id = '';
    await expect(async () => {
      id = (await objectIds(page)).find((x) => !before.has(x)) ?? '';
      expect(id).not.toBe('');
    }).toPass({ timeout: 5000 });
    await expect(obj(page, id)).toHaveAttribute('data-type', 'text');
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt.locator('h1')).toContainText('Report');
    await expect(rt.locator('strong', { hasText: 'strong part' })).toHaveCount(1);
    await expect(rt.locator('li', { hasText: 'level two' })).toHaveClass(/ql-indent-1/);
    await expect(rt.locator('a[href="https://example.org/x"]')).toHaveCount(1);
    await untilObject(page, `board=${owner.boardId}`, id, (d) => {
      expect(d.text).toContain('strong part');
      expect(d.delta.some((x) => x.insert === 'strong part' && x.attributes?.bold)).toBe(true);
    });
    // простой текст из текстового поля
    const ext = await page.context().newPage();
    await ext.goto('data:text/html,<textarea id=t>line one\nline two</textarea>');
    await ext.locator('#t').focus();
    await ext.keyboard.press('ControlOrMeta+a');
    await ext.keyboard.press('ControlOrMeta+c');
    await ext.close();
    await page.bringToFront();
    const before2 = new Set(await objectIds(page));
    await clickEmpty(page);
    await page.keyboard.press('ControlOrMeta+v');
    let id2 = '';
    await expect(async () => {
      id2 = (await objectIds(page)).find((x) => !before2.has(x)) ?? '';
      expect(id2).not.toBe('');
    }).toPass({ timeout: 5000 });
    await expect(obj(page, id2)).toContainText('line one');
    await expect(obj(page, id2)).toContainText('line two');
  } finally {
    await owner.close();
  }
});

test('TXT-08 hostile HTML from an external document is not executed and does not get into the board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  let dialogs = 0;
  owner.page.on('dialog', async (d) => { dialogs++; await d.dismiss(); });
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.25, 0.2);
    // HTML в буфер напрямую через событие copy внешней страницы (без исполнения на ней)
    const ext = await externalEditor(page, 'payload');
    await ext.evaluate(() => {
      const html = '<p>safe text</p><img src="x" onerror="window.__pwned=1;alert(1)"><script>window.__pwned=2<\/script><a href="javascript:alert(2)">bad link</a><iframe src="https://example.com"></iframe><style>body{display:none}</style>';
      document.addEventListener('copy', (e) => {
        e.clipboardData!.setData('text/html', html);
        e.clipboardData!.setData('text/plain', 'safe text bad link');
        e.preventDefault();
      });
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('src')!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await ext.keyboard.press('ControlOrMeta+c');
    await ext.close();
    await page.bringToFront();
    await editor(page).focus();
    await page.keyboard.press('ControlOrMeta+v');
    await page.waitForTimeout(800);
    await exitEdit(page);
    const rt = obj(page, id).locator('.rich-text');
    await expect(rt).toContainText('safe text');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? 0)).toBe(0);
    expect(dialogs).toBe(0);
    await expect(page.locator('[data-object-id] img[onerror], [data-object-id] script, [data-object-id] iframe, [data-object-id] a[href^="javascript"]')).toHaveCount(0);
    await expect(page.locator('body')).toBeVisible();
    // вставка на холст — то же
    await clickEmpty(page);
    const before = new Set(await objectIds(page));
    const ext2 = await externalEditor(page, 'payload');
    await ext2.evaluate(() => {
      document.addEventListener('copy', (e) => {
        e.clipboardData!.setData('text/html', '<p>canvas safe</p><img src="x" onerror="window.__pwned=3"><a href="javascript:alert(3)">x</a>');
        e.clipboardData!.setData('text/plain', 'canvas safe');
        e.preventDefault();
      });
      const r = document.createRange();
      r.selectNodeContents(document.getElementById('src')!);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    await ext2.keyboard.press('ControlOrMeta+c');
    await ext2.close();
    await page.bringToFront();
    await clickEmpty(page);
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(async () => (await objectIds(page)).filter((x) => !before.has(x)).length).toBe(1);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned ?? 0)).toBe(0);
    await expect(page.locator('[data-object-id] img[onerror], [data-object-id] a[href^="javascript"]')).toHaveCount(0);
    expect(dialogs).toBe(0);
  } finally {
    await owner.close();
  }
});

test('TXT-08 a long pasted text (20 000 characters) is inserted without hanging', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const long = Array.from({ length: 400 }, (_, i) => `Line ${String(i).padStart(3, '0')} lorem ipsum dolor sit amet`).join('\n');
    const ext = await page.context().newPage();
    await ext.goto('data:text/html,<textarea id=t></textarea>');
    await ext.locator('#t').fill(long);
    await ext.locator('#t').focus();
    await ext.keyboard.press('ControlOrMeta+a');
    await ext.keyboard.press('ControlOrMeta+c');
    await ext.close();
    await page.bringToFront();
    const id = await place(page, 'Text', 0.25, 0.2);
    const t0 = Date.now();
    await page.keyboard.press('ControlOrMeta+v');
    await exitEdit(page);
    expect(Date.now() - t0, 'вставка быстрее 10 с').toBeLessThan(10_000);
    await expect(obj(page, id)).toContainText('Line 399 lorem');
    await untilObject(page, `board=${owner.boardId}`, id, (d) => expect(d.text.length).toBeGreaterThanOrEqual(long.length));
  } finally {
    await owner.close();
  }
});

// ---------- COL-01 / CVS-07 ----------

async function openEditorOn(page: Page, id: string) {
  await selectObj(page, id);
  await selectionBar(page).getByRole('button', { name: 'Edit text', exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

test('COL-01 two clients type into one text at the same time; both edits survive on both sides', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const id = await place(owner.page, 'Text', 0.3, 0.3);
    await owner.page.keyboard.type('middle');
    await exitEdit(owner.page);
    await expect(obj(guest.page, id)).toContainText('middle');
    await openEditorOn(owner.page, id);
    await openEditorOn(guest.page, id);
    await owner.page.keyboard.press(END);
    await guest.page.keyboard.press(HOME);
    await Promise.all([owner.page.keyboard.type(' OWNERTAIL', { delay: 40 }), guest.page.keyboard.type('GUESTHEAD ', { delay: 40 })]);
    // в одном месте одновременно
    await Promise.all([owner.page.keyboard.type('111', { delay: 30 }), guest.page.keyboard.type('222', { delay: 30 })]);
    await exitEdit(owner.page);
    await exitEdit(guest.page);
    let ownerText = '';
    await expect(async () => {
      ownerText = (await obj(owner.page, id).textContent()) ?? '';
      const guestText = (await obj(guest.page, id).textContent()) ?? '';
      expect(ownerText).toBe(guestText);
      expect(ownerText).toContain('OWNERTAIL');
      expect(ownerText).toContain('GUESTHEAD');
      expect(ownerText).toContain('middle');
      expect(ownerText).toContain('111');
      expect(ownerText).toContain('222');
    }).toPass({ timeout: 10_000 });
    await untilObject(owner.page, `board=${owner.boardId}`, id, (d) => expect(d.text.trim()).toBe(ownerText.trim()));
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('COL-01 formatting by one client and typing by another at the same time are both kept (text and document)', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    for (const kind of ['Text', 'Document'] as const) {
      const id = await place(owner.page, kind, kind === 'Text' ? 0.2 : 0.55, 0.3);
      await owner.page.keyboard.type('shared words here');
      await exitEdit(owner.page);
      await expect(obj(guest.page, id)).toContainText('shared words here');
      await openEditorOn(owner.page, id);
      await openEditorOn(guest.page, id);
      await owner.page.keyboard.press(HOME);
      for (let i = 0; i < 6; i++) await owner.page.keyboard.press('Shift+ArrowRight');
      await guest.page.keyboard.press(END);
      await Promise.all([
        (async () => {
          await owner.page.keyboard.press('ControlOrMeta+b');
          await owner.page.keyboard.press('ArrowRight');
          await owner.page.keyboard.type(' X', { delay: 30 });
        })(),
        guest.page.keyboard.type(' and more', { delay: 30 }),
      ]);
      await exitEdit(owner.page);
      await exitEdit(guest.page);
      for (const p of [owner.page, guest.page]) {
        // ввод сразу за жирным словом продолжает начертание (обычное поведение редактора) — проверяется только «shared»
        await expect(obj(p, id).locator('strong').first()).toHaveText(/^shared/);
        await expect(obj(p, id).locator('strong', { hasText: 'and more' }), 'чужой ввод не стал жирным').toHaveCount(0);
        await expect(obj(p, id)).toContainText('and more');
        await expect(obj(p, id)).toContainText('X');
      }
      await untilObject(owner.page, `board=${owner.boardId}`, id, (d) => {
        expect(d.delta.some((x) => typeof x.insert === 'string' && x.insert.startsWith('shared') && x.attributes?.bold)).toBe(true);
        expect(d.text).toContain('and more');
      });
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 COL-01 BUG-014 undo after editing a shared text removes only own typing', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const id = await place(owner.page, 'Text', 0.3, 0.3);
    await owner.page.keyboard.type('base');
    await exitEdit(owner.page);
    await clickEmpty(owner.page);
    await expect(obj(guest.page, id)).toContainText('base');
    await openEditorOn(owner.page, id);
    await owner.page.keyboard.press(END);
    await owner.page.keyboard.type(' mine');
    await exitEdit(owner.page);
    await expect(obj(guest.page, id)).toContainText('base mine');
    await openEditorOn(guest.page, id);
    await guest.page.keyboard.press(HOME);
    await guest.page.keyboard.type('theirs ');
    await exitEdit(guest.page);
    await expect(obj(owner.page, id)).toContainText('theirs base mine');
    await clickEmpty(owner.page);
    await tools(owner.page).getByRole('button', { name: 'Undo', exact: true }).click();
    for (const p of [owner.page, guest.page]) {
      await expect(obj(p, id)).toContainText('theirs base');
      await expect(obj(p, id)).not.toContainText('mine');
    }
  } finally {
    await guest.close();
    await owner.close();
  }
});

test('CVS-07 COL-01 BUG-014 undo and redo of own typing in the middle of a shared text keep the other client typing; the server copy agrees', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx);
  const owner = await openOwner(browser, o);
  const guest = await guestOf(browser, o, owner.token);
  try {
    const id = await place(owner.page, 'Text', 0.3, 0.3);
    await owner.page.keyboard.type('alpha omega');
    await exitEdit(owner.page);
    await clickEmpty(owner.page);
    await expect(obj(guest.page, id)).toContainText('alpha omega');
    // владелец: вставка в середину строки
    await openEditorOn(owner.page, id);
    await owner.page.keyboard.press(DOC_START);
    for (let i = 0; i < 'alpha'.length; i++) await owner.page.keyboard.press('ArrowRight');
    await owner.page.keyboard.type(' beta');
    await exitEdit(owner.page);
    await clickEmpty(owner.page);
    await expect(obj(guest.page, id)).toContainText('alpha beta omega');
    // участник: в конец и в начало
    await openEditorOn(guest.page, id);
    await guest.page.keyboard.press(DOC_END);
    await guest.page.keyboard.type(' zeta');
    await guest.page.keyboard.press(DOC_START);
    await guest.page.keyboard.type('pre ');
    await exitEdit(guest.page);
    await expect(obj(owner.page, id)).toContainText('pre alpha beta omega zeta');
    await tools(owner.page).getByRole('button', { name: 'Undo', exact: true }).click();
    for (const p of [owner.page, guest.page]) await expect(obj(p, id)).toHaveText('pre alpha omega zeta');
    await untilObject(owner.page, `board=${owner.boardId}`, id, (x) => expect(x.text.trim()).toBe('pre alpha omega zeta'));
    await tools(owner.page).getByRole('button', { name: 'Redo', exact: true }).click();
    for (const p of [owner.page, guest.page]) await expect(obj(p, id)).toHaveText('pre alpha beta omega zeta');
    await untilObject(owner.page, `board=${owner.boardId}`, id, (x) => expect(x.text.trim()).toBe('pre alpha beta omega zeta'));
  } finally {
    await guest.close();
    await owner.close();
  }
});

// ---------- CVS-24 / ARCH ----------

test('CVS-24 TXT-06 Document is in All tools, can be pinned and creates a document; Text is pinned by default', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await expect(tool(page, 'Text')).toBeVisible();
    const id = await place(page, 'Document', 0.4, 0.4, isMobile);
    await page.keyboard.type('On phone too');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('data-type', 'document');
    await press(page, tool(page, 'All tools'), isMobile);
    const dlg = page.getByRole('dialog', { name: 'All tools' });
    await press(page, dlg.getByRole('switch', { name: 'Pin Document' }), isMobile);
    await press(page, dlg.getByRole('button', { name: 'Done', exact: true }), isMobile);
    await expect(tool(page, 'Document')).toBeVisible();
  } finally {
    await owner.close();
  }
});

test('ARCH editing text sends no HTTP requests to /api (only the board channel) and the text survives a reload', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const api: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith('/api') && u.pathname !== '/api/ws' && r.resourceType() !== 'websocket') api.push(`${r.method()} ${u.pathname}`);
      expect(r.url()).not.toContain('localhost');
    });
    const id = await place(page, 'Text', 0.3, 0.3);
    await page.keyboard.type('# Saved heading');
    await page.keyboard.press('Enter');
    await page.keyboard.type('[] task');
    await exitEdit(page);
    await setSel(page, 'Font size', '32');
    await page.waitForTimeout(500);
    expect(api.filter((x) => !x.includes('/api/media')), 'нет HTTP-запросов к /api при правке текста').toEqual([]);
    await page.reload();
    await expect(obj(page, id).locator('h1')).toHaveText('Saved heading');
    await expect(obj(page, id).getByRole('checkbox', { name: 'Done' })).toHaveCount(1);
  } finally {
    await owner.close();
  }
});

test('MOB-06 TXT-02 TXT-06 BUG-016 on a phone a new document opens its editor at once and a selected block keeps its first checkbox tappable', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.3, 0.3, true);
    await page.keyboard.type('[] phone task');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    const cb = obj(page, id).getByRole('checkbox', { name: 'Done' });
    const c = centerOf(await boxOf(cb));
    await page.touchscreen.tap(c.x, c.y);
    await expect.soft(cb, 'касание флажка выделенного блока отмечает пункт').toBeChecked({ timeout: 3000 });
    await press(page, tool(page, 'All tools'), true);
    await press(page, page.getByRole('dialog', { name: 'All tools' }).getByRole('button', { name: 'Document', exact: true }), true);
    const p = await onCanvas(page, 0.4, 0.6);
    await page.touchscreen.tap(p.x, p.y);
    await expect.soft(editor(page), 'редактор документа открыт сразу').toBeVisible({ timeout: 3000 });
  } finally {
    await owner.close();
  }
});

test('MOB-06 TXT-02 BUG-016 on a phone dragging the corner handle over a checkbox resizes the block and does not check the item', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const id = await place(page, 'Text', 0.4, 0.4, true);
    await page.keyboard.type('[] phone task');
    await exitEdit(page);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    const cb = obj(page, id).getByRole('checkbox', { name: 'Done' });
    const before = await boxOf(obj(page, id));
    const h = centerOf(await boxOf(handle(page, 'nw')));
    const f = await Finger.of(page);
    await f.down(h);
    await f.moveTo(h, { x: h.x - 40, y: h.y - 40 }, 10);
    await f.up();
    await expect(async () => {
      const after = await boxOf(obj(page, id));
      expect(after.width, 'ширина выросла при перетаскивании маркера').toBeGreaterThan(before.width + 20);
    }).toPass({ timeout: 3000 });
    await expect(cb, 'перетаскивание маркера не отмечает флажок').not.toBeChecked();
  } finally {
    await owner.close();
  }
});

test('UI-04 BUG-015 on a phone buttons of the text formatting bar are at least 44x44', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    await place(page, 'Text', 0.3, 0.35, true);
    await expect(fmtBar(page)).toBeVisible();
    for (const b of await fmtBar(page).getByRole('button').all()) {
      const bb = await boxOf(b);
      expect.soft(Math.round(bb.width) >= 44 && Math.round(bb.height) >= 44, `${await b.getAttribute('aria-label') ?? await b.textContent()}: ${Math.round(bb.width)}×${Math.round(bb.height)}`).toBe(true);
    }
  } finally {
    await owner.close();
  }
});

// ---------- UI-01…04 ----------

async function expectNeutralOrAccent(root: Locator, accent: string, what: string) {
  const styles = await root.evaluate((r) =>
    [r, ...Array.from(r.querySelectorAll('*'))].flatMap((e) => {
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
    }),
  );
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

test('UI-01 UI-03 text formatting bar, text style row, insert menu and object link dialog follow the common style', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const accent = (await signature(page, page.getByRole('button', { name: 'Share', exact: true })))['background-color'];
    await seed(page, owner.boardId, { 'qa-far': FAR });
    await place(page, 'Document', 0.35, 0.3);
    await expect(fmtBar(page)).toBeVisible();
    await expectFloatingPanel(fmtBar(page), 'панель Text formatting');
    await expectNeutralOrAccent(fmtBar(page), accent, 'панель Text formatting');
    // фокус с клавиатуры на кнопке панели
    await fmtBar(page).getByRole('button', { name: 'Bold', exact: true }).focus();
    await page.keyboard.press('Tab');
    const fo = await page.locator(':focus').evaluate((e) => { const cs = getComputedStyle(e); return `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}`; });
    expect.soft(/none\|0px\|none/.test(fo), `видимый фокус: ${fo}`).toBe(false);
    await editor(page).click();
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    await expectFloatingPanel(slashMenu(page), 'меню Insert block');
    await expectNeutralOrAccent(slashMenu(page), accent, 'меню Insert block');
    await slashMenu(page).getByRole('menuitem', { name: 'Link to object', exact: true }).click();
    await expect(linkDialog(page)).toBeVisible();
    await page.waitForTimeout(600); // переходы цвета рамки поля в фокусе (промежуточные оттенки — не стиль)
    await expectFloatingPanel(linkDialog(page), 'диалог Choose object to link');
    await expectNeutralOrAccent(linkDialog(page), accent, 'диалог Choose object to link');
    await page.keyboard.press('Escape');
    await expect(linkDialog(page)).toBeHidden();
    await exitEdit(page);
    const t = await place(page, 'Text', 0.2, 0.7);
    await page.keyboard.type('styled');
    await exitEdit(page);
    await expect(obj(page, t)).toHaveAttribute('aria-selected', 'true');
    await selectionBar(page).getByRole('button', { name: 'Text style', exact: true }).click();
    await expect(styleGroup(page)).toBeVisible();
    await expectNeutralOrAccent(selectionBar(page), accent, 'панель Selection с Text style');
    await expectFloatingPanel(styleGroup(page), 'строка Text style');
  } finally {
    await owner.close();
  }
});

test('UI-04 MOB-06 on a phone text is created and edited; formatting bar, style row and insert menu fit the screen with 44x44 targets', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const owner = await openOwner(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } as Fx));
  try {
    const page = owner.page;
    const vw = viewport!.width;
    const id = await place(page, 'Text', 0.3, 0.35, true);
    await page.keyboard.type('Phone text -- ok');
    await expect(fmtBar(page)).toBeVisible();
    const small: string[] = [];
    const checkTargets = async (root: Locator, what: string) => {
      const b = await boxOf(root);
      expect.soft(b.x, `${what} в пределах экрана слева`).toBeGreaterThanOrEqual(-0.5);
      expect.soft(b.x + b.width, `${what} в пределах экрана справа`).toBeLessThanOrEqual(vw + 0.5);
      for (const t of await root.locator('button, select, input, [role="menuitem"]').all()) {
        if (!(await t.isVisible())) continue;
        const tb = await boxOf(t);
        if (Math.round(tb.width) < 44 || Math.round(tb.height) < 44) small.push(`${what}: ${(await t.getAttribute('aria-label')) ?? (await t.textContent())?.trim()} ${Math.round(tb.width)}×${Math.round(tb.height)}`);
      }
    };
    await checkTargets(fmtBar(page), 'Text formatting');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/');
    await expect(slashMenu(page)).toBeVisible();
    await checkTargets(slashMenu(page), 'Insert block');
    await slashMenu(page).getByRole('menuitem', { name: 'To-do list', exact: true }).tap();
    await page.keyboard.type('mobile task');
    await exitEdit(page);
    await expect(obj(page, id)).toContainText('Phone text — ok');
    await expect(obj(page, id).getByRole('checkbox', { name: 'Done' })).toHaveCount(1);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'true');
    await selectionBar(page).getByRole('button', { name: 'Text style', exact: true }).tap();
    await expect(styleGroup(page)).toBeVisible();
    // строка Text style может прокручиваться внутри панели Selection: в пределах экрана должна быть сама панель
    await checkTargets(selectionBar(page), 'Selection');
    const scroll = await selectionBar(page).evaluate((e) => {
      const els = [e, ...Array.from(e.querySelectorAll('*'))] as HTMLElement[];
      return els.some((x) => x.scrollWidth > x.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(x).overflowX));
    });
    const sb = await boxOf(selectionBar(page));
    expect.soft(sb.x + sb.width <= vw + 0.5 || scroll, 'панель Selection в пределах экрана или прокручивается').toBe(true);
    for (const name of ['Font', 'Style', 'Align', 'Line spacing', 'Background']) {
      const c = styleGroup(page).getByRole('combobox', { name, exact: true });
      await c.scrollIntoViewIfNeeded();
      const cb = await boxOf(c);
      expect.soft(cb.x >= -0.5 && cb.x + cb.width <= vw + 0.5, `${name} прокручивается в экран`).toBe(true);
      if (Math.round(cb.height) < 44) small.push(`Text style: ${name} ${Math.round(cb.width)}×${Math.round(cb.height)}`);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'без горизонтальной прокрутки').toBe(true);
    // BUG-015: кнопки панели Text formatting уже 44 px — отдельный тест
    expect.soft(small.filter((x) => !x.startsWith('Text formatting')), 'цели меньше 44×44').toEqual([]);
    // флажок касанием (выделение снято)
    const e0 = await onCanvas(page, 0.05, 0.9);
    await page.touchscreen.tap(e0.x, e0.y);
    await expect(obj(page, id)).toHaveAttribute('aria-selected', 'false');
    await obj(page, id).getByRole('checkbox', { name: 'Done' }).tap();
    await expect(obj(page, id).getByRole('checkbox', { name: 'Done' })).toBeChecked();
    await expect(editor(page)).toBeHidden();
  } finally {
    await owner.close();
  }
});
