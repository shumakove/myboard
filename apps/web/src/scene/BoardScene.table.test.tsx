import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBoardDocument,
  type BoardDocument,
} from "../realtime/boardDocument";
import { createObject, writeFields } from "./sceneObjects";
import { cellKey, tableGrid, type TableShape } from "./tableData";
import { createTable } from "./tables";
import {
  canvas,
  click,
  drag,
  element,
  handle,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.7: таблицы (TBL-01…TBL-07) — через интерфейс сцены.

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

function select(label: string) {
  return within(selectionBar()).getByRole<HTMLSelectElement>("combobox", {
    name: label,
  });
}

function shape(board: BoardDocument, id: string): TableShape {
  const table = object(board, id).table;
  if (table === null) throw new Error("не таблица");
  return table;
}

function key(board: BoardDocument, id: string, row: number, column: number) {
  const table = shape(board, id);
  const r = table.rows[row];
  const c = table.columns[column];
  if (r === undefined || c === undefined) throw new Error("нет ячейки");
  return cellKey(r.id, c.id);
}

/** Элемент ячейки (строка, столбец) таблицы на холсте. */
function cell(board: BoardDocument, id: string, row: number, column: number) {
  const found = element(id).querySelector<HTMLElement>(
    `[data-cell="${key(board, id, row, column)}"]`,
  );
  if (found === null) throw new Error("нет ячейки на холсте");
  return found;
}

/** Центр ячейки 160×48 таблицы в (0, 0). */
function at(row: number, column: number): [number, number] {
  return [column * 160 + 80, row * 48 + 24];
}

/** Таблица 3×3 в (0, 0) с текстом «r,c» в ячейках. */
function tableBoard() {
  const board = createBoardDocument();
  const grid = [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => `${String(r)},${String(c)}`),
  );
  const id = createTable(board.objects, { x: 0, y: 0 }, grid, "Alice");
  return { board, id };
}

function key_(name: string, options: { shiftKey?: boolean } = {}) {
  fireEvent.keyDown(document.body, { key: name, ...options });
}

/** Событие буфера обмена с данными, как от браузера. */
function clipboardEvent(
  type: "copy" | "paste",
  data: Record<string, string> = {},
) {
  const store = { ...data };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (kind: string) => store[kind] ?? "",
      setData: (kind: string, value: string) => {
        store[kind] = value;
      },
    },
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return store;
}

describe("TBL-01: таблица, строки и столбцы", () => {
  it("инструмент Table (клавиша B) ставит таблицу 3×3", () => {
    const board = createBoardDocument();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyB", key: "b" });
    click(canvas(), [240, 72]);
    const table = scene(board).find((o) => o.type === "table");
    if (table === undefined) throw new Error("таблица не создана");
    expect(table).toMatchObject({ x: 0, y: 0, width: 480, height: 144 });
    expect(element(table.id).getAttribute("aria-label")).toBe("Table");
    expect(element(table.id).querySelectorAll("[data-cell]")).toHaveLength(9);
  });

  it("Rows & columns: добавить строку и столбец, удалить, задать ширину", async () => {
    const user = userEvent.setup();
    const { board, id } = tableBoard();
    renderScene(board);
    click(cell(board, id, 1, 1), at(1, 1));
    await user.click(barButton("Rows & columns"));
    await user.click(barButton("Add row below"));
    expect(tableGrid(shape(board, id)).map((row) => row[1])).toEqual([
      "0,1",
      "1,1",
      "",
      "2,1",
    ]);
    await user.click(barButton("Add column left"));
    expect(tableGrid(shape(board, id))[0]).toEqual(["0,0", "", "0,1", "0,2"]);

    const width = within(selectionBar()).getByRole("spinbutton", {
      name: "Column width",
    });
    await user.clear(width);
    await user.type(width, "250{Enter}");
    const focusColumn = shape(board, id).columns[2];
    expect(focusColumn?.size).toBe(250);

    await user.click(barButton("Delete row"));
    expect(shape(board, id).rows).toHaveLength(3);
  });

  it("граница столбца выделенной таблицы тянется — ширина следует за указателем", () => {
    const { board, id } = tableBoard();
    renderScene(board);
    click(cell(board, id, 0, 0), at(0, 0));
    const first = shape(board, id).columns[0];
    if (first === undefined) throw new Error("нет столбца");
    drag(handle(`col:${first.id}`), [160, 20], [[220, 20]]);
    expect(shape(board, id).columns.map((c) => c.size)).toEqual([
      220, 160, 160,
    ]);
    expect(object(board, id).width).toBe(540);
  });
});

