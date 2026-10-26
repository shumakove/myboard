import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBoardDocument,
  type BoardDocument,
} from "../realtime/boardDocument";
import { placeInFrames } from "./frames";
import { columnCards, createKanban } from "./kanbans";
import { createObject, readScene, writeFields } from "./sceneObjects";
import { linkedDocs } from "./testDocs";
import {
  canvas,
  click,
  drag,
  element,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.8: канбан и карточки (KBN-01…KBN-03) — через интерфейс сцены.

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function barButton(name: string) {
  return within(selectionBar()).getByRole("button", { name });
}

/** Канбан в (0, 0): столбцы по 280, заголовок 48. */
function kanbanBoard(doc = createBoardDocument()) {
  const id = createKanban(doc.objects, { x: 0, y: 0 }, "Alice");
  return { board: doc, id };
}

function columnId(board: BoardDocument, id: string, index: number) {
  const column = object(board, id).kanban?.columns[index];
  if (column === undefined) throw new Error("нет столбца");
  return column.id;
}

function header(board: BoardDocument, id: string, index: number) {
  const found = element(id).querySelector<HTMLElement>(
    `[data-column-title="${columnId(board, id, index)}"]`,
  );
  if (found === null) throw new Error("нет заголовка столбца");
  return found;
}

/** Карточка в столбце `index` (центр по горизонтали), отпущенная на высоте `y`. */
function card(board: BoardDocument, index: number, y: number, text: string) {
  const id = createObject(
    board.objects,
    "card",
    { x: index * 280 + 20, y: y - 48 },
    text,
    "Alice",
  );
  placeInFrames(board.objects, readScene(board.objects), [id], "Alice");
  return id;
}

function texts(board: BoardDocument, id: string, index: number) {
  return columnCards(scene(board), id, columnId(board, id, index)).map(
    (o) => o.text,
  );
}

function titles(board: BoardDocument, id: string) {
  return object(board, id).kanban?.columns.map((c) => c.title);
}

describe("KBN-01: канбан на холсте", () => {
  it("инструмент Kanban (клавиша J) ставит канбан с тремя столбцами", () => {
    const board = createBoardDocument();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyJ", key: "j" });
    click(canvas(), [420, 240]);
    const kanban = scene(board).find((o) => o.type === "kanban");
    if (kanban === undefined) throw new Error("канбан не создан");
    expect(kanban).toMatchObject({ x: 0, y: 0, width: 840, height: 480 });
    expect(element(kanban.id).getAttribute("aria-label")).toBe("Kanban");
    const headers = element(kanban.id).querySelectorAll("[data-column-title]");
    expect([...headers].map((h) => h.textContent)).toEqual([
      "To do",
      "In progress",
      "Done",
    ]);
  });
});

describe("KBN-02: карточки", () => {
  it("инструмент Card (клавиша A) на столбце — карточка в столбце; текст и теги", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyA", key: "a" });
    click(canvas(), [420, 120]);
    const [created] = columnCards(scene(board), id, columnId(board, id, 1));
    if (created === undefined) throw new Error("карточка не в столбце");
    expect(created).toMatchObject({ type: "card", x: 300, y: 48 });
    // Поставленная щелчком карточка сразу открыта для ввода.
    const editor = screen.getByRole("textbox", { name: "Object text" });
    await user.type(editor, "Write docs");
    await user.keyboard("{Escape}");
    expect(object(board, created.id).text).toBe("Write docs");

    await user.click(barButton("Tags"));
    const group = within(selectionBar()).getByRole("group", { name: "Tags" });
    await user.type(within(group).getByLabelText("Add tag"), "#docs{Enter}");
    expect(object(board, created.id).tags).toEqual(["docs"]);
    expect(within(element(created.id)).getByText("docs")).toBeTruthy();
  });

  it("перетаскивание переносит карточку в другой столбец — видно второму участнику", () => {
    const [docA, docB] = linkedDocs();
    const { board, id } = kanbanBoard(createBoardDocument(docA));
    const task = card(board, 0, 100, "Task");
    card(board, 0, 300, "Next");
    renderScene(board);
    drag(
      element(task),
      [140, 96],
      [
        [300, 96],
        [420, 96],
      ],
    );
    expect(texts(board, id, 0)).toEqual(["Next"]);
    expect(texts(board, id, 1)).toEqual(["Task"]);
    const remote = createBoardDocument(docB);
    expect(object(remote, task)).toMatchObject({
      parent: id,
      cell: columnId(remote, id, 1),
      x: 300,
      y: 48,
    });
  });

  it("удалённая карточка освобождает место: остальные поднимаются", () => {
    const { board, id } = kanbanBoard();
    const first = card(board, 0, 100, "First");
    const second = card(board, 0, 300, "Second");
    renderScene(board);
    click(element(first), [140, 96]);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(board.objects.has(first)).toBe(false);
    expect(object(board, second)).toMatchObject({ y: 48 });
    expect(texts(board, id, 0)).toEqual(["Second"]);
  });

  it("Add card — карточка внизу выбранного столбца", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    renderScene(board);
    click(header(board, id, 2), [700, 24]);
    await user.click(barButton("Add card"));
    expect(columnCards(scene(board), id, columnId(board, id, 2))).toHaveLength(
      1,
    );
  });
});

