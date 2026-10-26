import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import { copyObjects, pasteObjects } from "./clipboard";
import { placeInFrames } from "./frames";
import { columnTitle } from "./kanbanData";
import {
  addCard,
  addColumn,
  arrangeKanban,
  CARD_WIDTH,
  columnCards,
  createKanban,
  deleteColumn,
} from "./kanbans";
import {
  createObject,
  objectMap,
  patchObjects,
  readScene,
  type SceneObject,
} from "./sceneObjects";
import { addTag } from "./tags";
import { linkedDocs } from "./testDocs";

// T6.8: канбан и карточки (KBN-01…KBN-03) — данные документа.

function find(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

function columnsOf(objects: Y.Map<unknown>, id: string) {
  const kanban = find(objects, id).kanban;
  if (kanban === null) throw new Error("не канбан");
  return kanban.columns;
}

function columnIdAt(objects: Y.Map<unknown>, id: string, index: number) {
  const column = columnsOf(objects, id)[index];
  if (column === undefined) throw new Error("нет столбца");
  return column.id;
}

/** Канбан в (0, 0): столбцы по 280, заголовок 48. */
function kanbanBoard() {
  const board = createBoardDocument();
  const kanban = createKanban(board.objects, { x: 0, y: 0 }, "Alice");
  return { board, objects: board.objects, kanban };
}

/** Карточка центром в точке доски, затем — в столбец под ней (как после постановки). */
function cardAt(objects: Y.Map<unknown>, x: number, y: number, text = "") {
  const id = createObject(
    objects,
    "card",
    { x: x - 120, y: y - 48 },
    text,
    "Alice",
  );
  placeInFrames(objects, readScene(objects), [id], "Alice");
  return id;
}

/** Перетащить объект центром в точку доски и отпустить. */
function dropAt(objects: Y.Map<unknown>, id: string, x: number, y: number) {
  const object = find(objects, id);
  patchObjects(
    objects,
    new Map([[object, { x: x - object.width / 2, y: y - object.height / 2 }]]),
    "Alice",
  );
  placeInFrames(objects, readScene(objects), [id], "Alice");
}

/** Тексты карточек столбца сверху вниз. */
function texts(objects: Y.Map<unknown>, kanban: string, index: number) {
  const column = columnIdAt(objects, kanban, index);
  return columnCards(readScene(objects), kanban, column).map((o) => o.text);
}

describe("KBN-01: канбан со столбцами", () => {
  it("новый канбан — три столбца To do, In progress, Done", () => {
    const { objects, kanban } = kanbanBoard();
    const object = find(objects, kanban);
    expect(object).toMatchObject({
      type: "kanban",
      x: 0,
      y: 0,
      width: 840,
      height: 480,
    });
    expect(columnsOf(objects, kanban).map((c) => c.title)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
    // В документе: порядок — `Y.Array`, названия — `Y.Text`.
    const map = objectMap(objects, kanban);
    expect(map?.get("columns")).toBeInstanceOf(Y.Array);
    expect(
      columnTitle(map as Y.Map<unknown>, columnIdAt(objects, kanban, 0)),
    ).toBeInstanceOf(Y.Text);
  });

  it("канбан находят по названиям столбцов (CVS-08)", () => {
    const { objects, kanban } = kanbanBoard();
    expect(find(objects, kanban).text).toContain("In progress");
  });
});

describe("KBN-02: карточки в столбцах", () => {
  it("карточка, поставленная на столбец, встаёт в него по порядку", () => {
    const { objects, kanban } = kanbanBoard();
    const first = cardAt(objects, 140, 300, "First");
    const second = cardAt(objects, 140, 60, "Second");
    // Вторую отпустили выше середины первой — она первая в столбце.
    expect(texts(objects, kanban, 0)).toEqual(["Second", "First"]);
    expect(find(objects, second)).toMatchObject({
      parent: kanban,
      cell: columnIdAt(objects, kanban, 0),
      x: 20,
      y: 48,
      width: CARD_WIDTH,
    });
    expect(find(objects, first)).toMatchObject({ x: 20, y: 48 + 96 + 12 });
  });

  it("перетаскивание переносит карточку в другой столбец, старый смыкается", () => {
    const { objects, kanban } = kanbanBoard();
    const a = cardAt(objects, 140, 100, "A");
    cardAt(objects, 140, 300, "B");
    dropAt(objects, a, 420, 200);
    expect(texts(objects, kanban, 0)).toEqual(["B"]);
    expect(texts(objects, kanban, 1)).toEqual(["A"]);
    expect(find(objects, a)).toMatchObject({ x: 280 + 20, y: 48 });
    expect(texts(objects, kanban, 0)).toEqual(["B"]);
    expect(find(objects, kanban).text).not.toContain("A");
  });

  it("перетаскивание внутри столбца меняет порядок", () => {
    const { objects, kanban } = kanbanBoard();
    const a = cardAt(objects, 140, 100, "A");
    cardAt(objects, 140, 200, "B");
    cardAt(objects, 140, 300, "C");
    dropAt(objects, a, 140, 400);
    expect(texts(objects, kanban, 0)).toEqual(["B", "C", "A"]);
  });

  it("карточка за пределами канбана выходит из него; стикер в столбец не попадает", () => {
    const { objects, kanban } = kanbanBoard();
    const a = cardAt(objects, 140, 100, "A");
    dropAt(objects, a, 1200, 100);
    expect(find(objects, a).parent).toBeNull();
    expect(texts(objects, kanban, 0)).toEqual([]);
    const sticky = createObject(objects, "sticky", { x: 40, y: 100 });
    placeInFrames(objects, readScene(objects), [sticky], "Alice");
    expect(find(objects, sticky).parent).toBeNull();
  });

  it("карточки едут вместе с канбаном; высота растёт под карточки", () => {
    const { objects, kanban } = kanbanBoard();
    const ids = [0, 1, 2, 3, 4].map((i) =>
      cardAt(objects, 140, 100 + i * 50, String(i)),
    );
    expect(find(objects, kanban).height).toBe(48 + 5 * 96 + 4 * 12 + 20);
    patchObjects(
      objects,
      new Map([[find(objects, kanban), { x: 1000, y: 500 }]]),
      "Alice",
    );
    expect(find(objects, ids[0] as string)).toMatchObject({
      x: 1020,
      y: 548,
    });
  });

  it("карточка хранит текст и теги", () => {
    const { objects } = kanbanBoard();
    const id = cardAt(objects, 140, 100, "Fix login");
    addTag(objects, id, "#bug", "Alice");
    expect(find(objects, id)).toMatchObject({
      text: "Fix login",
      tags: ["bug"],
    });
  });

  it("Add card — новая карточка внизу столбца", () => {
    const { objects, kanban } = kanbanBoard();
    cardAt(objects, 420, 100, "Old");
    const column = columnIdAt(objects, kanban, 1);
    const id = addCard(objects, find(objects, kanban), column, "Alice");
    expect(find(objects, id)).toMatchObject({
      type: "card",
      parent: kanban,
      cell: column,
      y: 48 + 96 + 12,
    });
  });

  it("перенос карточки виден второму участнику", () => {
    const [docA, docB] = linkedDocs();
    const a = createBoardDocument(docA).objects;
    const b = createBoardDocument(docB).objects;
    const kanban = createKanban(a, { x: 0, y: 0 }, "Alice");
    const card = cardAt(a, 140, 100, "Task");
    dropAt(a, card, 700, 100);
    expect(find(b, card)).toMatchObject({
      parent: kanban,
      cell: columnIdAt(b, kanban, 2),
      x: 560 + 20,
      y: 48,
    });
  });

  it("дубликат и копия канбана сохраняют столбцы, названия и карточки", () => {
    const { objects, kanban } = kanbanBoard();
    cardAt(objects, 420, 100, "Task");
    const clip = copyObjects(objects, readScene(objects), [kanban]);
    if (clip === null) throw new Error("нет копии");
    const [copy] = pasteObjects(
      objects,
      clip,
      { kind: "at", point: { x: 2000, y: 0 }, gridStep: 0 },
      "Bob",
    );
    if (copy === undefined) throw new Error("не вставлено");
    expect(columnsOf(objects, copy).map((c) => c.title)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
    expect(texts(objects, copy, 1)).toEqual(["Task"]);
    expect(
      columnTitle(
        objectMap(objects, copy) as Y.Map<unknown>,
        columnIdAt(objects, copy, 0),
      ),
    ).toBeInstanceOf(Y.Text);
  });

  it("карточки удалённого одновременно столбца уходят в первый столбец", () => {
    const { objects, kanban } = kanbanBoard();
    const card = cardAt(objects, 420, 100, "Orphan");
    objectMap(objects, card)?.set("cell", "missing");
    arrangeKanban(objects, kanban, "Alice");
    expect(find(objects, card).cell).toBe(columnIdAt(objects, kanban, 0));
  });
});

describe("KBN-03: столбцы", () => {
  it("переименование — правка названия столбца", () => {
    const { objects, kanban } = kanbanBoard();
    const map = objectMap(objects, kanban) as Y.Map<unknown>;
    const title = columnTitle(map, columnIdAt(objects, kanban, 1));
    title.delete(0, title.length);
    title.insert(0, "Doing");
    expect(columnsOf(objects, kanban)[1]?.title).toBe("Doing");
  });

  it("новый столбец — справа от выбранного; карточки правее сдвигаются с ним", () => {
    const { objects, kanban } = kanbanBoard();
    const done = cardAt(objects, 700, 100, "Shipped");
    const id = addColumn(
      objects,
      find(objects, kanban),
      columnIdAt(objects, kanban, 0),
      "Alice",
    );
    expect(columnsOf(objects, kanban).map((c) => c.title)).toEqual([
      "To do",
      "New column",
      "In progress",
      "Done",
    ]);
    expect(columnIdAt(objects, kanban, 1)).toBe(id);
    expect(find(objects, kanban).width).toBe(4 * 280);
    expect(find(objects, done)).toMatchObject({ x: 3 * 280 + 20 });
  });

  it("без выбранного столбца новый — последним", () => {
    const { objects, kanban } = kanbanBoard();
    addColumn(objects, find(objects, kanban), null, "Alice");
    expect(columnsOf(objects, kanban).at(-1)?.title).toBe("New column");
  });

  it("удаление с переносом: карточки — в конец выбранного столбца", () => {
    const { board, objects, kanban } = kanbanBoard();
    cardAt(objects, 140, 100, "Kept");
    cardAt(objects, 420, 100, "Moved 1");
    cardAt(objects, 420, 300, "Moved 2");
    const doing = columnIdAt(objects, kanban, 1);
    const todo = columnIdAt(objects, kanban, 0);
    deleteColumn(
      board,
      find(objects, kanban),
      doing,
      {
        kind: "move",
        to: todo,
      },
      "Alice",
    );
    expect(columnsOf(objects, kanban).map((c) => c.title)).toEqual([
      "To do",
      "Done",
    ]);
    expect(texts(objects, kanban, 0)).toEqual(["Kept", "Moved 1", "Moved 2"]);
    expect(find(objects, kanban).width).toBe(2 * 280);
    expect(board.trash.size).toBe(0);
  });

  it("удаление вместе с карточками: карточки — в корзину", () => {
    const { board, objects, kanban } = kanbanBoard();
    const kept = cardAt(objects, 140, 100, "Kept");
    const gone = cardAt(objects, 420, 100, "Gone");
    deleteColumn(
      board,
      find(objects, kanban),
      columnIdAt(objects, kanban, 1),
      { kind: "delete" },
      "Alice",
    );
    expect(objects.has(gone)).toBe(false);
    expect(board.trash.has(gone)).toBe(true);
    expect(objects.has(kept)).toBe(true);
    expect(columnsOf(objects, kanban)).toHaveLength(2);
  });

  it("последний столбец не удаляется", () => {
    const { board, objects, kanban } = kanbanBoard();
    for (const index of [2, 1]) {
      deleteColumn(
        board,
        find(objects, kanban),
        columnIdAt(objects, kanban, index),
        { kind: "delete" },
        "Alice",
      );
    }
    deleteColumn(
      board,
      find(objects, kanban),
      columnIdAt(objects, kanban, 0),
      { kind: "delete" },
      "Alice",
    );
    expect(columnsOf(objects, kanban).map((c) => c.title)).toEqual(["To do"]);
  });
});
