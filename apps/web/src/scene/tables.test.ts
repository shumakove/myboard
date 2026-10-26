import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { clipHtml, clipText, copyObjects, pasteObjects } from "./clipboard";
import { placeInFrames } from "./frames";
import { groupObjects } from "./groups";
import {
  createObject,
  objectMap,
  patchObjects,
  readScene,
  type SceneObject,
} from "./sceneObjects";
import {
  cellAt,
  cellKey,
  cellRect,
  setLineSize,
  tableGrid,
  type TableShape,
} from "./tableData";
import {
  gridToHtml,
  gridToTsv,
  parseHtmlTable,
  parseTsv,
  tabularGrid,
} from "./tableExchange";
import {
  addLine,
  cellAfter,
  createTable,
  editorExit,
  emptyGrid,
  mergeSelection,
  pasteTableGrid,
  removeLine,
  selectedCells,
  stickiesFromGrid,
} from "./tables";

// T6.7: таблицы (TBL-01…TBL-07) — модель документа и обмен с электронными таблицами.

function board(): Y.Map<unknown> {
  return new Y.Doc().getMap("objects");
}

function find(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

function shape(objects: Y.Map<unknown>, id: string): TableShape {
  const table = find(objects, id).table;
  if (table === null) throw new Error("не таблица");
  return table;
}

/** Ключ ячейки по номерам строки и столбца. */
function key(table: TableShape, row: number, column: number): string {
  const r = table.rows[row];
  const c = table.columns[column];
  if (r === undefined || c === undefined) throw new Error("нет ячейки");
  return cellKey(r.id, c.id);
}

/** Таблица 3×3 (160×48) в (0, 0) с текстом «r,c» в каждой ячейке. */
function filledTable(objects = board()) {
  const grid = [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => `${String(r)},${String(c)}`),
  );
  const id = createTable(objects, { x: 0, y: 0 }, grid, "Alice");
  return { objects, id };
}

describe("TBL-01: строки, столбцы и их размер", () => {
  it("новая таблица — сетка 3×3 по 160×48, рамка — сумма размеров", () => {
    const objects = board();
    const id = createTable(objects, { x: 40, y: 20 }, emptyGrid(3, 3), "Al");
    const table = find(objects, id);
    expect(table).toMatchObject({ type: "table", x: 40, y: 20 });
    expect(table).toMatchObject({ width: 480, height: 144 });
    expect(table.table?.columns).toHaveLength(3);
    expect(table.table?.rows).toHaveLength(3);
  });

  it("ширина столбца и высота строки меняются; не меньше 24", () => {
    const { objects, id } = filledTable();
    const map = objectMap(objects, id);
    const first = shape(objects, id).columns[0];
    const row = shape(objects, id).rows[1];
    if (map === null || first === undefined || row === undefined) {
      throw new Error("нет таблицы");
    }
    setLineSize(map, first.id, 300);
    setLineSize(map, row.id, 5);
    const table = shape(objects, id);
    expect(table.columns.map((c) => c.size)).toEqual([300, 160, 160]);
    expect(table.rows.map((r) => r.size)).toEqual([48, 24, 48]);
    expect(find(objects, id)).toMatchObject({ width: 620, height: 120 });
    // Поля рамки в документе повторяют сумму — их читают и без клиента.
    expect(map.get("width")).toBe(620);
  });

  it("строка и столбец добавляются рядом и удаляются; последний не удаляется", () => {
    const { objects, id } = filledTable();
    const middle = shape(objects, id).rows[1];
    if (middle === undefined) throw new Error("нет строки");
    addLine(objects, find(objects, id), "row", middle.id, true, "Al");
    expect(tableGrid(shape(objects, id)).map((row) => row[0])).toEqual([
      "0,0",
      "1,0",
      "",
      "2,0",
    ]);
    const first = shape(objects, id).columns[0];
    if (first === undefined) throw new Error("нет столбца");
    addLine(objects, find(objects, id), "column", first.id, false, "Al");
    expect(tableGrid(shape(objects, id))[0]).toEqual(["", "0,0", "0,1", "0,2"]);

    const scene = readScene(objects);
    const second = shape(objects, id).columns[1];
    if (second === undefined) throw new Error("нет столбца");
    expect(
      removeLine(objects, scene, find(objects, id), "column", second.id, "Al"),
    ).toBe(true);
    expect(tableGrid(shape(objects, id))[0]).toEqual(["", "0,1", "0,2"]);

    const single = createTable(objects, { x: 0, y: 500 }, [["only"]], "Al");
    const line = shape(objects, single).rows[0];
    if (line === undefined) throw new Error("нет строки");
    expect(
      removeLine(
        objects,
        readScene(objects),
        find(objects, single),
        "row",
        line.id,
        "Al",
      ),
    ).toBe(false);
  });

  it("угловой маркер меняет размер всех столбцов и строк пропорционально", () => {
    const { objects, id } = filledTable();
    const table = find(objects, id);
    patchObjects(
      objects,
      new Map([[table, { width: 960, height: 288 }]]),
      "Al",
    );
    const after = shape(objects, id);
    expect(after.columns.map((c) => c.size)).toEqual([320, 320, 320]);
    expect(after.rows.map((r) => r.size)).toEqual([96, 96, 96]);
  });
});

