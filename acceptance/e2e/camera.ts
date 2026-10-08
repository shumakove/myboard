// Средства приёмки T5.1 · камера холста (CVS-01…05, MOB-02).
// Камера наблюдается снаружи: «зонд» наводит указатель на точку экрана и читает точку мира
// из кадра `awareness`, который страница отправляет по WebSocket (курсор — точка мира, T4.2).
// Подписи интерфейса — из handoff T5.1.
import type { Browser, BrowserContextOptions, CDPSession, Page } from '@playwright/test';
import * as Y from 'yjs';
import { expect } from './fixtures';
import { apiUserLogin, createBoardUser } from './user';

export type Point = { x: number; y: number };
export type Opts = BrowserContextOptions;

const AWARENESS = 1;
const SYNC = 0;
const UPDATE = 2;

export const canvas = (page: Page) => page.getByTestId('board-canvas');
export const minimap = (page: Page) => page.getByTestId('minimap');
export const minimapView = (page: Page) => page.getByTestId('minimap-view');
export const viewBar = (page: Page) => page.getByRole('toolbar', { name: 'View' });
export const zoomLevel = (page: Page) => page.getByLabel('Zoom level');
export const wheelSelect = (page: Page) => page.getByLabel('Mouse wheel');

export function readVaruint(data: Buffer, start: number): [number, number] {
  let pos = start;
  let result = 0;
  let shift = 0;
  for (;;) {
    const byte = data[pos++];
    result += (byte & 0x7f) * 2 ** shift;
    if (byte < 0x80) return [result, pos];
    shift += 7;
  }
}

export function varuint(value: number): number[] {
  const out: number[] = [];
  for (;;) {
    const byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value) out.push(byte | 0x80);
    else {
      out.push(byte);
      return out;
    }
  }
}

/** Отправленные страницей кадры канала доски: состояния `awareness` и число кадров `sync`. */
export interface Wire {
  sent: Array<Record<string, unknown>>;
  syncSent: number;
}

/** Подписаться на кадры канала доски до перехода на страницу. */
export function watchWire(page: Page): Wire {
  const wire: Wire = { sent: [], syncSent: 0 };
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/ws')) return;
    ws.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      const [type, p1] = readVaruint(payload, 0);
      if (type === SYNC) {
        const [sub] = readVaruint(payload, p1);
        if (sub === UPDATE) wire.syncSent += 1;
        return;
      }
      if (type !== AWARENESS) return;
      const [len, p2] = readVaruint(payload, p1);
      try {
        wire.sent.push(JSON.parse(payload.subarray(p2, p2 + len).toString('utf8')) as Record<string, unknown>);
      } catch {
        /* не JSON — не наш кадр */
      }
    });
  });
  return wire;
}

