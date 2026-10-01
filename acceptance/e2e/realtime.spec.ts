// Приёмка T4.1 · канал доски в браузере (COL-01, SHR-04 канал, SHR-06 WebSocket, ARCH-T41-02).
// Сценарии — docs/qa/reports/T4.1.md; подписи состояния связи и протокол — из handoff T4.1.
// Холста ещё нет (T5.*): правки шлёт независимый клиент кадрами y-protocols, а браузерный
// канал проверяется по принятым кадрам (их содержимое собирается в документ Yjs в тесте).
import type { Browser, BrowserContextOptions, Page, WebSocket } from '@playwright/test';
import * as Y from 'yjs';
import { test, expect } from './fixtures';

const LIVE = 'Live: changes are shared with everyone on the board.';
const SYNC = 0;
const STEP2 = 1;
const UPDATE = 2;

function varuint(value: number): number[] {
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

function frame(sub: number, payload: Uint8Array): number[] {
  return [...varuint(SYNC), ...varuint(sub), ...varuint(payload.length), ...payload];
}

function parse(data: Buffer): { type: number; sub: number; payload: Uint8Array } {
  let pos = 0;
  const read = () => {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = data[pos++];
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
      shift += 7;
    }
  };
  const type = read();
  const sub = read();
  const length = read();
  return { type, sub, payload: new Uint8Array(data.subarray(pos, pos + length)) };
}

/** Документ Yjs, собранный из кадров sync, которые принял браузер. */
function watchChannel(page: Page): { socket: Promise<WebSocket>; doc: Y.Doc; frames: Buffer[] } {
  const doc = new Y.Doc();
  const frames: Buffer[] = [];
  const socket = page.waitForEvent('websocket', (ws) => ws.url().includes('/api/ws'));
  void socket.then((ws) =>
    ws.on('framereceived', ({ payload }) => {
      if (typeof payload === 'string') return;
      frames.push(payload);
      const { type, sub, payload: body } = parse(payload);
      if (type === SYNC && (sub === STEP2 || sub === UPDATE)) Y.applyUpdate(doc, body);
    }),
  );
  return { socket, doc, frames };
}

function profile(p: {
  baseURL?: string;
  viewport: BrowserContextOptions['viewport'];
  hasTouch: boolean;
  isMobile: boolean;
  userAgent?: string;
  deviceScaleFactor?: number;
}): BrowserContextOptions {
  const { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor } = p;
  return { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
}

async function shareToken(owner: Page, boardId: string): Promise<string> {
  const res = await owner.request.get(`/api/boards/${boardId}/share`);
  expect(res.status()).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

/** Участник по ссылке в отдельном контексте («другой браузер»). */
async function participant(browser: Browser, opts: BrowserContextOptions, token: string, name: string) {
  const context = await browser.newContext(opts);
  const joined = await context.request.post(`/api/share/${token}/join`, { data: { name } });
  expect(joined.status()).toBe(200);
  const page = await context.newPage();
  return { page, close: () => context.close() };
}

/** Отправить правку из вкладки по её собственному каналу (cookie контекста, тот же адрес). */
async function sendEditFromPage(page: Page, query: string, update: Uint8Array): Promise<void> {
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
      // дождаться, пока сервер примет: короткая пауза и закрытие
      await new Promise((r) => setTimeout(r, 500));
      ws.close();
    },
    { query, bytes: frame(UPDATE, update) },
  );
}

function stickyUpdate(id: string, text: string): Uint8Array {
  const doc = new Y.Doc();
  const obj = new Y.Map<unknown>();
  obj.set('type', 'sticky');
  obj.set('text', new Y.Text(text));
  doc.getMap('objects').set(id, obj);
  return Y.encodeStateAsUpdate(doc);
}

function objectIds(doc: Y.Doc): string[] {
  return [...doc.getMap('objects').keys()].sort();
}