describe("TBL-02, TBL-03: оформление, заливка и объединение", () => {
  it("объединение — одна ячейка на всю площадь, текст закрытых ячеек сохраняется", () => {
    const { objects, id } = filledTable();
    const merged = mergeSelection(
      objects,
      readScene(objects),
      find(objects, id),
      { top: 0, left: 0, bottom: 1, right: 1 },
      "Al",
    );
    const table = shape(objects, id);
    expect(merged).toBe(key(table, 0, 0));
    expect(cellRect(table, key(table, 0, 0))).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 96,
    });
    expect(table.cells.get(key(table, 0, 0))?.text).toBe("0,0\n0,1\n1,0\n1,1");
    // Закрытые ячейки принадлежат объединённой.
    expect(cellAt(table, { x: 200, y: 60 })).toBe(key(table, 0, 0));
    expect(table.cells.has(key(table, 1, 1))).toBe(false);
  });

  it("выделение, задевающее объединение, расширяется до него целиком", () => {
    const { objects, id } = filledTable();
    mergeSelection(
      objects,
      readScene(objects),
      find(objects, id),
      { top: 0, left: 1, bottom: 1, right: 1 },
      "Al",
    );
    const table = shape(objects, id);
    const cells = selectedCells(table, {
      anchor: key(table, 1, 0),
      focus: key(table, 1, 1),
    });
    expect(cells).toEqual([
      key(table, 0, 0),
      key(table, 0, 1),
      key(table, 1, 0),
    ]);
  });

  it("строка внутри объединения растягивает его, удалённая — сжимает", () => {
    const { objects, id } = filledTable();
    mergeSelection(
      objects,
      readScene(objects),
      find(objects, id),
      { top: 0, left: 0, bottom: 1, right: 0 },
      "Al",
    );
    const first = shape(objects, id).rows[0];
    if (first === undefined) throw new Error("нет строки");
    addLine(objects, find(objects, id), "row", first.id, true, "Al");
    let table = shape(objects, id);
    expect(table.cells.get(key(table, 0, 0))?.rowSpan).toBe(3);
    const inserted = table.rows[1];
    if (inserted === undefined) throw new Error("нет строки");
    removeLine(
      objects,
      readScene(objects),
      find(objects, id),
      "row",
      inserted.id,
      "Al",
    );
    table = shape(objects, id);
    expect(table.cells.get(key(table, 0, 0))?.rowSpan).toBe(2);
  });
});

describe("TBL-04: переход между ячейками", () => {
  it("стрелки ведут к соседней ячейке, объединённая — целиком; у края — та же", () => {
    const { objects, id } = filledTable();
    mergeSelection(
      objects,
      readScene(objects),
      find(objects, id),
      { top: 0, left: 0, bottom: 0, right: 1 },
      "Al",
    );
    const table = shape(objects, id);
    const merged = key(table, 0, 0);
    expect(cellAfter(table, merged, "right")).toBe(key(table, 0, 2));
    expect(cellAfter(table, key(table, 0, 2), "left")).toBe(merged);
    expect(cellAfter(table, key(table, 1, 1), "up")).toBe(merged);
    expect(cellAfter(table, merged, "up")).toBe(merged);
    expect(cellAfter(table, key(table, 0, 2), "next")).toBe(key(table, 1, 0));
    expect(cellAfter(table, key(table, 1, 0), "previous")).toBe(
      key(table, 0, 2),
    );
  });

  it("стрелка в поле ввода уходит из ячейки только с края текста", () => {
    const field = (value: string, at: number) => ({
      value,
      selectionStart: at,
      selectionEnd: at,
    });
    expect(editorExit("ArrowRight", field("ab", 2), false)).toBe("right");
    expect(editorExit("ArrowRight", field("ab", 1), false)).toBeNull();
    expect(editorExit("ArrowLeft", field("ab", 0), false)).toBe("left");
    expect(editorExit("ArrowUp", field("a\nb", 3), false)).toBeNull();
    expect(editorExit("ArrowDown", field("a\nb", 3), false)).toBe("down");
    expect(editorExit("Tab", field("ab", 1), true)).toBe("previous");
    expect(editorExit("ArrowRight", field("ab", 2), true)).toBeNull();
  });
});

