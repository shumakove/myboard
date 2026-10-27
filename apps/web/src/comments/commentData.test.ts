import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createObject, readScene, writeFields } from "../scene/sceneObjects";
import { linkedDocs } from "../scene/testDocs";
import {
  addReply,
  anchorAt,
  createThread,
  filterThreads,
  participants,
  pinPoint,
  readThreads,
  setResolved,
  setThreadColor,
} from "./commentData";

function stickyBoard() {
  const board = createBoardDocument();
  const id = createObject(board.objects, "sticky", { x: 100, y: 100 });
  const sticky = () => {
    const found = readScene(board.objects).find((o) => o.id === id);
    if (found === undefined) throw new Error("нет стикера");
    return found;
  };
  return { board, id, sticky };
}

describe("CMT-01: привязка к объекту и к точке", () => {
  it("метка у объекта едет вместе с ним при перемещении", () => {
    const { board, id, sticky } = stickyBoard();
    const anchor = anchorAt(sticky(), { x: 110, y: 120 });
    expect(anchor).toMatchObject({ object: id });
    expect(pinPoint(anchor, readScene(board.objects))).toEqual({
      x: 110,
      y: 120,
    });

    writeFields(board.objects, new Map([[id, { x: 400, y: -50 }]]), "Bob");
    expect(pinPoint(anchor, readScene(board.objects))).toEqual({
      x: 410,
      y: -30,
    });
  });

  it("метка у объекта следует за размером и поворотом", () => {
    const { board, id, sticky } = stickyBoard();
    const { width, height } = sticky();
    // Правый верхний угол объекта.
    const anchor = anchorAt(sticky(), { x: 100 + width, y: 100 });
    writeFields(
      board.objects,
      new Map([[id, { width: width * 2, height: height * 2 }]]),
      "Bob",
    );
    expect(pinPoint(anchor, readScene(board.objects))).toEqual({
      x: 100 + width * 2,
      y: 100,
    });

    writeFields(board.objects, new Map([[id, { rotation: 180 }]]), "Bob");
    const at = pinPoint(anchor, readScene(board.objects));
    // После поворота на 180° правый верхний угол — слева внизу.
    expect(at?.x).toBeCloseTo(100);
    expect(at?.y).toBeCloseTo(100 + height * 2);
  });

  it("метка в точке холста стоит на месте; без объекта на холсте метки нет", () => {
    const { board, id, sticky } = stickyBoard();
    const point = anchorAt(null, { x: -30, y: 40 });
    expect(point).toEqual({ object: null, x: -30, y: 40 });
    expect(pinPoint(point, [])).toEqual({ x: -30, y: 40 });

    const onObject = anchorAt(sticky(), { x: 100, y: 100 });
    board.objects.delete(id);
    expect(pinPoint(onObject, readScene(board.objects))).toBeNull();
  });
});

describe("CMT-02, CMT-03: переписка, «решено», цвет", () => {
  it("ветка хранит сообщения по порядку, признак «решено» и цвет", () => {
    const { comments } = createBoardDocument();
    const { thread } = createThread(
      comments,
      { object: null, x: 0, y: 0 },
      "#e53935",
      "Alice",
      "Is this final?",
      new Date("2026-10-27T10:00:00Z"),
    );
    addReply(
      comments,
      thread,
      "Bob",
      "Not yet",
      new Date("2026-10-27T10:05:00Z"),
    );

    let [read] = readThreads(comments);
    expect(read?.messages.map((m) => [m.author, m.text])).toEqual([
      ["Alice", "Is this final?"],
      ["Bob", "Not yet"],
    ]);
    expect(read?.resolved).toBe(false);
    expect(read?.color).toBe("#e53935");

    setResolved(comments, thread, true);
    setThreadColor(comments, thread, "#1e88e5");
    [read] = readThreads(comments);
    expect(read?.resolved).toBe(true);
    expect(read?.color).toBe("#1e88e5");

    setResolved(comments, thread, false);
    expect(readThreads(comments)[0]?.resolved).toBe(false);
  });

  it("ответ в несуществующую ветку ничего не пишет", () => {
    const { comments } = createBoardDocument();
    expect(addReply(comments, "missing", "Bob", "Hi")).toBeNull();
    expect(comments.size).toBe(0);
  });

  it("ветки и ответы двух участников видны обоим и сливаются", () => {
    const [docA, docB] = linkedDocs();
    const a = createBoardDocument(docA);
    const b = createBoardDocument(docB);
    const { thread } = createThread(
      a.comments,
      { object: null, x: 5, y: 5 },
      "#43a047",
      "Alice",
      "First",
    );
    addReply(b.comments, thread, "Bob", "From Bob");
    addReply(a.comments, thread, "Alice", "From Alice");

    const texts = (doc: Y.Map<unknown>) =>
      readThreads(doc)[0]?.messages.map((m) => m.text);
    expect(texts(b.comments)).toEqual(["First", "From Bob", "From Alice"]);
    expect(texts(a.comments)).toEqual(texts(b.comments));
  });

  it("неверные записи пропускаются", () => {
    const { comments } = createBoardDocument();
    comments.set("broken", new Y.Map());
    comments.set("plain", "text");
    expect(readThreads(comments)).toEqual([]);
  });
});

describe("CMT-04: фильтр по участникам обсуждения", () => {
  function threeThreads() {
    const { comments } = createBoardDocument();
    const at = { object: null, x: 0, y: 0 } as const;
    const time = (minute: number) =>
      new Date(`2026-10-27T10:0${String(minute)}:00Z`);
    const one = createThread(comments, at, "#000000", "Alice", "A", time(1));
    const two = createThread(comments, at, "#000000", "Bob", "B", time(2));
    addReply(comments, two.thread, "Carol", "C");
    const three = createThread(comments, at, "#000000", "Carol", "C2", time(3));
    setResolved(comments, three.thread, true);
    return {
      threads: readThreads(comments),
      one: one.thread,
      two: two.thread,
      three: three.thread,
    };
  }

  it("участники — все авторы сообщений", () => {
    const { threads } = threeThreads();
    expect(participants(threads)).toEqual(["Alice", "Bob", "Carol"]);
  });

  it("ветка проходит фильтр, если в ней писал любой из выбранных", () => {
    const { threads, one, two, three } = threeThreads();
    const ids = (people: string[], hideResolved = false) =>
      filterThreads(threads, people, hideResolved).map((t) => t.id);
    expect(ids([])).toEqual([one, two, three]);
    expect(ids(["Carol"])).toEqual([two, three]);
    expect(ids(["Alice", "Bob"])).toEqual([one, two]);
    expect(ids(["Carol"], true)).toEqual([two]);
    expect(ids(["Nobody"])).toEqual([]);
  });
});