describe("TBL-02, TBL-03: оформление, заливка и объединение ячеек", () => {
  it("Shift+щелчок выделяет диапазон; цвет, начертание, выравнивание и заливка", async () => {
    const user = userEvent.setup();
    const { board, id } = tableBoard();
    renderScene(board);
    click(cell(board, id, 0, 0), at(0, 0));
    click(cell(board, id, 1, 1), at(1, 1), { shiftKey: true });
    expect(within(selectionBar()).getByText("4 cells")).toBeTruthy();
    expect(cell(board, id, 1, 0).dataset.selected).toBe("true");

    await user.selectOptions(select("Text color"), "Pink");
    await user.selectOptions(select("Style"), "Bold");
    await user.selectOptions(select("Align"), "Center");
    await user.selectOptions(select("Vertical align"), "Bottom");
    await user.selectOptions(select("Cell fill"), "Green");
    const styled = shape(board, id).cells.get(key(board, id, 1, 1));
    expect(styled?.style).toEqual({
      color: "#f48fb1",
      fontStyle: "bold",
      align: "center",
      valign: "bottom",
      fill: "#a5d6a7",
    });
    // Ячейка вне выделения не изменилась.
    expect(shape(board, id).cells.get(key(board, id, 2, 2))?.style).toEqual({});
    const view = cell(board, id, 1, 1);
    expect(view.style.background).toBe("rgb(165, 214, 167)");
    expect(view.style.fontWeight).toBe("700");
    expect(view.style.alignItems).toBe("flex-end");
  });

  it("Merge cells объединяет выделенные, Unmerge cells — разъединяет", async () => {
    const user = userEvent.setup();
    const { board, id } = tableBoard();
    renderScene(board);
    click(cell(board, id, 0, 0), at(0, 0));
    click(cell(board, id, 0, 1), at(0, 1), { shiftKey: true });
    await user.click(barButton("Merge cells"));
    const merged = shape(board, id).cells.get(key(board, id, 0, 0));
    expect(merged).toMatchObject({ colSpan: 2, text: "0,0\n0,1" });
    expect(element(id).querySelectorAll("[data-cell]")).toHaveLength(8);
    expect(cell(board, id, 0, 0).style.width).toBe("320px");

    await user.click(barButton("Unmerge cells"));
    expect(shape(board, id).cells.get(key(board, id, 0, 0))?.colSpan).toBe(1);
    expect(element(id).querySelectorAll("[data-cell]")).toHaveLength(9);
  });
});

describe("TBL-04: переход между ячейками клавишами", () => {
  it("стрелки двигают активную ячейку, Shift — расширяет, Enter открывает ввод", async () => {
    const user = userEvent.setup();
    const { board, id } = tableBoard();
    renderScene(board);
    click(cell(board, id, 0, 0), at(0, 0));
    expect(cell(board, id, 0, 0).dataset.focus).toBe("true");
    key_("ArrowRight");
    key_("ArrowDown");
    expect(cell(board, id, 1, 1).dataset.focus).toBe("true");
    key_("ArrowLeft", { shiftKey: true });
    expect(cell(board, id, 1, 0).dataset.selected).toBe("true");
    expect(cell(board, id, 1, 1).dataset.selected).toBe("true");
    key_("Tab");
    expect(cell(board, id, 1, 1).dataset.focus).toBe("true");

    key_("Enter");
    const editor = screen.getByRole("textbox", { name: "Table cell" });
    await user.type(editor, "!");
    expect(shape(board, id).cells.get(key(board, id, 1, 1))?.text).toBe("1,1!");
    // Стрелка вправо с конца текста — ввод в соседней ячейке.
    await user.keyboard("{ArrowRight}x");
    expect(shape(board, id).cells.get(key(board, id, 1, 2))?.text).toBe("1,2x");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("textbox", { name: "Table cell" })).toBeNull();
    expect(cell(board, id, 1, 2).dataset.focus).toBe("true");
  });

  it("двойной щелчок по ячейке — ввод; Delete очищает ячейки, а не удаляет таблицу", async () => {
    const user = userEvent.setup();
    const { board, id } = tableBoard();
    renderScene(board);
    fireEvent.doubleClick(cell(board, id, 2, 0), {
      clientX: at(2, 0)[0],
      clientY: at(2, 0)[1],
    });
    const editor = screen.getByRole("textbox", { name: "Table cell" });
    await user.type(editor, "?");
    expect(shape(board, id).cells.get(key(board, id, 2, 0))?.text).toBe("2,0?");
    await user.keyboard("{Escape}");

    key_("Delete");
    expect(board.objects.has(id)).toBe(true);
    expect(shape(board, id).cells.get(key(board, id, 2, 0))?.text).toBe("");
    // Escape снимает выделение ячеек, таблица остаётся выделенной.
    key_("Escape");
    expect(element(id).querySelector("[data-selected]")).toBeNull();
    expect(element(id).getAttribute("aria-selected")).toBe("true");
  });

  it("у заблокированной таблицы ячейки не выделяются и не правятся", () => {
    const { board, id } = tableBoard();
    writeFields(board.objects, new Map([[id, { locked: true }]]), "Alice");
    renderScene(board);
    click(cell(board, id, 0, 0), at(0, 0));
    expect(element(id).getAttribute("aria-selected")).toBe("true");
    expect(element(id).querySelector("[data-focus]")).toBeNull();
    fireEvent.doubleClick(cell(board, id, 0, 0));
    expect(screen.queryByRole("textbox", { name: "Table cell" })).toBeNull();
    expect(
      within(selectionBar()).queryByRole("button", { name: "Rows & columns" }),
    ).toBeNull();
  });
});