describe("TBL-05: объекты в ячейке", () => {
  it("объект, центр которого в ячейке, попадает в неё и едет с таблицей", () => {
    const { objects, id } = filledTable();
    // Стикер 200×200 с центром (240, 70) — в ячейке строки 1, столбца 1.
    const sticky = createObject(objects, "sticky", { x: 140, y: -30 });
    placeInFrames(objects, readScene(objects), [sticky], "Al");
    const table = shape(objects, id);
    expect(find(objects, sticky)).toMatchObject({
      parent: id,
      cell: key(table, 1, 1),
      x: 140,
      y: -30,
    });

    const current = find(objects, id);
    patchObjects(objects, new Map([[current, { x: 100, y: 50 }]]), "Al");
    expect(find(objects, sticky)).toMatchObject({ x: 240, y: 20 });

    // Столбец 0 шире на 40 — ячейка и объект в ней сдвигаются вправо.
    const map = objectMap(objects, id);
    const first = table.columns[0];
    if (map === null || first === undefined) throw new Error("нет таблицы");
    setLineSize(map, first.id, 200);
    expect(find(objects, sticky)).toMatchObject({ x: 280, y: 20 });

    // Вынесенный за таблицу — снова на верхнем уровне, на том же месте.
    const moved = find(objects, sticky);
    patchObjects(objects, new Map([[moved, { x: 900, y: 600 }]]), "Al");
    placeInFrames(objects, readScene(objects), [sticky], "Al");
    expect(find(objects, sticky)).toMatchObject({
      parent: null,
      cell: null,
      x: 900,
      y: 600,
    });
  });

  it("объединение забирает объекты закрытых ячеек, удаление строки выносит их", () => {
    const { objects, id } = filledTable();
    // Центр (240, 120) — ячейка строки 2, столбца 1.
    const sticky = createObject(objects, "sticky", { x: 140, y: 20 });
    placeInFrames(objects, readScene(objects), [sticky], "Al");
    mergeSelection(
      objects,
      readScene(objects),
      find(objects, id),
      { top: 1, left: 0, bottom: 2, right: 1 },
      "Al",
    );
    const table = shape(objects, id);
    expect(find(objects, sticky)).toMatchObject({
      cell: key(table, 1, 0),
      x: 140,
      y: 20,
    });

    const row = table.rows[1];
    if (row === undefined) throw new Error("нет строки");
    removeLine(
      objects,
      readScene(objects),
      find(objects, id),
      "row",
      row.id,
      "Al",
    );
    expect(find(objects, sticky)).toMatchObject({
      parent: null,
      cell: null,
      x: 140,
      y: 20,
    });
  });

  it("группа в ячейке остаётся в ней; разгруппировка возвращает объекты в ячейку", () => {
    const { objects, id } = filledTable();
    const a = createObject(objects, "sticky", { x: 140, y: -30 });
    const b = createObject(objects, "sticky", { x: 150, y: -40 });
    placeInFrames(objects, readScene(objects), [a, b], "Al");
    const units = readScene(objects).filter((o) => o.id === a || o.id === b);
    const group = groupObjects(objects, units, "Al");
    if (group === null) throw new Error("группа не создана");
    expect(find(objects, group)).toMatchObject({ parent: id });
    expect(find(objects, a)).toMatchObject({ x: 140, y: -30 });
  });

  it("дубликат объекта ячейки — в той же ячейке рядом", () => {
    const { objects, id } = filledTable();
    const sticky = createObject(objects, "sticky", { x: 140, y: -30 });
    placeInFrames(objects, readScene(objects), [sticky], "Al");
    const original = find(objects, sticky);
    const clip = copyObjects(objects, readScene(objects), [sticky]);
    if (clip === null) throw new Error("нет копии");
    const [copy] = pasteObjects(
      objects,
      clip,
      {
        kind: "offset",
        offset: { x: 20, y: 20 },
        parent: id,
        cell: original.cell,
        origin: original.origin,
      },
      "Al",
    );
    expect(find(objects, copy ?? "")).toMatchObject({
      parent: id,
      cell: original.cell,
      x: 160,
      y: -10,
    });
  });
});

