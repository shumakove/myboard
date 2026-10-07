// Средства приёмки T5.2 · сцена, создание и выделение (CVS-06, CVS-09…14, CVS-21, CVS-23, MOB-03).
// Объекты наблюдаются снаружи: DOM-элементы на холсте (подписи — из handoff T5.2) и документ доски,
// который получает отдельный поздний клиент по /api/ws.
import type { CDPSession, Locator, Page } from '@playwright/test';
import * as Y from 'yjs';
import { expect } from './fixtures';
import { canvas, docSeenByLateClient, varuint, type Point } from './camera';

export type Box = { x: number; y: number; width: number; height: number };
export type Obj = {
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  z?: number;
  fill?: string;
  text?: string;
  [k: string]: unknown;
};

export const obj = (page: Page, id: string) => page.locator(`[data-object-id="${id}"]`);
export const allObjects = (page: Page) => page.locator('[data-object-id]');
export const selected = (page: Page) => page.locator('[data-object-id][aria-selected="true"]');
export const tools = (page: Page) => page.getByRole('toolbar', { name: 'Tools' });
export const tool = (page: Page, name: string) => tools(page).getByRole('button', { name, exact: true });
export const selectionBar = (page: Page) => page.getByRole('toolbar', { name: 'Selection' });
export const objectMenu = (page: Page) => page.getByRole('menu', { name: 'Object menu' });
export const boardMenu = (page: Page) => page.getByRole('menu', { name: 'Board menu' });
export const handle = (page: Page, name: string) => page.locator(`[data-handle="${name}"]`);

export const centerOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

export async function boxOf(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('элемент не виден');
  return b;
}

/** Идентификаторы выделенных объектов на странице. */
export async function selectedIds(page: Page): Promise<string[]> {
  return (await selected(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();
}

/** Идентификаторы объектов на холсте страницы. */
export async function objectIds(page: Page): Promise<string[]> {
  return (await allObjects(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-object-id') ?? ''))).sort();
}

export interface DocState {
  objects: Record<string, Obj>;
  trash: Record<string, Record<string, unknown>>;
  settings: Record<string, unknown>;
}

/** Документ доски глазами нового клиента (объекты — в локальных координатах, см. FRAME). */
export async function docState(page: Page, boardId: string): Promise<DocState> {
  const doc = await docSeenByLateClient(page, `board=${boardId}`);
  const objects = doc.getMap('objects').toJSON() as Record<string, Obj>;
  return {
    objects: Object.fromEntries(Object.entries(objects).map(([id, o]) => [id, shift(o, -1)])),
    trash: doc.getMap('trash').toJSON() as Record<string, Record<string, unknown>>,
    settings: doc.getMap('settings').toJSON() as Record<string, unknown>,
  };
}

/** Записать правку в документ доски сторонним клиентом (кадр `sync Update` по каналу страницы). */
export async function writeDoc(page: Page, boardId: string, build: (doc: Y.Doc) => void) {
  const doc = new Y.Doc();
  build(doc);
  const update = Y.encodeStateAsUpdate(doc);
  const bytes = [0, 2, ...varuint(update.length), ...update];
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
    { query: `board=${boardId}`, bytes },
  );
}

/**
 * Локальная система координат тестов: мировые координаты сдвинуты на FRAME, чтобы сцена (0…400) при
 * начальном виде (начало мира — в центре холста) попадала в левую верхнюю часть холста, мимо миникарты.
 * `seed` прибавляет FRAME, `docState` вычитает его у объектов — тесты работают в локальных координатах.
 */
export const FRAME = { x: -240, y: -160 };

const shift = (o: Obj, k: number): Obj =>
  typeof o?.x === 'number' && typeof o?.y === 'number' ? { ...o, x: o.x + k * FRAME.x, y: o.y + k * FRAME.y } : o;

/** Положить объекты (JSON, локальные координаты) в документ и дождаться их на холсте страницы. */
export async function seed(page: Page, boardId: string, items: Record<string, Obj>) {
  await writeDoc(page, boardId, (doc) => {
    const objects = doc.getMap('objects');
    for (const [id, o] of Object.entries(items)) objects.set(id, shift(o, 1));
  });
  for (const id of Object.keys(items)) await expect(obj(page, id)).toBeAttached();
}

/** Камера страницы по неподвижному опорному объекту `ref` с известными мировыми координатами. */
export async function cameraBy(page: Page, refId: string, ref: Obj) {
  const b = await boxOf(obj(page, refId));
  const zoom = b.width / ref.width;
  return {
    zoom,
    refScreen: { x: b.x, y: b.y },
    toWorld: (p: Point): Point => ({ x: ref.x + (p.x - b.x) / zoom, y: ref.y + (p.y - b.y) / zoom }),
    toScreen: (w: Point): Point => ({ x: b.x + (w.x - ref.x) * zoom, y: b.y + (w.y - ref.y) * zoom }),
  };
}

/**
 * Точка видимой части холста по долям её размера. На телефоне холст может уходить за нижний край
 * окна (панели над ним — MOB-01, T11.1): тогда страница прокручивается к холсту, и доли берутся
 * от пересечения холста с окном.
 */
export async function onCanvas(page: Page, fx: number, fy: number): Promise<Point> {
  const vh = page.viewportSize()?.height ?? 10_000;
  let b = await boxOf(canvas(page));
  if (b.y < 0 || b.y + b.height > vh) {
    await canvas(page).evaluate((e) => e.scrollIntoView({ block: 'start' }));
    b = await boxOf(canvas(page));
  }
  const top = Math.max(b.y, 0);
  const bottom = Math.min(b.y + b.height, vh);
  return { x: b.x + b.width * fx, y: top + (bottom - top) * fy };
}

/** Перетаскивание мышью с ведением указателя по точкам пути. */
export async function mousePath(page: Page, pts: Point[], opts: { steps?: number; holdMs?: number } = {}) {
  const steps = opts.steps ?? 4;
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) await page.mouse.move(pts[i].x, pts[i].y, { steps });
  if (opts.holdMs) await page.waitForTimeout(opts.holdMs);
  await page.mouse.up();
}

/** Ждать, пока значение из документа (поздний клиент) удовлетворит проверке. */
export async function untilDoc<T>(page: Page, boardId: string, pick: (d: DocState) => T, check: (v: T) => void, timeout = 15_000): Promise<T> {
  let last: T | undefined;
  await expect(async () => {
    last = pick(await docState(page, boardId));
    check(last);
  }).toPass({ timeout, intervals: [300, 500, 1000] });
  return last as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Один палец через CDP: касание, удержание, движение. */
export class Finger {
  private constructor(private cdp: CDPSession) {}

  static async of(page: Page): Promise<Finger> {
    return new Finger(await page.context().newCDPSession(page));
  }

  private send(type: string, p?: Point) {
    return this.cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] : [],
    } as never);
  }

  async down(p: Point) {
    await this.send('touchStart', p);
  }

  /** Вести палец к `to` за `steps` шагов по 16 мс. */
  async moveTo(from: Point, to: Point, steps = 8) {
    for (let i = 1; i <= steps; i++) {
      await this.send('touchMove', { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      await sleep(16);
    }
  }

  async hold(ms: number) {
    await sleep(ms);
  }

  async up() {
    await this.send('touchEnd');
  }
}
