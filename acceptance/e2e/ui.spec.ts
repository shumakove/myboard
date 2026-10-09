// Приёмка T5.6 · оформление интерфейса: UI-01…04.
// Сценарии — docs/qa/reports/T5.6.md. Наблюдение — вычисленные стили видимых элементов на всех
// экранах UI-02, эмуляция prefers-color-scheme, клавиатура, мышь и hit-test на телефоне.
import { devices, type Locator, type Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { canvas, profileOpts } from './camera';
import { boxOf, centerOf, Finger, obj, selectedIds } from './scene';
import {
  collectStyles, hsl, hueDist, inPalette, luminance, openScreens, panelOf, rgba, screen, signature, transparent,
  type ElStyle, type Stand,
} from './ui';

type P = Parameters<typeof profileOpts>[0];
const desktopOnly = (isMobile: boolean) => test.skip(isMobile, 'мышь и клавиатура — профиль desktop');
const mobileOnly = (isMobile: boolean) => test.skip(!isMobile, 'телефон — профиль mobile');

test.beforeEach(() => test.setTimeout(150_000));

const ui = (els: ElStyle[]) => els.filter((e) => !e.inContent);

/** Цвета участников в списке присутствия — данные присутствия, а не оформление (handoff, ARCH). */
async function participantColors(page: Page): Promise<Set<string>> {
  const list = page.getByRole('list').filter({ hasText: '(you)' });
  if ((await list.count()) === 0) return new Set();
  return new Set(
    await list.first().evaluate((root) =>
      Array.from(root.querySelectorAll('*')).map((e) => getComputedStyle(e).backgroundColor),
    ),
  );
}

/** Чистый серый: R = G = B (UI-01 в редакции 0f2d0c5). */
function pureGray(c: string): boolean {
  const v = rgba(c);
  return !v || (v[0] === v[1] && v[1] === v[2]);
}

/** Чистый серый либо насыщенный цвет тона акцента/опасного действия (±12°). */
function pureGrayOrTone(c: string, hues: number[]): boolean {
  if (pureGray(c) || transparent(c)) return true;
  const h = hsl(c);
  return h.s > 0.25 && hues.some((x) => hueDist(h.h, x) <= 12);
}

/** Выделить опорный объект qa-ui: щелчок (desktop) или долгое нажатие пальцем (mobile, MOB-03). */
async function selectOnBoard(page: Page, isMobile: boolean) {
  if (isMobile) {
    const f = await Finger.of(page);
    await f.down(centerOf(await boxOf(obj(page, 'qa-ui'))));
    await f.hold(900);
    await f.up();
  } else {
    await obj(page, 'qa-ui').click();
  }
  await expect.poll(() => selectedIds(page)).toEqual(['qa-ui']);
}

/** Акцент — фон основной кнопки Sign in на странице входа. */
async function accentOf(st: Stand) {
  return (await signature(screen(st, 'login'), screen(st, 'login').getByRole('button', { name: 'Sign in' })))['background-color'];
}

// ---------- UI-01 ----------

test('UI-01 UI-02 light background, one font, one page and text colour on every screen', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const seen: Record<string, Record<string, string>> = {};
    for (const s of st.screens) {
      seen[s.name] = await signature(s.page, 'body', ['background-color', 'color', 'font-family', 'color-scheme']);
      expect.soft(luminance(seen[s.name]['background-color']), `${s.name}: светлый фон страницы`).toBeGreaterThanOrEqual(0.85);
      const fonts = new Set(ui(await collectStyles(s.page)).filter((e) => e.hasText || e.isControl).map((e) => e.fontFamily));
      expect.soft([...fonts], `${s.name}: один шрифт у текста и элементов управления`).toEqual([seen[s.name]['font-family']]);
    }
    const first = seen.login;
    for (const [name, v] of Object.entries(seen)) {
      expect.soft(v['background-color'], `${name}: фон как у входа`).toBe(first['background-color']);
      expect.soft(v.color, `${name}: цвет текста как у входа`).toBe(first.color);
      expect.soft(v['font-family'], `${name}: шрифт как у входа`).toBe(first['font-family']);
    }
    for (const n of ['board', 'board-guest']) {
      const bg = (await signature(screen(st, n), canvas(screen(st, n)), ['background-color']))['background-color'];
      expect.soft(luminance(bg), `${n}: светлый холст`).toBeGreaterThanOrEqual(0.85);
    }
  } finally {
    await st.close();
  }
});