describe("TBL-05: объекты в ячейке", () => {
  it("стикер, перенесённый в ячейку, — её объект и едет вместе с таблицей", () => {
    const { board, id } = tableBoard();
    const sticky = createObject(board.objects, "sticky", { x: 1000, y: 0 });
    renderScene(board);
    // Центр стикера (1100, 100) → (400, 120): ячейка строки 2, столбца 2.
    drag(element(sticky), [1100, 100], [[400, 120]], { altKey: true });
    expect(object(board, sticky)).toMatchObject({
      parent: id,
      cell: key(board, id, 2, 2),
      x: 300,
      y: 20,
    });
    drag(cell(board, id, 0, 0), at(0, 0), [[180, 124]], { altKey: true });
    expect(object(board, id)).toMatchObject({ x: 100, y: 100 });
    expect(object(board, sticky)).toMatchObject({ x: 400, y: 120 });
  });
});

describe("TBL-06, TBL-07: обмен с внешней электронной таблицей", () => {
  it("копия выделенной таблицы — TSV и HTML-таблица для электронных таблиц", () => {
    const { board, id } = tableBoard();
    renderScene(board);
    click(cell(board, id, 0, 0), at(0, 0));
    key_("Escape"); // снять выделение ячеек — копируется таблица
    const store = clipboardEvent("copy");
    expect(store["text/plain"]).toBe(
      "0,0\t0,1\t0,2\n1,0\t1,1\t1,2\n2,0\t2,1\t2,2",
    );
    expect(store["text/html"]).toContain("<table><tr><td>0,0</td>");
  });

  it("вставка внешней таблицы спрашивает вид; Table — таблица с той же сеткой", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    clipboardEvent("paste", { "text/plain": "Name\tQty\nApple\t3\n" });
    const dialog = screen.getByRole("dialog", { name: "Paste table" });
    expect(within(dialog).getByText("Paste 2 × 2 table as")).toBeTruthy();
    expect(scene(board)).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Table" }));
    const [table] = scene(board);
    expect(table?.table && tableGrid(table.table)).toEqual([
      ["Name", "Qty"],
      ["Apple", "3"],
    ]);
    expect(screen.queryByRole("dialog", { name: "Paste table" })).toBeNull();
  });

  it("TBL-07: выбор Sticky notes — стикер на каждую непустую ячейку", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    clipboardEvent("paste", {
      "text/plain": "x",
      "text/html":
        "<table><tr><td>Idea</td><td></td></tr><tr><td>Risk</td><td>Plan</td></tr></table>",
    });
    await user.click(screen.getByRole("button", { name: "Sticky notes" }));
    const stickies = scene(board);
    expect(stickies.every((o) => o.type === "sticky")).toBe(true);
    expect(stickies.map((o) => o.text).sort()).toEqual([
      "Idea",
      "Plan",
      "Risk",
    ]);
  });

  it("Cancel ничего не вставляет; обычный текст вставляется текстом, без вопроса", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    clipboardEvent("paste", { "text/plain": "a\tb" });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(scene(board)).toHaveLength(0);
    clipboardEvent("paste", { "text/plain": "plain text" });
    expect(screen.queryByRole("dialog", { name: "Paste table" })).toBeNull();
    expect(scene(board).map((o) => o.type)).toEqual(["text"]);
  });
});
