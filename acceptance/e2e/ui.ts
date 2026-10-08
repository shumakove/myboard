// Средства приёмки T5.6 · оформление интерфейса (UI-01…04).
// Экраны открываются через публичные маршруты (ARCHITECTURE.md, раздел 4), наблюдение —
// вычисленные стили видимых элементов и hit-test в браузере. Код из apps/ не импортируется.
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { expect } from './fixtures';
import { apiAdminLogin } from './admin';
import { apiUserLogin, createBoardUser } from './user';
import { canvas } from './camera';
import { obj, seed, type Obj } from './scene';

export type Opts = BrowserContextOptions;

export interface Screen {
  name: string;
  page: Page;
}

export interface Stand {
  token: string;
  boardId: string;
  ownerName: string;
  /** Открыть все экраны UI-02 в профиле `opts` (свой контекст на каждую роль). */
  screens: Screen[];
  close: () => Promise<void>;
}

export const SHAPE: Obj = { type: 'shape', x: 40, y: 40, width: 120, height: 80 };

/**
 * Все экраны UI-02: вход, вход администратора, админка, список досок, запрос имени по ссылке,
 * отказ по неверной ссылке, холст владельца, холст участника, встроенная доска.
 */
export async function openScreens(browser: Browser, opts: Opts, colorScheme: 'light' | 'dark' = 'light'): Promise<Stand> {
  const o: Opts = { ...opts, colorScheme };
  const contexts = [] as Awaited<ReturnType<Browser['newContext']>>[];
  const ctx = async () => {
    const c = await browser.newContext(o);
    contexts.push(c);
    return c;
  };
  const user = await createBoardUser(browser, opts.baseURL);

  // посторонний: страницы входа и отказ по ссылке
  const anon = await ctx();
  const login = await anon.newPage();
  await login.goto('/login');
  await expect(login.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const adminLogin = await anon.newPage();
  await adminLogin.goto('/admin/login');
  await expect(adminLogin.getByRole('button', { name: 'Sign in' })).toBeVisible();
  const badLink = await anon.newPage();
  await badLink.goto(`/b/${'x'.repeat(43)}`);
  await badLink.waitForLoadState('networkidle');

  // администратор
  const adminCtx = await ctx();
  await apiAdminLogin(adminCtx.request);
  const admin = await adminCtx.newPage();
  await admin.goto('/admin/users');
  await expect(admin.getByRole('heading', { name: 'Users' })).toBeVisible();

  // пользователь досок
  const ownerCtx = await ctx();
  await apiUserLogin(ownerCtx.request, user);
  const res = await ownerCtx.request.post('/api/boards', { data: { title: `QA UI ${Date.now()}` } });
  expect(res.status()).toBe(201);
  const boardId = ((await res.json()) as { id: string }).id;
  const token = ((await (await ownerCtx.request.get(`/api/boards/${boardId}/share`)).json()) as { token: string }).token;
  const boards = await ownerCtx.newPage();
  await boards.goto('/');
  await expect(boards.getByRole('button', { name: 'New board' })).toBeVisible();
  const board = await ownerCtx.newPage();
  await board.goto(`/boards/${boardId}`);
  await expect(canvas(board)).toBeVisible();
  await seed(board, boardId, { 'qa-ui': SHAPE });
  await expect(obj(board, 'qa-ui')).toBeVisible();

  // участник по ссылке: запрос имени, холст, встроенная доска
  const joinCtx = await ctx();
  const join = await joinCtx.newPage();
  await join.goto(`/b/${token}`);
  await expect(join.getByLabel('Your name')).toBeVisible();
  const guestCtx = await ctx();
  expect((await guestCtx.request.post(`/api/share/${token}/join`, { data: { name: 'QA Guest' } })).status()).toBe(200);
  const guest = await guestCtx.newPage();
  await guest.goto(`/b/${token}`);
  await expect(canvas(guest)).toBeVisible();
  const embed = await guestCtx.newPage();
  await embed.goto(`/b/${token}/embed`);
  await embed.waitForLoadState('networkidle');

  return {
    token,
    boardId,
    ownerName: user.name,
    screens: [
      { name: 'login', page: login },
      { name: 'admin-login', page: adminLogin },
      { name: 'admin-users', page: admin },
      { name: 'boards', page: boards },
      { name: 'join', page: join },
      { name: 'bad-link', page: badLink },
      { name: 'board', page: board },
      { name: 'board-guest', page: guest },
      { name: 'embed', page: embed },
    ],
    close: async () => {
      await Promise.all(contexts.map((c) => c.close()));
    },
  };
}

export const screen = (st: Stand, name: string) => st.screens.find((s) => s.name === name)!.page;

/** Вычисленные стили, которые сравниваются между экранами и кнопками. */
export const SIG_PROPS = [
  'background-color', 'color', 'border-top-color', 'border-top-width', 'border-top-style', 'border-radius',
  'font-family', 'font-size', 'font-weight', 'line-height', 'height', 'padding-top', 'padding-left', 'box-shadow',
] as const;

export async function signature(page: Page, selector: string | ReturnType<Page['locator']>, props: readonly string[] = SIG_PROPS) {
  const l = typeof selector === 'string' ? page.locator(selector).first() : selector;
  return l.evaluate((e, props) => {
    const cs = getComputedStyle(e);
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
  }, props as string[]);
}

export interface ElStyle {
  tag: string;
  label: string;
  inContent: boolean;
  isControl: boolean;
  bg: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  radius: string;
  shadow: string;
  fontSize: string;
  fontFamily: string;
  padding: string[];
  hasText: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * Стили всех видимых элементов страницы. Содержимое доски (объекты сцены, миниатюры объектов
 * в миникарте) помечается `inContent` — это данные документа, а не оформление интерфейса.
 */
export async function collectStyles(page: Page): Promise<ElStyle[]> {
  return page.evaluate(() => {
    const out: ElStyle[] = [];
    const isContent = (e: Element) => !!e.closest('[data-object-id]');
    for (const e of Array.from(document.body.querySelectorAll('*'))) {
      if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      if (r.width < 1 || r.height < 1 || cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const own = Array.from(e.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').trim().length > 0);
      const role = e.getAttribute('role') ?? '';
      const tag = e.tagName.toLowerCase();
      out.push({
        tag,
        label: (e.getAttribute('aria-label') ?? (e.textContent ?? '').trim().slice(0, 30)) + (e.className && typeof e.className === 'string' ? ` .${e.className.split(' ').join('.')}` : ''),
        inContent: isContent(e),
        isControl: ['button', 'a', 'input', 'select', 'textarea'].includes(tag) || ['button', 'menuitem', 'tab', 'switch', 'checkbox', 'link'].includes(role),
        bg: cs.backgroundColor,
        color: cs.color,
        borderColor: cs.borderTopColor,
        borderWidth: Math.max(parseFloat(cs.borderTopWidth), parseFloat(cs.borderBottomWidth), parseFloat(cs.borderLeftWidth), parseFloat(cs.borderRightWidth)),
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        padding: [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft],
        hasText: own,
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
      });
    }
    return out;
  });
}

export type RGBA = [number, number, number, number];

export function rgba(c: string): RGBA | null {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
}

/** Относительная яркость (WCAG). */
export function luminance(c: string): number {
  const v = rgba(c);
  if (!v) return NaN;
  const lin = (x: number) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(v[0]) + 0.7152 * lin(v[1]) + 0.0722 * lin(v[2]);
}

/** Тон и насыщенность HSL. */
export function hsl(c: string): { h: number; s: number; l: number } {
  const v = rgba(c)!;
  const [r, g, b] = [v[0] / 255, v[1] / 255, v[2] / 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export const transparent = (c: string) => (rgba(c)?.[3] ?? 0) === 0;

/** Серый: каналы отличаются не более чем на 16. */
export function isGray(c: string): boolean {
  const v = rgba(c);
  if (!v) return true;
  return Math.max(v[0], v[1], v[2]) - Math.min(v[0], v[1], v[2]) <= 16;
}

export const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

/** Цвет того же тона, что один из `hues` (±12°), или серый. */
export function inPalette(c: string, hues: number[]): boolean {
  if (isGray(c) || transparent(c)) return true;
  const { h } = hsl(c);
  return hues.some((x) => hueDist(h, x) <= 12);
}

/** Стиль ближайшей к элементу непрозрачной подложки (панель, в которой он лежит). */
export async function panelOf(page: Page, l: ReturnType<Page['locator']>) {
  return l.evaluate((e) => {
    // сам элемент управления (кнопка, поле) — не панель: подложка ищется начиная с родителя
    const control = e.matches('button, a, input, select, textarea, [role="button"]');
    let n: Element | null = control ? e.parentElement : e;
    while (n && n !== document.body) {
      const cs = getComputedStyle(n);
      const a = cs.backgroundColor.match(/rgba?\(([^)]+)\)/)?.[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      if (a && (a.length < 4 || a[3] > 0)) {
        return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow, tag: n.tagName, cls: String((n as HTMLElement).className) };
      }
      n = n.parentElement;
    }
    return null;
  });
}