test('UI-01 floating panels on the board are white, rounded and shadowed, over the canvas area', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    for (const n of ['board', 'board-guest']) {
      const page = screen(st, n);
      const panels: [string, Locator][] = [
        ['View', page.getByRole('toolbar', { name: 'View' })],
        ['Tools', page.getByRole('toolbar', { name: 'Tools' })],
        ['minimap', page.getByTestId('minimap')],
        ['presence', page.getByText('On this board', { exact: false })],
        ['header', page.getByRole('link', { name: /All boards/ }).or(page.getByRole('button', { name: 'Share' })).first()],
      ];
      for (const [name, l] of panels) {
        if (!(await l.first().isVisible())) {
          test.info().annotations.push({ type: 'наблюдение', description: `${n}: ${name} не виден в первом экране` });
          continue;
        }
        const p = await panelOf(page, l.first());
        expect.soft(p, `${n}: ${name} лежит на панели`).not.toBeNull();
        if (!p) continue;
        expect.soft(p.bg, `${n}: ${name} — белая панель (${p.cls})`).toBe('rgb(255, 255, 255)');
        expect.soft(parseFloat(p.radius), `${n}: ${name} — скругление`).toBeGreaterThan(0);
        expect.soft(p.shadow, `${n}: ${name} — тень`).not.toBe('none');
      }
    }
    // карточки и формы прочих экранов — те же белые скруглённые панели с тенью
    for (const [n, l] of [
      ['login', screen(st, 'login').getByRole('button', { name: 'Sign in' })],
      ['admin-login', screen(st, 'admin-login').getByRole('button', { name: 'Sign in' })],
      ['admin-users', screen(st, 'admin-users').getByRole('button', { name: 'Create user' })],
      ['boards', screen(st, 'boards').getByRole('button', { name: 'New board' })],
      ['join', screen(st, 'join').getByLabel('Your name')],
      ['bad-link', screen(st, 'bad-link').getByRole('heading').first()],
      ['embed', screen(st, 'embed').getByRole('heading').first()],
    ] as [string, Locator][]) {
      const p = await panelOf(screen(st, n), l);
      expect.soft(p?.bg, `${n}: белая карточка`).toBe('rgb(255, 255, 255)');
      expect.soft(parseFloat(p?.radius ?? '0'), `${n}: скругление`).toBeGreaterThan(0);
      expect.soft(p?.shadow, `${n}: тень`).not.toBe('none');
    }
  } finally {
    await st.close();
  }
});

test('UI-01 one accent colour for primary and active actions; text and borders stay in a neutral grey scale', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const accent = await accentOf(st);
    expect(hsl(accent).s, 'акцент насыщенный').toBeGreaterThan(0.25);
    // основные действия на всех экранах — акцент
    const primaries: [string, Locator][] = [
      ['admin-login', screen(st, 'admin-login').getByRole('button', { name: 'Sign in' })],
      ['admin-users', screen(st, 'admin-users').getByRole('button', { name: 'Create user' })],
      ['boards', screen(st, 'boards').getByRole('button', { name: 'New board' })],
      ['join', screen(st, 'join').getByRole('button', { name: /join/i })],
      ['board', screen(st, 'board').getByRole('button', { name: 'Share' })],
    ];
    for (const [n, l] of primaries) {
      expect.soft((await signature(screen(st, n), l))['background-color'], `${n}: основная кнопка — акцент`).toBe(accent);
    }
    // активный инструмент — тон акцента (фон, рамка или текст)
    const active = screen(st, 'board').getByRole('toolbar', { name: 'Tools' }).locator('[aria-pressed="true"]').first();
    const a = await signature(screen(st, 'board'), active);
    const accentHue = hsl(accent).h;
    const tinted = [a['background-color'], a['border-top-color'], a.color].filter((c) => !transparent(c) && hsl(c).s > 0.25);
    expect.soft(tinted.length, `активный инструмент выделен акцентом: ${JSON.stringify(a)}`).toBeGreaterThan(0);
    for (const c of tinted) expect.soft(hueDist(hsl(c).h, accentHue), `активный инструмент: тон ${c} = тон акцента`).toBeLessThanOrEqual(12);

    // единственный другой насыщенный цвет кнопок — опасное действие
    const danger = (await signature(screen(st, 'admin-users'), screen(st, 'admin-users').getByRole('button', { name: 'Disable' }).first()))['background-color'];
    const hues = [accentHue, hsl(danger).h];
    expect.soft(hueDist(hues[0], hues[1]), 'опасное действие — другой цвет').toBeGreaterThan(30);
    const tintedBg = new Set<string>();
    // экраны + доска с открытыми диалогами All tools и Share
    const board = screen(st, 'board');
    const extra: { name: string; page: Page; open?: () => Promise<void> }[] = [
      { name: 'board+all-tools', page: board, open: async () => {
        await board.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'All tools' }).click();
        await expect(board.getByRole('dialog', { name: 'All tools' })).toBeVisible();
      } },
      { name: 'board+share', page: board, open: async () => {
        await board.keyboard.press('Escape');
        await board.getByRole('button', { name: 'Share' }).click();
        await expect(board.getByRole('dialog')).toBeVisible();
      } },
    ];
    for (const s of [...st.screens, ...extra]) {
      const open = (s as { open?: () => Promise<void> }).open;
      if (open) await open();
      const skip = await participantColors(s.page);
      for (const e of ui(await collectStyles(s.page))) {
        if (skip.has(e.bg) && !e.hasText) continue; // метка цвета участника
        if (e.isControl) expect.soft(inPalette(e.bg, hues), `${s.name}: фон «${e.label}» ${e.bg}`).toBe(true);
        if (e.hasText) expect.soft(inPalette(e.color, hues), `${s.name}: текст «${e.label}» ${e.color}`).toBe(true);
        if (e.borderWidth > 0) expect.soft(inPalette(e.borderColor, hues), `${s.name}: рамка «${e.label}» ${e.borderColor}`).toBe(true);
        // нейтральная шкала (UI-01 в редакции 0f2d0c5): текст и рамки — чистые серые R = G = B
        // либо насыщенный тон акцента/опасного действия
        for (const c of [e.hasText ? e.color : '', e.borderWidth > 0 ? e.borderColor : ''].filter(Boolean)) {
          expect.soft(pureGrayOrTone(c, hues), `${s.name}: «${e.label}» ${c} — чистый серый или акцент`).toBe(true);
        }
        if (!transparent(e.bg) && !pureGray(e.bg) && hsl(e.bg).s <= 0.25) tintedBg.add(`${s.name}: ${e.bg}`);
      }
    }
    await board.keyboard.press('Escape');
    test.info().annotations.push({ type: 'наблюдение (фон не входит в «текст и границы»)', description: tintedBg.size ? [...tintedBg].join('; ') : 'нейтральные фоны — чистые серые' });
  } finally {
    await st.close();
  }
});