/** Точка холста по долям его размера (координаты окна). */
export async function at(page: Page, fx: number, fy: number): Promise<Point> {
  const box = await canvas(page).boundingBox();
  if (!box) throw new Error('холст не виден');
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Точка мира под точкой экрана `s` — из курсора, отправленного страницей в `awareness`. */
export async function worldAt(page: Page, wire: Wire, s: Point): Promise<Point> {
  const n = wire.sent.length;
  await page.mouse.move(s.x - 4, s.y - 3);
  await page.mouse.move(s.x, s.y, { steps: 2 });
  let last: Point | null = null;
  await expect(async () => {
    const fresh = wire.sent.slice(n).filter((st) => st.cursor);
    expect(fresh.length, 'страница не отправила курсор').toBeGreaterThan(0);
    const c = fresh[fresh.length - 1].cursor as Point;
    const stable = last !== null && last.x === c.x && last.y === c.y;
    last = c;
    expect(stable).toBe(true);
  }).toPass({ intervals: [150, 250, 250, 400, 600] });
  return last as unknown as Point;
}

/** Вид камеры по зонду: точка мира в центре холста и масштаб (пикселей экрана на единицу мира). */
export interface View {
  center: Point;
  zoom: number;
}

export async function viewOf(page: Page, wire: Wire): Promise<View> {
  const a = await at(page, 0.3, 0.5);
  const b = await at(page, 0.7, 0.5);
  const c = await at(page, 0.5, 0.5);
  const wa = await worldAt(page, wire, a);
  const wb = await worldAt(page, wire, b);
  const center = await worldAt(page, wire, c);
  const zoom = (b.x - a.x) / (wb.x - wa.x);
  return { center, zoom };
}

export function close(actual: number, expected: number, rel = 0.03, abs = 2) {
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(
    Math.max(abs, Math.abs(expected) * rel),
  );
}

export async function waitIdle(page: Page) {
  await page.waitForTimeout(250);
}

export function profileOpts(p: {
  baseURL?: string;
  viewport: Opts['viewport'];
  hasTouch: boolean;
  isMobile: boolean;
  userAgent?: string;
  deviceScaleFactor?: number;
}): Opts {
  const { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } = p;
  return { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
}

export interface Owner {
  page: Page;
  wire: Wire;
  name: string;
  boardId: string;
  token: string;
  newBoard: () => Promise<string>;
  close: () => Promise<void>;
}

/** Владелец (пользователь досок) со своей доской, вкладка открыта на доске. */
export async function openOwner(browser: Browser, opts: Opts): Promise<Owner> {
  const user = await createBoardUser(browser, opts.baseURL);
  const context = await browser.newContext(opts);
  await apiUserLogin(context.request, user);
  const newBoard = async () => {
    const res = await context.request.post('/api/boards', { data: { title: `QA camera ${Date.now()}` } });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const boardId = await newBoard();
  const share = await context.request.get(`/api/boards/${boardId}/share`);
  const token = ((await share.json()) as { token: string }).token;
  const page = await context.newPage();
  const wire = watchWire(page);
  await page.goto(`/boards/${boardId}`);
  await expect(canvas(page)).toBeVisible();
  return { page, wire, name: user.name, boardId, token, newBoard, close: () => context.close() };
}

/** Участник по ссылке в своём контексте браузера. */
export async function openGuest(browser: Browser, opts: Opts, token: string, name: string) {
  const context = await browser.newContext(opts);
  const joined = await context.request.post(`/api/share/${token}/join`, { data: { name } });
  expect(joined.status()).toBe(200);
  const page = await context.newPage();
  const wire = watchWire(page);
  await page.goto(`/b/${token}`);
  await expect(canvas(page)).toBeVisible();
  return { page, wire, context, close: () => context.close() };
}

/** Перетащить мышью (левая кнопка) на `d` пикселей экрана. */
export async function dragBy(page: Page, from: Point, d: Point, button: 'left' | 'middle' = 'left') {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  await page.mouse.move(from.x + d.x / 2, from.y + d.y / 2, { steps: 5 });
  await page.mouse.move(from.x + d.x, from.y + d.y, { steps: 5 });
  await page.mouse.up({ button });
}

/** Сенсорный ввод через CDP (несколько пальцев). */
export class Touch {
  private constructor(private cdp: CDPSession) {}

  static async of(page: Page): Promise<Touch> {
    return new Touch(await page.context().newCDPSession(page));
  }

  private send(type: string, pts: Point[]) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })),
    } as never);
  }

  /** Движение пальцев из `from` в `to` (по одной точке на палец), за `steps` шагов. */
  async gesture(from: Point[], to: Point[], steps = 10) {
    await this.send('touchStart', from);
    for (let i = 1; i <= steps; i++) {
      const pts = from.map((f, k) => ({ x: f.x + ((to[k].x - f.x) * i) / steps, y: f.y + ((to[k].y - f.y) * i) / steps }));
      await this.send('touchMove', pts);
      await sleep(16);
    }
    await this.send('touchEnd', []);
  }

  async tap(p: Point) {
    await this.send('touchStart', [p]);
    await sleep(40);
    await this.send('touchEnd', []);
  }
}

/** Записать объект в документ доски по каналу страницы (cookie её контекста). */
export async function putObject(page: Page, query: string, id: string, obj: Record<string, unknown>) {
  const doc = new Y.Doc();
  doc.getMap('objects').set(id, obj);
  const update = Y.encodeStateAsUpdate(doc);
  const bytes = [...varuint(SYNC), ...varuint(UPDATE), ...varuint(update.length), ...update];
  await page.evaluate(
    async ({ query, bytes }) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?${query}`;
      const ws = new WebSocket(url);
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

/** Документ доски целиком, как его получает новый клиент (свой канал в контексте страницы). */
export async function docSeenByLateClient(page: Page, query: string): Promise<Y.Doc> {
  const frames: number[][] = await page.evaluate(async (query) => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?${query}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const got: number[][] = [];
    ws.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) got.push([...new Uint8Array(e.data)]);
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('канал не открылся'));
    });
    // sync step 1 с пустым вектором версии
    ws.send(new Uint8Array([0, 0, 1, 0]));
    await new Promise((r) => setTimeout(r, 1000));
    ws.close();
    return got;
  }, query);
  const doc = new Y.Doc();
  for (const f of frames) {
    const data = Buffer.from(f);
    const [type, p1] = readVaruint(data, 0);
    if (type !== SYNC) continue;
    const [sub, p2] = readVaruint(data, p1);
    if (sub !== 1 && sub !== UPDATE) continue;
    const [len, p3] = readVaruint(data, p2);
    Y.applyUpdate(doc, new Uint8Array(data.subarray(p3, p3 + len)));
  }
  return doc;
}

/** Объекты документа, которые видит новый клиент (свой контекст страницы). */
export async function objectsSeenByLateClient(page: Page, query: string): Promise<Record<string, unknown>> {
  return (await docSeenByLateClient(page, query)).getMap('objects').toJSON() as Record<string, unknown>;
}