test('COL-01 SHR-04 owner and participant browsers are live and receive each other edits', async ({
  boardUserPage: owner,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const p = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const token = await shareToken(owner, board.id);
  const ownerChannel = watchChannel(owner);
  await owner.goto(`/boards/${board.id}`);
  await expect(owner.getByRole('status').filter({ hasText: LIVE })).toBeVisible();

  const guest = await participant(browser, profile(p), token, 'Browser Guest');
  try {
    const guestChannel = watchChannel(guest.page);
    await guest.page.goto(`/b/${token}`);
    await expect(guest.page.getByRole('status').filter({ hasText: LIVE })).toBeVisible();

    // правка участника по его каналу доходит до браузера владельца, и наоборот
    await sendEditFromPage(guest.page, `token=${token}`, stickyUpdate('from-guest', 'hi'));
    await expect.poll(() => objectIds(ownerChannel.doc)).toContain('from-guest');
    await sendEditFromPage(owner, `board=${board.id}`, stickyUpdate('from-owner', 'yo'));
    await expect.poll(() => objectIds(guestChannel.doc)).toContain('from-owner');

    // каналы браузеров не оборвались
    await expect(owner.getByRole('status').filter({ hasText: LIVE })).toBeVisible();
    await expect(guest.page.getByRole('status').filter({ hasText: LIVE })).toBeVisible();
    expect((await ownerChannel.socket).isClosed()).toBe(false);
  } finally {
    await guest.close();
  }
});

test('COL-01 browser opening the board later receives the current document', async ({ boardUserPage: owner, board }) => {
  await owner.goto(`/boards/${board.id}`);
  await expect(owner.getByRole('status').filter({ hasText: LIVE })).toBeVisible();
  await sendEditFromPage(owner, `board=${board.id}`, stickyUpdate('early', 'first'));
  const late = watchChannel(owner);
  await owner.reload();
  await expect(owner.getByRole('status').filter({ hasText: LIVE })).toBeVisible();
  await expect.poll(() => objectIds(late.doc)).toEqual(['early']);
  expect(late.doc.getMap('objects').get('early')).toBeInstanceOf(Y.Map);
});

test('SHR-06 participant tab loses the live channel right after reset, without reload', async ({
  boardUserPage: owner,
  board,
  browser,
  baseURL,
  viewport,
  hasTouch,
  isMobile,
  userAgent,
  deviceScaleFactor,
}) => {
  const p = { baseURL, viewport, hasTouch, isMobile, userAgent, deviceScaleFactor };
  const token = await shareToken(owner, board.id);
  const guest = await participant(browser, profile(p), token, 'Doomed Guest');
  try {
    const channel = watchChannel(guest.page);
    await guest.page.goto(`/b/${token}`);
    await expect(guest.page.getByRole('status').filter({ hasText: LIVE })).toBeVisible();
    const ws = await channel.socket;
    expect((await owner.request.post(`/api/boards/${board.id}/share/reset`)).status()).toBe(200);
    await expect.poll(() => ws.isClosed(), { timeout: 5000 }).toBe(true);
    await expect(guest.page.getByText('This link is not available.')).toBeVisible();
    await expect(guest.page.getByRole('status').filter({ hasText: LIVE })).toHaveCount(0);
  } finally {
    await guest.close();
  }
});

test('ARCH-T41-02 board channel uses the page address, not localhost', async ({ boardUserPage: owner, board, baseURL }) => {
  const channel = watchChannel(owner);
  await owner.goto(`/boards/${board.id}`);
  const ws = await channel.socket;
  const url = new URL(ws.url());
  const page = new URL(baseURL!);
  expect(url.protocol).toBe(page.protocol === 'https:' ? 'wss:' : 'ws:');
  expect(url.host).toBe(page.host);
  expect(url.pathname).toBe('/api/ws');
  expect(ws.url()).not.toContain('localhost');
  await expect(owner.getByRole('status').filter({ hasText: LIVE })).toBeVisible();
});