test('UI-01 the system dark colour scheme does not change the look', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const o = profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor });
  const light = await openScreens(browser, o, 'light');
  const dark = await openScreens(browser, o, 'dark');
  try {
    // цвета участников случайны в каждой сессии (данные присутствия) — заменяются меткой
    const keys = async (page: Page) => {
      const pc = await participantColors(page);
      return ui(await collectStyles(page))
        .map((e) => `${e.tag}|${pc.has(e.bg) && !e.hasText ? 'participant' : e.bg}|${e.color}|${e.borderColor}|${e.shadow}`)
        .sort();
    };
    for (const s of dark.screens) {
      expect(await s.page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), 'эмуляция тёмной схемы').toBe(true);
      const d = await keys(s.page);
      const l = await keys(screen(light, s.name));
      expect.soft(d, `${s.name}: вычисленные цвета при тёмной схеме системы = светлые`).toEqual(l);
      const cs = await signature(s.page, 'html', ['color-scheme', 'background-color']);
      expect.soft(cs['color-scheme'], `${s.name}: color-scheme`).not.toContain('dark');
    }
  } finally {
    await light.close();
    await dark.close();
  }
});

test('UI-01 no logos or brand marks of other products', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const brands = /\b(miro|mural|figma|figjam|trello|lucid|whimsical|conceptboard|google|microsoft|apple)\b/i;
    for (const s of st.screens) {
      const marks = await s.page.evaluate(() =>
        [
          document.title,
          ...Array.from(document.querySelectorAll('img, svg, [aria-label], [title], link[rel~="icon"]')).map((e) =>
            [e.getAttribute('src'), e.getAttribute('alt'), e.getAttribute('aria-label'), e.getAttribute('title'), e.getAttribute('href'), e.textContent].join(' '),
          ),
          document.body.innerText,
        ].join('\n'),
      );
      expect.soft(marks.match(brands)?.[0] ?? null, `${s.name}: чужая марка`).toBeNull();
    }
  } finally {
    await st.close();
  }
});

// ---------- UI-02 ----------

test('UI-02 one scale of text sizes, paddings, radii and shadows across all screens', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const sizes = new Map<string, Set<string>>();
    const radii = new Map<string, Set<string>>();
    const shadows = new Map<string, Set<string>>();
    const pads = new Map<string, Set<string>>();
    const add = (m: Map<string, Set<string>>, k: string, s: string) => (m.get(k) ?? m.set(k, new Set()).get(k)!).add(s);
    for (const s of st.screens) {
      for (const e of ui(await collectStyles(s.page))) {
        if (e.hasText || e.isControl) add(sizes, e.fontSize, s.name);
        const r = parseFloat(e.radius);
        if (r > 0 && r < 999 && !e.radius.endsWith('%')) add(radii, e.radius, s.name);
        if (e.shadow !== 'none') add(shadows, e.shadow, s.name);
        for (const p of e.padding) if (p !== '0px') add(pads, p, s.name);
      }
    }
    const fmt = (m: Map<string, Set<string>>) => [...m].map(([k, v]) => `${k} (${[...v].join(', ')})`).join('; ');
    test.info().annotations.push({ type: 'шкалы', description: `шрифт: ${fmt(sizes)} | скругления: ${fmt(radii)} | тени: ${fmt(shadows)} | отступы: ${[...pads.keys()].join(', ')}` });
    expect.soft(sizes.size, `размеры шрифта: ${fmt(sizes)}`).toBeLessThanOrEqual(7);
    expect.soft(radii.size, `скругления: ${fmt(radii)}`).toBeLessThanOrEqual(5);
    expect.soft(shadows.size, `тени: ${fmt(shadows)}`).toBeLessThanOrEqual(4);
    expect.soft(pads.size, `отступы: ${fmt(pads)}`).toBeLessThanOrEqual(10);
  } finally {
    await st.close();
  }
});

// ---------- UI-03 ----------

const SAME = ['background-color', 'color', 'border-top-color', 'border-top-width', 'border-radius', 'font-family', 'font-size', 'font-weight', 'height', 'box-shadow'] as const;