describe("TBL-06: обмен с внешней электронной таблицей", () => {
  it("копия таблицы — TSV и HTML-таблица; вставка копии повторяет сетку", () => {
    const { objects, id } = filledTable();
    const clip = copyObjects(objects, readScene(objects), [id]);
    if (clip === null) throw new Error("нет копии");
    expect(clipText(clip)).toBe("0,0\t0,1\t0,2\n1,0\t1,1\t1,2\n2,0\t2,1\t2,2");
    expect(clipHtml(clip)).toBe(gridToHtml(tableGrid(shape(objects, id))));
    const [pasted] = pasteObjects(
      objects,
      clip,
      { kind: "at", point: { x: 1000, y: 1000 }, gridStep: 0 },
      "Bob",
    );
    const copy = find(objects, pasted ?? "");
    expect(copy.table && tableGrid(copy.table)).toEqual(
      tableGrid(shape(objects, id)),
    );
    // Копия — свои общие типы: правка копии не меняет оригинал.
    const map = objectMap(objects, copy.id);
    const cells = map?.get("cells");
    expect(cells).toBeInstanceOf(Y.Map);
  });

  it("TSV внешней таблицы с кавычками, табуляцией и переводом строки в ячейке", () => {
    const grid = [
      ["Name", "Note"],
      ["Ann", 'multi\nline "q"'],
      ["", "tab\there"],
    ];
    const tsv = gridToTsv(grid);
    expect(parseTsv(tsv)).toEqual(grid);
    expect(parseTsv("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    // Пустая первая ячейка не теряется.
    expect(tabularGrid("\tb\nc\td\n", "")).toEqual([
      ["", "b"],
      ["c", "d"],
    ]);
  });

  it("HTML-таблица (Google Sheets, Excel) — сетка, объединения — пустые ячейки", () => {
    const html =
      '<meta charset="utf-8"><google-sheets-html-origin><table><tbody>' +
      '<tr><td colspan="2">Head</td><td>C</td></tr>' +
      "<tr><td>a<br>b</td><td>x &amp; y</td><td></td></tr>" +
      "</tbody></table>";
    expect(parseHtmlTable(html)).toEqual([
      ["Head", "", "C"],
      ["a\nb", "x & y", ""],
    ]);
    expect(tabularGrid("Head C", html)).toEqual([
      ["Head", "", "C"],
      ["a\nb", "x & y", ""],
    ]);
  });

  it("обычный текст и HTML без таблицы — не таблица", () => {
    expect(tabularGrid("hello\nworld", "<p>hello</p>")).toBeNull();
    expect(tabularGrid("", "")).toBeNull();
  });

  it("внешняя таблица вставляется таблицей с той же сеткой", () => {
    const objects = board();
    const grid = parseTsv("A\tB\n1\t2\n3\t4");
    const id = pasteTableGrid(objects, grid, { x: 0, y: 0 }, 0, "Al");
    const table = find(objects, id);
    expect(table.table && tableGrid(table.table)).toEqual(grid);
    // Центр таблицы — в точке вставки.
    expect(table).toMatchObject({ x: -160, y: -72, width: 320, height: 144 });
  });
});

describe("TBL-07: внешняя таблица набором стикеров", () => {
  it("стикер на каждую непустую ячейку, на месте её строки и столбца", () => {
    const objects = board();
    const ids = stickiesFromGrid(
      objects,
      [
        ["A", "B"],
        ["", "D"],
      ],
      { x: 0, y: 0 },
      0,
      "Al",
    );
    const stickies = ids.map((id) => find(objects, id));
    expect(stickies.map((s) => s.type)).toEqual(["sticky", "sticky", "sticky"]);
    expect(stickies.map((s) => [s.text, s.x, s.y])).toEqual([
      ["A", -210, -210],
      ["B", 10, -210],
      ["D", 10, 10],
    ]);
  });
});
