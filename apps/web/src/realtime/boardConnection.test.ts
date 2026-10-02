import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardConnection, type ConnectionStatus } from "./boardConnection";
import { AWARENESS_INTERVAL_MS, BoardPresence } from "./boardPresence";
import { createBoardDocument, type BoardDocument } from "./boardDocument";
import { decodeClientFrame, FakeBoardServer, FakeSocket } from "./fakeSocket";
import { SyncKind } from "./messages";

interface Client {
  board: BoardDocument;
  presence: BoardPresence;
  connection: BoardConnection;
  statuses: ConnectionStatus[];
}

function connect(
  checkAccess: () => Promise<boolean> = () => Promise.resolve(true),
): Client {
  const board = createBoardDocument();
  const presence = new BoardPresence();
  const statuses: ConnectionStatus[] = [];
  const connection = new BoardConnection({
    doc: board.doc,
    url: "ws://192.168.1.20:8080/api/ws?board=b-1",
    presence,
    onStatus: (status) => statuses.push(status),
    checkAccess,
    createSocket: (url) => new FakeSocket(url) as unknown as WebSocket,
    retryDelays: [100],
  });
  return { board, presence, connection, statuses };
}

function addSticker(board: BoardDocument): Y.Map<unknown> {
  const sticker = new Y.Map<unknown>();
  sticker.set("type", "sticker");
  sticker.set("text", new Y.Text("Hello"));
  board.objects.set("s1", sticker);
  return sticker;
}

function sticker(board: BoardDocument): Y.Map<unknown> {
  return board.objects.get("s1") as Y.Map<unknown>;
}

describe("BoardConnection — синхронизация документа доски (COL-01)", () => {
  let server: FakeBoardServer;

  beforeEach(() => {
    FakeSocket.instances = [];
    server = new FakeBoardServer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("COL-01: два клиента правят один объект и один текст — оба видят объединённый результат", () => {
    const first = connect();
    server.accept(FakeSocket.last());
    const second = connect();
    server.accept(FakeSocket.last());

    addSticker(first.board);
    // Одновременно: у каждого своё свойство и своя вставка в тот же текст.
    first.board.doc.transact(() => {
      sticker(first.board).set("x", 120);
      (sticker(first.board).get("text") as Y.Text).insert(5, " world");
    });
    second.board.doc.transact(() => {
      sticker(second.board).set("color", "yellow");
      (sticker(second.board).get("text") as Y.Text).insert(0, "Hi! ");
    });

    const expected = {
      s1: { type: "sticker", x: 120, color: "yellow", text: "Hi! Hello world" },
    };
    expect(first.board.objects.toJSON()).toEqual(expected);
    expect(second.board.objects.toJSON()).toEqual(expected);
    expect(first.statuses).toEqual(["online"]);
  });

  it("поздно подключившийся клиент получает текущее состояние", () => {
    const first = connect();
    server.accept(FakeSocket.last());
    addSticker(first.board);

    const late = connect();
    expect(late.board.objects.size).toBe(0);
    server.accept(FakeSocket.last());

    expect(late.board.objects.toJSON()).toEqual(first.board.objects.toJSON());
  });

  it("чужие правки не отправляются обратно на сервер", () => {
    const first = connect();
    server.accept(FakeSocket.last());
    const second = connect();
    server.accept(FakeSocket.last());
    const secondSocket = FakeSocket.last();
    const sentBefore = secondSocket.sent.length;

    addSticker(first.board);

    expect(second.board.objects.has("s1")).toBe(true);
    expect(secondSocket.sent.length).toBe(sentBefore);
  });

  it("правки без связи доезжают после переподключения", async () => {
    vi.useFakeTimers();
    const owner = connect();
    server.accept(FakeSocket.last());
    const guest = connect();
    const guestSocket = FakeSocket.last();
    server.accept(guestSocket);
    addSticker(owner.board);

    server.disconnect(guestSocket);
    await vi.advanceTimersByTimeAsync(0);
    expect(guest.statuses.at(-1)).toBe("offline");
    sticker(guest.board).set("x", 42); // связи нет — правка копится в документе
    expect(sticker(owner.board).get("x")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(100);
    expect(FakeSocket.instances).toHaveLength(3);
    server.accept(FakeSocket.last());

    expect(sticker(owner.board).get("x")).toBe(42);
    expect(guest.statuses.at(-1)).toBe("online");
  });

  it("без доступа после разрыва — closed и без переподключения", async () => {
    vi.useFakeTimers();
    const client = connect(() => Promise.resolve(false));
    const socket = FakeSocket.last();
    server.accept(socket);

    server.disconnect(socket, 4403);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(client.statuses).toEqual(["online", "offline", "closed"]);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it("сбой проверки доступа (нет сети) — переподключается", async () => {
    vi.useFakeTimers();
    connect(() => Promise.reject(new Error("offline")));
    server.disconnect(FakeSocket.last());

    await vi.advanceTimersByTimeAsync(100);

    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("destroy закрывает соединение и больше не отправляет правки", () => {
    const client = connect();
    const socket = FakeSocket.last();
    server.accept(socket);

    client.connection.destroy();
    addSticker(client.board);

    expect(socket.readyState).toBe(3);
    const updates = socket.sent
      .map(decodeClientFrame)
      .filter((m) => m.type === "sync" && m.kind === SyncKind.Update);
    expect(updates).toEqual([]);
  });
});

describe("BoardConnection — присутствие (COL-02, COL-09)", () => {
  let server: FakeBoardServer;

  beforeEach(() => {
    FakeSocket.instances = [];
    server = new FakeBoardServer();
    // Своё состояние уходит не чаще AWARENESS_INTERVAL_MS.
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("второй клиент видит первого в списке и его курсор; после отключения — нет", () => {
    const owner = connect();
    server.accept(FakeSocket.last(), "Alice");
    const ownerSocket = FakeSocket.last();
    const guest = connect();
    server.accept(FakeSocket.last(), "Kate");

    owner.presence.setLocal({ cursor: { x: 40, y: 50 } });
    vi.advanceTimersByTime(AWARENESS_INTERVAL_MS);

    const seen = guest.presence.getSnapshot().peers;
    expect(seen.map((p) => [p.name, p.self])).toEqual([
      ["Alice", false],
      ["Kate", true],
    ]);
    expect(seen[0]?.state.cursor).toEqual({ x: 40, y: 50 });

    server.disconnect(ownerSocket);
    expect(guest.presence.getSnapshot().peers.map((p) => p.name)).toEqual([
      "Kate",
    ]);
  });

  it("поздно вошедший сразу видит курсор того, кто уже на доске", () => {
    const owner = connect();
    server.accept(FakeSocket.last(), "Alice");
    owner.presence.setLocal({ cursor: { x: 1, y: 2 } });
    vi.advanceTimersByTime(AWARENESS_INTERVAL_MS);

    const late = connect();
    server.accept(FakeSocket.last(), "Kate");

    expect(late.presence.getSnapshot().peers[0]?.state.cursor).toEqual({
      x: 1,
      y: 2,
    });
  });

  it("присутствие не попадает в документ доски", () => {
    const owner = connect();
    server.accept(FakeSocket.last(), "Alice");
    owner.presence.setLocal({ cursor: { x: 1, y: 2 } });

    const frames = FakeSocket.last().sent.map(decodeClientFrame);
    expect(frames.some((f) => f.type === "awareness")).toBe(true);
    expect(
      frames.filter((f) => f.type === "sync" && f.kind === SyncKind.Update),
    ).toEqual([]);
    expect(server.doc.share.size).toBe(0);
  });
});