async function sameKind(st: Stand, kind: string, items: [string, Locator][], props: readonly string[] = SAME) {
  const sigs: [string, Record<string, string>][] = [];
  for (const [n, l] of items) {
    await expect(l, `${kind}: ${n}`).toBeVisible();
    sigs.push([n, await signature(screen(st, n), l, props)]);
  }
  for (const [n, s] of sigs.slice(1)) expect.soft(s, `${kind}: ${n} = ${sigs[0][0]}`).toEqual(sigs[0][1]);
}

test('UI-03 buttons and inputs of one kind look the same on different screens', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const b = (n: string, name: string | RegExp) => [n, screen(st, n).getByRole('button', { name, exact: typeof name === 'string' })] as [string, Locator];
    await sameKind(st, 'основная', [b('login', 'Sign in'), b('admin-login', 'Sign in'), b('admin-users', 'Create user'), b('boards', 'New board'), b('join', /join/i), b('board', 'Share')]);
    await sameKind(st, 'второстепенная', [b('boards', 'Sign out'), b('admin-users', 'Sign out'), b('boards', 'New folder'), b('board', 'Hide cursors')]);
    // кнопки панели инструментов холста — отдельный элемент UI-03 («плавающие панели инструментов»):
    // сравниваются между собой; тихие кнопки вне панели инструментов — между экранами
    await sameKind(st, 'инструмент', [b('board', 'Lasso'), b('board-guest', 'Lasso'), b('board', 'Shape')]);
    await selectOnBoard(screen(st, 'board'), isMobile);
    // BUG-009 исправлен в T5.4: высота сравнивается вместе с прочими свойствами
    await sameKind(st, 'тихая', [b('boards', 'Rename'), ['board', screen(st, 'board').getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Arrange', exact: true })]]);
    await sameKind(st, 'кнопка-значок', [b('board', 'Zoom in'), b('board', 'Zoom out'), b('board-guest', 'Zoom in')]);
    // опасное действие — Disable в админке; второе место — подтверждение удаления доски
    const boards = screen(st, 'boards');
    await boards.getByRole('button', { name: 'Delete', exact: true }).first().click();
    const yes = boards.getByRole('button', { name: /yes, delete/i });
    await expect(yes).toBeVisible();
    await boards.mouse.move(0, 0); // снять наведение, оставшееся после касания/щелчка
    await boards.waitForTimeout(300);
    const dangerSigs = [await signature(screen(st, 'admin-users'), screen(st, 'admin-users').getByRole('button', { name: 'Disable' }).first(), SAME), await signature(boards, yes, SAME)];
    expect.soft(dangerSigs[1], 'опасная: Yes, delete = Disable').toEqual(dangerSigs[0]);
    await boards.keyboard.press('Escape');
    // поля ввода и списки
    const f = (n: string, l: string | RegExp) => [n, screen(st, n).getByLabel(l, { exact: typeof l === 'string' }).first()] as [string, Locator];
    await sameKind(st, 'поле ввода', [f('login', 'Email'), f('admin-login', 'Email'), f('admin-users', 'Email'), f('join', 'Your name'), ['boards', screen(st, 'boards').getByRole('searchbox').first()]]);
    await sameKind(st, 'список', [['boards', screen(st, 'boards').getByRole('combobox', { name: 'Sort by' })], ['board', screen(st, 'board').getByLabel('Mouse wheel')], ['board-guest', screen(st, 'board-guest').getByLabel('Mouse wheel')]]);
  } finally {
    await st.close();
  }
});

test('UI-03 BUG-009 quiet buttons have one height on the list screen and on the board', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  // BUG-009 исправлен в T5.4 (решение владельца 0f2d0c5): пометка test.fail снята, тест — в наборе навсегда
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    await selectOnBoard(screen(st, 'board'), isMobile);
    const bar = screen(st, 'board').getByRole('toolbar', { name: 'Selection' });
    await sameKind(st, 'тихая (высота)', [
      ['boards', screen(st, 'boards').getByRole('button', { name: 'Rename', exact: true })],
      ['board', bar.getByRole('button', { name: 'Arrange', exact: true })],
    ], ['height']);
  } finally {
    await st.close();
  }
});

