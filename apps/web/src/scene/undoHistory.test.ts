import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createBoardDocument,
  moveToTrash,
  type BoardDocument,
} from "../realtime/boardDocument";
import { createObject, readScene, writeFields } from "./sceneObjects";
import { linkedDocs } from "./testDocs";
import { UndoHistory } from "./undoHistory";

const histories: UndoHistory[] = [];

function historyOf(board: BoardDocument): UndoHistory {
  const history = new UndoHistory(board);
  history.attach();
  histories.push(history);
  return history;
}

afterEach(() => {
  for (const history of histories.splice(0)) history.detach();
});

function ids(board: BoardDocument): string[] {
  return readScene(board.objects)
    .map((o) => o.id)
    .sort();
}

function x(board: BoardDocument, id: string): number | undefined {
  return readScene(board.objects).find((o) => o.id === id)?.x;
}

/** Два клиента одной доски, обмен как через сервер (origin чужих правок не null). */
function twoClients() {
  const [docA, docB] = linkedDocs();
  return [createBoardDocument(docA), createBoardDocument(docB)] as const;
}

describe("CVS-07 отмена и повтор своих правок", () => {
  it("отмена убирает свой объект и не трогает объект второго клиента", () => {
    const [a, b] = twoClients();
    const history = historyOf(a);
    const mine = createObject(a.objects, "sticky", { x: 0, y: 0 });
    const theirs = createObject(b.objects, "shape", { x: 300, y: 0 });

    history.undo();

    expect(ids(a)).toEqual([theirs]);
    expect(ids(b)).toEqual([theirs]);
    history.redo();
    expect(ids(b)).toEqual([mine, theirs].sort());
  });

  it("чужая правка не попадает в стек: отменять нечего", () => {
    const [a, b] = twoClients();
    const history = historyOf(a);
    createObject(b.objects, "sticky", { x: 0, y: 0 });

    expect(history.snapshot().canUndo).toBe(false);
    history.undo();
    expect(ids(a)).toHaveLength(1);
  });

  it("отмена своего сдвига сохраняет чужую правку того же объекта", () => {
    const [a, b] = twoClients();
    const id = createObject(a.objects, "sticky", { x: 0, y: 0 });
    const history = historyOf(a);
    writeFields(a.objects, new Map([[id, { x: 100 }]]), "Alice");
    writeFields(b.objects, new Map([[id, { fill: "#81d4fa" }]]), "Bob");

    history.undo();

    const object = readScene(b.objects).find((o) => o.id === id);
    expect(object?.x).toBe(0);
    expect(object?.style.fill).toBe("#81d4fa");
  });

  it("не перезаписывает поле, которое после нас изменил второй клиент", () => {
    const [a, b] = twoClients();
    const id = createObject(a.objects, "sticky", { x: 0, y: 0 });
    const history = historyOf(a);
    writeFields(a.objects, new Map([[id, { x: 100 }]]), "Alice");
    writeFields(b.objects, new Map([[id, { x: 500 }]]), "Bob");

    history.undo();

    expect(x(a, id)).toBe(500);
    expect(x(b, id)).toBe(500);
  });

  it("отмена удаления возвращает объект и убирает запись корзины", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 40, y: 0 }, "hi");
    const history = historyOf(board);
    moveToTrash(board, [id], "Alice");
    expect(ids(board)).toEqual([]);

    history.undo();

    expect(ids(board)).toEqual([id]);
    expect(x(board, id)).toBe(40);
    expect(board.trash.has(id)).toBe(false);
    const text = (board.objects.get(id) as Y.Map<unknown>).get("text");
    expect(String(text)).toBe("hi");
  });

  it("правки между begin и end — один шаг; без них каждая — отдельный", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    const history = historyOf(board);

    history.begin();
    for (const value of [10, 20, 30]) {
      writeFields(board.objects, new Map([[id, { x: value }]]), "Alice");
    }
    history.end();
    writeFields(board.objects, new Map([[id, { x: 40 }]]), "Alice");
    writeFields(board.objects, new Map([[id, { x: 50 }]]), "Alice");

    history.undo();
    expect(x(board, id)).toBe(40);
    history.undo();
    expect(x(board, id)).toBe(30);
    history.undo();
    expect(x(board, id)).toBe(0);
  });

  it("смена фона доски тоже отменяется", () => {
    const board = createBoardDocument();
    const history = historyOf(board);
    board.settings.set("background", "#1f2937");

    history.undo();

    expect(board.settings.get("background")).toBeUndefined();
  });

  it("состояние кнопок: доступность отмены и повтора", () => {
    const board = createBoardDocument();
    const history = historyOf(board);
    const states: boolean[][] = [];
    history.subscribe(() => {
      const { canUndo, canRedo } = history.snapshot();
      states.push([canUndo, canRedo]);
    });

    createObject(board.objects, "sticky", { x: 0, y: 0 });
    history.undo();
    history.redo();

    expect(states).toEqual([
      [true, false],
      [false, true],
      [true, false],
    ]);
  });
});