describe("KBN-03: столбцы", () => {
  it("щелчок по заголовку выбирает столбец; Rename column и двойной щелчок — правка названия", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    renderScene(board);
    click(header(board, id, 1), [420, 24]);
    expect(
      within(selectionBar()).getByText("Column: In progress"),
    ).toBeTruthy();
    expect(
      header(board, id, 1)
        .closest("[data-active]")
        ?.getAttribute("data-column"),
    ).toBe(columnId(board, id, 1));

    await user.click(barButton("Rename column"));
    const field = screen.getByRole("textbox", { name: "Column title" });
    await user.clear(field);
    await user.type(field, "Doing{Enter}");
    expect(titles(board, id)).toEqual(["To do", "Doing", "Done"]);
    expect(screen.queryByRole("textbox", { name: "Column title" })).toBeNull();

    fireEvent.doubleClick(header(board, id, 0), { clientX: 140, clientY: 24 });
    const again = screen.getByRole("textbox", { name: "Column title" });
    await user.type(again, "!");
    await user.keyboard("{Escape}");
    expect(titles(board, id)?.[0]).toBe("To do!");
  });

  it("Add column — новый столбец справа от выбранного, сразу в правке названия", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    renderScene(board);
    click(header(board, id, 0), [140, 24]);
    await user.click(barButton("Add column"));
    const field = screen.getByRole("textbox", { name: "Column title" });
    await user.clear(field);
    await user.type(field, "Review{Enter}");
    expect(titles(board, id)).toEqual([
      "To do",
      "Review",
      "In progress",
      "Done",
    ]);
    expect(object(board, id).width).toBe(4 * 280);
  });

  it("Delete column с карточками — перенести карточки в выбранный столбец", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    card(board, 0, 100, "Kept");
    card(board, 1, 100, "Moved");
    renderScene(board);
    click(header(board, id, 1), [420, 24]);
    await user.click(barButton("Delete column"));
    const dialog = screen.getByRole("dialog", {
      name: "Delete column “In progress”?",
    });
    expect(within(dialog).getByText(/has 1 card\./)).toBeTruthy();
    await user.selectOptions(
      within(dialog).getByRole("combobox", { name: "Move cards to" }),
      "Done",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Move cards and delete column",
      }),
    );
    expect(titles(board, id)).toEqual(["To do", "Done"]);
    expect(texts(board, id, 0)).toEqual(["Kept"]);
    expect(texts(board, id, 1)).toEqual(["Moved"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Delete column с карточками — удалить карточки вместе со столбцом", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    const gone = card(board, 1, 100, "Gone");
    renderScene(board);
    click(header(board, id, 1), [420, 24]);
    await user.click(barButton("Delete column"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Delete column and cards",
      }),
    );
    expect(titles(board, id)).toEqual(["To do", "Done"]);
    expect(board.objects.has(gone)).toBe(false);
    expect(board.trash.has(gone)).toBe(true);
  });

  it("Cancel оставляет столбец; пустой столбец удаляется без вопроса", async () => {
    const user = userEvent.setup();
    const { board, id } = kanbanBoard();
    card(board, 1, 100, "Task");
    renderScene(board);
    click(header(board, id, 1), [420, 24]);
    await user.click(barButton("Delete column"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(titles(board, id)).toHaveLength(3);

    click(header(board, id, 2), [700, 24]);
    await user.click(barButton("Delete column"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(titles(board, id)).toEqual(["To do", "In progress"]);
  });

  it("у заблокированного канбана столбцы не правятся", () => {
    const { board, id } = kanbanBoard();
    writeFields(board.objects, new Map([[id, { locked: true }]]), "Alice");
    renderScene(board);
    click(header(board, id, 0), [140, 24]);
    expect(element(id).getAttribute("aria-selected")).toBe("true");
    expect(
      within(selectionBar()).queryByRole("button", { name: "Add column" }),
    ).toBeNull();
    fireEvent.doubleClick(header(board, id, 0));
    expect(screen.queryByRole("textbox", { name: "Column title" })).toBeNull();
  });
});