test('UI-03 menus and dialogs look the same in different places', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = screen(st, 'board');
    const MENU = ['background-color', 'border-radius', 'box-shadow', 'border-top-color', 'padding-top'] as const;
    const ITEM = ['background-color', 'color', 'font-size', 'font-family', 'height', 'padding-left', 'border-radius'] as const;
    // контекстное меню холста
    const c = await boxOf(canvas(page));
    await page.mouse.click(c.x + c.width * 0.8, c.y + c.height * 0.2, { button: 'right' });
    const board = page.getByRole('menu', { name: 'Board menu' });
    await expect(board).toBeVisible();
    await page.mouse.move(0, 0); // меню открывается под указателем: снять наведение с пункта
    await page.waitForTimeout(300);
    const bm = await signature(page, board, MENU);
    const bi = await signature(page, board.getByRole('menuitem').nth(1), ITEM); // первый пункт получает фокус при открытии
    await page.keyboard.press('Escape');
    // контекстное меню объекта
    await obj(page, 'qa-ui').click({ button: 'right' });
    const om = page.getByRole('menu', { name: 'Object menu' });
    await expect(om).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    expect.soft(await signature(page, om, MENU), 'Object menu = Board menu').toEqual(bm);
    expect.soft(await signature(page, om.getByRole('menuitem').nth(1), ITEM), 'пункт Object menu = пункт Board menu').toEqual(bi);
    await page.keyboard.press('Escape');
    // выпадающее меню панели Selection
    await obj(page, 'qa-ui').click();
    const bar = page.getByRole('toolbar', { name: 'Selection' });
    await bar.getByRole('button', { name: 'Arrange', exact: true }).click();
    const am = page.getByRole('menu', { name: 'Arrange menu' });
    await expect(am).toBeVisible();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    expect.soft(await signature(page, am, MENU), 'Arrange menu (выпадающее) = Board menu').toEqual(bm);
    expect.soft(await signature(page, am.getByRole('menuitem').nth(1), ITEM), 'пункт Arrange menu = пункт Board menu').toEqual(bi);
    await page.keyboard.press('Escape');

    // диалоги: Share на доске и подтверждение удаления в списке
    const DLG = ['background-color', 'border-radius', 'box-shadow', 'padding-top', 'padding-left'] as const;
    await page.getByRole('button', { name: 'Share' }).click();
    const share = page.getByRole('dialog');
    await expect(share).toBeVisible();
    const sd = await signature(page, share, DLG);
    expect.soft(sd['background-color'], 'диалог белый').toBe('rgb(255, 255, 255)');
    expect.soft(sd['box-shadow'], 'диалог с тенью').not.toBe('none');
    const boards = screen(st, 'boards');
    await boards.getByRole('button', { name: 'Delete', exact: true }).first().click();
    const confirm = boards.getByRole('dialog');
    if (await confirm.isVisible()) {
      expect.soft(await signature(boards, confirm, DLG), 'диалог удаления = диалог Share').toEqual(sd);
    } else {
      test.info().annotations.push({ type: 'наблюдение', description: 'подтверждение удаления доски — не диалог (встроено в строку)' });
    }
    // наблюдение: переключатели, подсказки, вкладки на экранах
    let found = '';
    for (const s of st.screens) {
      const n = await s.page.locator('[role="switch"], [role="tab"], [role="tooltip"], [role="dialog"]').count();
      found += `${s.name}: ${n}; `;
    }
    test.info().annotations.push({ type: 'наблюдение', description: `switch/tab/tooltip/dialog на экранах — ${found}` });
  } finally {
    await st.close();
  }
});

/** Состояния: наведение, нажатие, фокус с клавиатуры. */
async function states(page: Page, l: Locator, name: string) {
  const PROPS = ['background-color', 'border-top-color', 'color', 'box-shadow', 'outline-style', 'outline-color', 'outline-width'] as const;
  await page.mouse.move(0, 0);
  await l.evaluate((e) => (e as HTMLElement).blur());
  await page.waitForTimeout(250);
  const rest = await signature(page, l, PROPS);
  await l.hover();
  await page.waitForTimeout(250);
  const hover = await signature(page, l, PROPS);
  expect.soft(hover, `${name}: наведение меняет вид`).not.toEqual(rest);
  await page.mouse.down();
  await page.waitForTimeout(250);
  const active = await signature(page, l, PROPS);
  await page.mouse.move(0, 0); // отпустить вне элемента, чтобы не сработало действие
  await page.mouse.up();
  expect.soft(active, `${name}: нажатие меняет вид`).not.toEqual(rest);
  // фокус с клавиатуры: Tab до элемента от начала страницы (щелчок по пустому фону в углу)
  await l.evaluate((e) => (e as HTMLElement).blur());
  await page.mouse.click(1, 1);
  await page.waitForTimeout(250);
  let reached = false;
  for (let i = 0; i < 400 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await l.evaluate((e) => document.activeElement === e);
  }
  expect.soft(reached, `${name}: достижим с клавиатуры`).toBe(true);
  await page.waitForTimeout(250);
  const focus = await signature(page, l, PROPS);
  const ring = focus['outline-style'] !== 'none' && parseFloat(focus['outline-width']) > 0 ? 'outline' : focus['box-shadow'] !== rest['box-shadow'] ? 'shadow' : '';
  expect.soft(ring, `${name}: видимое кольцо фокуса ${JSON.stringify(focus)}`).not.toBe('');
  await l.evaluate((e) => (e as HTMLElement).blur());
}

/** Недоступность: вид отличается от доступной кнопки того же вида, курсор не «рука», щелчок не срабатывает. */
async function disabled(page: Page, l: Locator, name: string) {
  const PROPS = ['background-color', 'color', 'border-top-color', 'opacity', 'cursor'] as const;
  await page.mouse.move(0, 0);
  const on = await signature(page, l, PROPS);
  // стиль читается после завершения CSS-переходов
  const off = await l.evaluate(async (e, props) => {
    const b = e as HTMLButtonElement;
    const was = b.disabled;
    b.disabled = true;
    await new Promise((r) => setTimeout(r, 500));
    const cs = getComputedStyle(b);
    const r = Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    b.disabled = was;
    return r;
  }, PROPS as unknown as string[]);
  const { cursor, ...look } = off;
  const { cursor: _c, ...lookOn } = on;
  expect.soft(look, `${name}: недоступная выглядит иначе`).not.toEqual(lookOn);
  expect.soft(cursor, `${name}: курсор недоступной`).not.toBe('pointer');
}

test('UI-03 hover, press, keyboard focus and disabled states are visible for every kind of button, inputs and menu items', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const login = screen(st, 'login');
    const boards = screen(st, 'boards');
    const admin = screen(st, 'admin-users');
    const board = screen(st, 'board');
    const kinds: [string, Page, Locator][] = [
      ['основная Sign in', login, login.getByRole('button', { name: 'Sign in' })],
      ['основная New board', boards, boards.getByRole('button', { name: 'New board' })],
      ['второстепенная New folder', boards, boards.getByRole('button', { name: 'New folder', exact: true })],
      ['опасная Disable', admin, admin.getByRole('button', { name: 'Disable' }).first()],
      ['тихая Lasso', board, board.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'Lasso', exact: true })],
      ['значок Zoom in', board, board.getByRole('button', { name: 'Zoom in' })],
      ['значок Favorite', boards, boards.getByRole('button', { name: 'Favorite' }).first()],
    ];
    for (const [name, page, l] of kinds) {
      await states(page, l, name);
      await disabled(page, l, name);
    }
    // недоступная кнопка в продукте: Unlock all без блокировок
    const unlock = board.getByRole('button', { name: 'Unlock all' });
    if (await unlock.isVisible()) {
      await expect(unlock).toBeDisabled();
      const cur = (await signature(board, unlock, ['cursor', 'color']));
      expect.soft(cur.cursor, 'Unlock all: курсор').not.toBe('pointer');
    }
    // поле ввода: фокус с клавиатуры виден, наведение — наблюдение
    const email = login.getByLabel('Email');
    const rest = await signature(login, email, ['border-top-color', 'box-shadow', 'outline-style']);
    await email.focus();
    const foc = await signature(login, email, ['border-top-color', 'box-shadow', 'outline-style']);
    expect.soft(foc, 'поле ввода: фокус виден').not.toEqual(rest);
    await disabled(login, email, 'поле ввода Email');
    // пункт меню: наведение и фокус с клавиатуры
    const c = await boxOf(canvas(board));
    await board.mouse.click(c.x + c.width * 0.8, c.y + c.height * 0.2, { button: 'right' });
    const items = board.getByRole('menu', { name: 'Board menu' }).getByRole('menuitem');
    await expect(items.first()).toBeVisible();
    const IP = ['background-color', 'color', 'outline-style', 'box-shadow'] as const;
    const second = items.nth(1);
    await board.mouse.move(0, 0);
    const r0 = await signature(board, second, IP);
    await second.hover();
    await board.waitForTimeout(250);
    expect.soft(await signature(board, second, IP), 'пункт меню: наведение').not.toEqual(r0);
    await board.mouse.move(0, 0);
    await board.keyboard.press('ArrowDown');
    await board.keyboard.press('ArrowDown');
    const focused = await board.evaluate(() => document.activeElement?.getAttribute('role'));
    test.info().annotations.push({ type: 'наблюдение', description: `стрелки в меню переводят фокус на: ${focused}` });
    if (focused === 'menuitem') {
      const f = board.locator(':focus');
      const sig = await signature(board, f, IP);
      expect.soft(sig, 'пункт меню: фокус с клавиатуры виден').not.toEqual(r0);
    }
    await board.keyboard.press('Escape');
  } finally {
    await st.close();
  }
});

// ---------- UI-04 ----------

/** Элементы управления, у которых область нажатия меньше 44×44 (hit-test по углам квадрата). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const H = 21;
    const sel = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [data-handle]';
    const bad: string[] = [];
    const owns = (e: Element, hit: Element | null) => {
      if (!hit) return false;
      if (e === hit || e.contains(hit)) return true;
      const lab = hit.closest('label');
      return !!lab && (lab.control === e || lab.contains(e));
    };
    for (const e of Array.from(document.querySelectorAll(sel))) {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || e.closest('[aria-hidden="true"]')) continue;
      if (r.left < 0 || r.top < 0 || r.right > innerWidth || r.bottom > innerHeight) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (!owns(e, document.elementFromPoint(cx, cy))) continue; // перекрыт
      // обрезан контейнером с прокруткой (панель, листаемая вбок) — виден не целиком, не проверяется
      let clipped = false;
      for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
        const o = getComputedStyle(a);
        if (o.overflowX === 'visible' && o.overflowY === 'visible') continue;
        const c = a.getBoundingClientRect();
        if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) clipped = true;
      }
      if (clipped) continue;
      const misses: string[] = [];
      // по осям — край квадрата 44×44; по диагонали — внутри скругления углов (браузер не попадает в срезанный угол)
      const D = 14;
      for (const [dx, dy] of [[-D, -D], [D, -D], [-D, D], [D, D], [-H, 0], [H, 0], [0, -H], [0, H]]) {
        const x = Math.min(Math.max(cx + dx, 0), innerWidth - 1);
        const y = Math.min(Math.max(cy + dy, 0), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        if (!owns(e, hit)) misses.push(`${dx},${dy}→${hit?.tagName.toLowerCase()}${hit?.getAttribute('aria-label') ? `[${hit.getAttribute('aria-label')}]` : ''}`);
      }
      if (misses.length) {
        const name = e.getAttribute('aria-label') || e.getAttribute('data-handle') || (e.textContent ?? '').trim().slice(0, 24) || e.tagName;
        bad.push(`${e.tagName.toLowerCase()} «${name}» ${Math.round(r.width)}×${Math.round(r.height)}: ${misses.slice(0, 3).join(' ')}`);
      }
    }
    return bad;
  });
}

test('UI-04 on a phone every control has a touch target of at least 44×44 on every screen', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const report: Record<string, string[]> = {};
    for (const s of st.screens) report[s.name] = await smallTargets(s.page);
    // доска с выделенным объектом: панель Selection и маркеры размера/поворота
    const page = screen(st, 'board');
    const f = await Finger.of(page);
    await f.down(centerOf(await boxOf(obj(page, 'qa-ui'))));
    await f.hold(900);
    await f.up();
    await expect.poll(() => selectedIds(page)).toEqual(['qa-ui']);
    await expect(page.locator('[data-handle]').first()).toBeVisible();
    report['board+selection'] = await smallTargets(page);
    // открытые меню и диалог
    await page.getByRole('button', { name: 'Share' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    report['board+share'] = await smallTargets(page);
    await page.keyboard.press('Escape');
    for (const [n, bad] of Object.entries(report)) expect.soft(bad, `${n}: области нажатия меньше 44×44`).toEqual([]);
  } finally {
    await st.close();
  }
});

test('UI-04 the phone keeps the same style as the desktop', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const phone = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const desk = await openScreens(browser, { ...devices['Desktop Chrome'], baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const KEEP = ['background-color', 'color', 'font-family', 'border-top-color', 'border-radius', 'box-shadow'] as const;
    const pick: [string, (p: Page) => Locator][] = [
      ['login', (p) => p.getByRole('button', { name: 'Sign in' })],
      ['login', (p) => p.getByLabel('Email')],
      ['boards', (p) => p.getByRole('button', { name: 'New board' })],
      ['boards', (p) => p.getByRole('button', { name: 'Sign out' })],
      ['board', (p) => p.getByRole('button', { name: 'Share' })],
      ['board', (p) => p.getByRole('toolbar', { name: 'Tools' })],
      ['board', (p) => p.locator('body')],
    ];
    for (const [n, l] of pick) {
      const a = await signature(screen(phone, n), l(screen(phone, n)), KEEP);
      const b = await signature(screen(desk, n), l(screen(desk, n)), KEEP);
      expect.soft(a, `${n}: телефон = компьютер`).toEqual(b);
    }
    const pTools = await panelOf(screen(phone, 'board'), screen(phone, 'board').getByRole('toolbar', { name: 'Tools' }));
    expect.soft(pTools?.bg).toBe('rgb(255, 255, 255)');
    expect.soft(pTools?.shadow).not.toBe('none');
  } finally {
    await phone.close();
    await desk.close();
  }
});

// контроль от ложного PASS: hit-test находит маленькую цель
test('UI-04 control check: the touch-target probe detects a small control', async ({ page, isMobile }) => {
  mobileOnly(isMobile);
  await page.setContent('<button style="width:20px;height:20px;padding:0;margin:100px">x</button><button style="width:44px;height:44px;margin:100px;border-radius:12px">y</button><button style="width:44px;height:30px;margin:100px">z</button>');
  const bad = await smallTargets(page);
  expect(bad.length).toBe(2);
  expect(bad[0]).toContain('20×20');
  expect(bad[1]).toContain('44×30');
});

// ---------- T5.4: переключатель (впервые на экране — диалог All tools) ----------

async function openAllTools(page: Page, isMobile: boolean) {
  const b = page.getByRole('toolbar', { name: 'Tools' }).getByRole('button', { name: 'All tools' });
  if (isMobile) await b.tap();
  else await b.click();
  const d = page.getByRole('dialog', { name: 'All tools' });
  await expect(d).toBeVisible();
  return d;
}

test('UI-03 the switch in All tools: role switch, toggles by a click and by Space, visible hover, press, keyboard focus and disabled states; the dialog looks like Share', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  desktopOnly(isMobile);
  const st = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  try {
    const page = screen(st, 'board');
    const dlg = await openAllTools(page, false);
    const sw = dlg.getByRole('switch', { name: 'Pin Lasso' });
    await expect(sw).toHaveAttribute('role', 'switch');
    await expect(sw).toBeChecked();
    // видимая часть переключателя — его подпись-обёртка (сам input может быть скрыт)
    const visual = sw.locator('xpath=ancestor::label[1]');
    const track = visual.locator('[aria-hidden="true"]').first();
    const PROPS = ['background-color', 'border-top-color', 'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'opacity'] as const;
    const look = async () => ({ ...(await signature(page, track, PROPS)), ...(Object.fromEntries(Object.entries(await signature(page, visual, PROPS)).map(([k, v]) => [`label:${k}`, v]))) });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const on = await look();
    // щелчок переключает, вид меняется
    await visual.click();
    await expect(sw).not.toBeChecked();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const off = await look();
    expect.soft(off, 'включён и выключен выглядят по-разному').not.toEqual(on);
    // пробел с клавиатуры
    await sw.focus();
    await page.keyboard.press('Space');
    await expect(sw).toBeChecked();
    // фокус с клавиатуры: Tab с предыдущего элемента
    await dlg.getByRole('button', { name: 'Lasso', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(sw).toBeFocused();
    await page.waitForTimeout(300);
    const focus = await look();
    await sw.evaluate((e) => (e as HTMLElement).blur());
    await page.waitForTimeout(300);
    const rest = await look();
    expect.soft(focus, `фокус с клавиатуры виден: ${JSON.stringify(focus)}`).not.toEqual(rest);
    // наведение и нажатие
    await visual.hover();
    await page.waitForTimeout(300);
    expect.soft(await look(), 'наведение меняет вид').not.toEqual(rest);
    await page.mouse.down();
    await page.waitForTimeout(300);
    const pressed = await look();
    await page.mouse.move(0, 0);
    await page.mouse.up();
    expect.soft(pressed, 'нажатие меняет вид').not.toEqual(rest);
    await expect(sw, 'нажатие с уводом указателя не переключило').toBeChecked();
    // недоступность
    const dis = await sw.evaluate(async (e, props) => {
      const i = e as HTMLInputElement;
      i.disabled = true;
      await new Promise((r) => setTimeout(r, 500));
      const lab = i.closest('label')!;
      const tr = lab.querySelector('[aria-hidden="true"]')!;
      const a = getComputedStyle(tr);
      const b = getComputedStyle(lab);
      const r = { ...Object.fromEntries(props.map((p) => [p, a.getPropertyValue(p)])), ...Object.fromEntries(props.map((p) => [`label:${p}`, b.getPropertyValue(p)])), cursor: b.cursor, inputCursor: getComputedStyle(i).cursor };
      i.disabled = false;
      return r;
    }, PROPS as unknown as string[]);
    const { cursor, inputCursor, ...disLook } = dis;
    expect.soft(disLook, 'недоступный выглядит иначе').not.toEqual(rest);
    expect.soft([cursor, inputCursor], 'курсор недоступного').not.toContain('pointer');
    // диалог All tools = диалог Share
    const DLG = ['background-color', 'border-radius', 'box-shadow', 'padding-top', 'padding-left'] as const;
    const at = await signature(page, dlg, DLG);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await page.getByRole('button', { name: 'Share' }).click();
    const share = page.getByRole('dialog');
    await expect(share).toBeVisible();
    expect.soft(at, 'диалог All tools = диалог Share').toEqual(await signature(page, share, DLG));
    await page.keyboard.press('Escape');
    await page.evaluate(() => localStorage.clear());
  } finally {
    await st.close();
  }
});

test('UI-04 on a phone the All tools dialog: switches, tool buttons and move buttons have touch targets of at least 44×44; same style as the desktop', async ({ browser, baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }) => {
  mobileOnly(isMobile);
  const phone = await openScreens(browser, profileOpts({ baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor }));
  const desk = await openScreens(browser, { ...devices['Desktop Chrome'], baseURL, viewport: { width: 1440, height: 900 } });
  try {
    const page = screen(phone, 'board');
    const dlg = await openAllTools(page, true);
    await expect(dlg).toBeInViewport();
    expect.soft(await smallTargets(page), 'All tools: области нажатия меньше 44×44').toEqual([]);
    // переключатель за краем видимой области (если диалог листается) — тоже проверяется
    for (const sw of await dlg.getByRole('switch').all()) {
      await sw.scrollIntoViewIfNeeded();
      const bad = await smallTargets(page);
      expect.soft(bad.filter((b) => b.includes('Pin ')), 'переключатели').toEqual([]);
    }
    const dd = await openAllTools(screen(desk, 'board'), false);
    const KEEP = ['background-color', 'color', 'font-family', 'border-radius', 'box-shadow'] as const;
    expect.soft(await signature(page, dlg, KEEP), 'диалог: телефон = компьютер').toEqual(await signature(screen(desk, 'board'), dd, KEEP));
    const tr = (p: Page) => p.getByRole('dialog', { name: 'All tools' }).getByRole('switch').first().locator('xpath=ancestor::label[1]').locator('[aria-hidden="true"]').first();
    expect.soft(await signature(page, tr(page), ['background-color', 'border-radius']), 'переключатель: телефон = компьютер').toEqual(await signature(screen(desk, 'board'), tr(screen(desk, 'board')), ['background-color', 'border-radius']));
  } finally {
    await phone.close();
    await desk.close();
  }
});

// контроль от ложного PASS: строгая проверка серого отвергает холодный серый T5.6 и принимает чистый
test('UI-01 control check: the pure-grey probe rejects a tinted grey', () => {
  const hues = [hsl('rgb(67, 89, 236)').h, hsl('rgb(209, 53, 43)').h];
  expect(pureGrayOrTone('rgb(91, 97, 115)', hues)).toBe(false);
  expect(pureGrayOrTone('rgb(238, 240, 244)', hues)).toBe(false);
  expect(pureGrayOrTone('rgb(28, 28, 28)', hues)).toBe(true);
  expect(pureGrayOrTone('rgba(28, 28, 28, 0.5)', hues)).toBe(true);
  expect(pureGrayOrTone('rgb(67, 89, 236)', hues)).toBe(true);
});
