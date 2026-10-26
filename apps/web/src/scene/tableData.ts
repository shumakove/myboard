import * as Y from "yjs";

/**
 * Таблица (T6.7, TBL-01…TBL-05) в документе — поля `Y.Map` объекта `type: "table"`:
 * - `columns`, `rows` — `Y.Array` id столбцов и строк по порядку (вставки двух участников
 *   сливаются, COL-01);
 * - `sizes` — `Y.Map` id → ширина столбца или высота строки;
 * - `cells` — `Y.Map` «строка:столбец» → `Y.Map` ячейки: текст `text` (`Y.Text`), оформление
 *   (`color`, `fontStyle`, `align`, `valign`, `fill`) и объединение (`rowSpan`, `colSpan`
 *   у левой верхней ячейки).
 * Рамка таблицы — сумма размеров; поля `width`, `height` повторяют её для чтения JSON.
 */

export const TABLE_TYPE = "table";
export const DEFAULT_COLUMN_WIDTH = 160;
export const DEFAULT_ROW_HEIGHT = 48;
/** Наименьшая ширина столбца и высота строки, единицы доски. */
export const MIN_CELL_SIZE = 24;
/** Новая таблица инструментом: 3×3. */
export const NEW_TABLE_SIZE = 3;

/** TBL-02, TBL-03: свойства оформления ячейки. */
export type CellStyleKey = "color" | "fontStyle" | "align" | "valign" | "fill";
export const CELL_STYLE_KEYS: readonly CellStyleKey[] = [
  "color",
  "fontStyle",
  "align",
  "valign",
  "fill",
];

/** Оформление ячейки, у которой значение не записано. */
export const CELL_DEFAULTS: Record<CellStyleKey, string> = {
  color: "#1f2937",
  fontStyle: "normal",
  align: "left",
  valign: "top",
  fill: "transparent",
};

export type Axis = "row" | "column";

export interface TableLine {
  id: string;
  /** Ширина столбца или высота строки. */
  size: number;
  /** Отступ от левого (верхнего) края таблицы. */
  start: number;
}

export interface TableCell {
  text: string;
  style: Partial<Record<CellStyleKey, string>>;
  rowSpan: number;
  colSpan: number;
}

/** Таблица на сцене: столбцы, строки, ячейки-«владельцы» и закрытые объединением. */
export interface TableShape {
  columns: TableLine[];
  rows: TableLine[];
  /** Видимые ячейки (и левые верхние ячейки объединений) по ключу «строка:столбец». */
  cells: ReadonlyMap<string, TableCell>;
  /** Ячейка, закрытая объединением → ключ его левой верхней ячейки. */
  covered: ReadonlyMap<string, string>;
  width: number;
  height: number;
}

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function cellKey(row: string, column: string): string {
  return `${row}:${column}`;
}

export function splitKey(key: string): { row: string; column: string } {
  const at = key.indexOf(":");
  return { row: key.slice(0, at), column: key.slice(at + 1) };
}

function lineId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function isSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const list = value.filter((id): id is string => typeof id === "string");
  return [...new Set(list)].filter((id) => id !== "" && !id.includes(":"));
}

function lines(
  list: readonly string[],
  sizes: Record<string, unknown>,
  base: number,
) {
  let start = 0;
  return list.map((id) => {
    const raw = sizes[id];
    const size = isSize(raw) ? Math.max(MIN_CELL_SIZE, raw) : base;
    const line = { id, size, start };
    start += size;
    return line;
  });
}

function span(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 1
    ? value
    : 1;
}

/**
 * Таблица из полей объекта (JSON `Y.Map`); без строк или столбцов — `null`. Объединения,
 * задевающие уже закрытые ячейки (одновременные правки двух участников), не применяются.
 */
export function readTable(record: Record<string, unknown>): TableShape | null {
  const sizes = asRecord(record.sizes);
  const columns = lines(ids(record.columns), sizes, DEFAULT_COLUMN_WIDTH);
  const rows = lines(ids(record.rows), sizes, DEFAULT_ROW_HEIGHT);
  if (columns.length === 0 || rows.length === 0) return null;
  const stored = asRecord(record.cells);
  const cells = new Map<string, TableCell>();
  const covered = new Map<string, string>();
  rows.forEach((row, r) => {
    columns.forEach((column, c) => {
      const key = cellKey(row.id, column.id);
      if (covered.has(key)) return;
      const data = asRecord(stored[key]);
      let rowSpan = Math.min(span(data.rowSpan), rows.length - r);
      let colSpan = Math.min(span(data.colSpan), columns.length - c);
      const area = spanKeys(rows, columns, r, c, rowSpan, colSpan);
      if (area.some((k) => covered.has(k) || cells.has(k))) {
        rowSpan = 1;
        colSpan = 1;
      } else {
        for (const k of area) if (k !== key) covered.set(k, key);
      }
      cells.set(key, {
        text: typeof data.text === "string" ? data.text : "",
        style: cellStyle(data),
        rowSpan,
        colSpan,
      });
    });
  });
  const last = (list: TableLine[]) => {
    const end = list.at(-1);
    return end === undefined ? 0 : end.start + end.size;
  };
  return {
    columns,
    rows,
    cells,
    covered,
    width: last(columns),
    height: last(rows),
  };
}

function spanKeys(
  rows: readonly TableLine[],
  columns: readonly TableLine[],
  r: number,
  c: number,
  rowSpan: number,
  colSpan: number,
): string[] {
  const keys: string[] = [];
  for (const row of rows.slice(r, r + rowSpan)) {
    for (const column of columns.slice(c, c + colSpan)) {
      keys.push(cellKey(row.id, column.id));
    }
  }
  return keys;
}

function cellStyle(data: Record<string, unknown>): TableCell["style"] {
  const style: TableCell["style"] = {};
  for (const key of CELL_STYLE_KEYS) {
    const value = data[key];
    if (typeof value === "string") style[key] = value;
  }
  return style;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Ячейка, которой принадлежит ключ: сама ячейка или левая верхняя её объединения. */
export function ownerOf(table: TableShape, key: string): string | null {
  if (table.cells.has(key)) return key;
  return table.covered.get(key) ?? null;
}

/** Положение и размер ячейки (с объединением) относительно левого верхнего угла таблицы. */
export function cellRect(table: TableShape, key: string): CellRect | null {
  const owner = ownerOf(table, key);
  if (owner === null) return null;
  const { row, column } = splitKey(owner);
  const r = table.rows.findIndex((line) => line.id === row);
  const c = table.columns.findIndex((line) => line.id === column);
  const cell = table.cells.get(owner);
  const top = table.rows[r];
  const left = table.columns[c];
  if (cell === undefined || top === undefined || left === undefined)
    return null;
  const bottom = table.rows[r + cell.rowSpan - 1] ?? top;
  const right = table.columns[c + cell.colSpan - 1] ?? left;
  return {
    x: left.start,
    y: top.start,
    width: right.start + right.size - left.start,
    height: bottom.start + bottom.size - top.start,
  };
}

/** Ячейка (её владелец) под точкой относительно таблицы; вне таблицы — `null`. */
export function cellAt(
  table: TableShape,
  point: { x: number; y: number },
): string | null {
  const inside = (line: TableLine, v: number) =>
    v >= line.start && v < line.start + line.size;
  const row = table.rows.find((line) => inside(line, point.y));
  const column = table.columns.find((line) => inside(line, point.x));
  if (row === undefined || column === undefined) return null;
  return ownerOf(table, cellKey(row.id, column.id));
}

/** Номера строки и столбца ячейки; ключ не из таблицы — `null`. */
export function cellIndex(
  table: TableShape,
  key: string,
): { row: number; column: number } | null {
  const { row, column } = splitKey(key);
  const r = table.rows.findIndex((line) => line.id === row);
  const c = table.columns.findIndex((line) => line.id === column);
  return r < 0 || c < 0 ? null : { row: r, column: c };
}

/** Ключ ячейки по номерам строки и столбца. */
export function keyAt(table: TableShape, row: number, column: number) {
  const r = table.rows[row];
  const c = table.columns[column];
  return r === undefined || c === undefined ? null : cellKey(r.id, c.id);
}

/** Текст таблицы сеткой строк (TBL-06): закрытые объединением ячейки — пустые. */
export function tableGrid(table: TableShape): string[][] {
  return table.rows.map((row) =>
    table.columns.map(
      (column) => table.cells.get(cellKey(row.id, column.id))?.text ?? "",
    ),
  );
}

// --- Запись в документ -------------------------------------------------------------

interface TableParts {
  columns: Y.Array<string>;
  rows: Y.Array<string>;
  sizes: Y.Map<number>;
  cells: Y.Map<Y.Map<unknown>>;
}

/**
 * Поля новой таблицы с текстом `grid` (строки × столбцы); пустая сетка — одна ячейка.
 * `sizes` — ширины столбцов и высоты строк, если они не по умолчанию.
 */
export function initTable(
  map: Y.Map<unknown>,
  grid: readonly (readonly string[])[],
  sizes: { columns?: readonly number[]; rows?: readonly number[] } = {},
): void {
  const rowCount = Math.max(1, grid.length);
  const columnCount = Math.max(1, ...grid.map((row) => row.length));
  const columnIds = Array.from({ length: columnCount }, lineId);
  const rowIds = Array.from({ length: rowCount }, lineId);
  const columns = new Y.Array<string>();
  columns.push(columnIds);
  const rows = new Y.Array<string>();
  rows.push(rowIds);
  const sizeMap = new Y.Map<number>();
  columnIds.forEach((id, i) => {
    sizeMap.set(id, sizes.columns?.[i] ?? DEFAULT_COLUMN_WIDTH);
  });
  rowIds.forEach((id, i) => {
    sizeMap.set(id, sizes.rows?.[i] ?? DEFAULT_ROW_HEIGHT);
  });
  const cells = new Y.Map<Y.Map<unknown>>();
  grid.forEach((line, r) => {
    line.forEach((text, c) => {
      if (text === "") return;
      const cell = new Y.Map<unknown>();
      cell.set("text", new Y.Text(text));
      cells.set(cellKey(rowIds[r] as string, columnIds[c] as string), cell);
    });
  });
  map.set("columns", columns);
  map.set("rows", rows);
  map.set("sizes", sizeMap);
  map.set("cells", cells);
  syncFrame(map);
}

/** Части таблицы в документе; недостающие создаются пустыми. */
function parts(map: Y.Map<unknown>): TableParts {
  const list = (key: string): Y.Array<string> => {
    const value = map.get(key);
    if (value instanceof Y.Array) return value as Y.Array<string>;
    const created = new Y.Array<string>();
    map.set(key, created);
    return created;
  };
  const dictionary = <T>(key: string): Y.Map<T> => {
    const value = map.get(key);
    if (value instanceof Y.Map) return value as Y.Map<T>;
    const created = new Y.Map<T>();
    map.set(key, created);
    return created;
  };
  return {
    columns: list("columns"),
    rows: list("rows"),
    sizes: dictionary<number>("sizes"),
    cells: dictionary<Y.Map<unknown>>("cells"),
  };
}

/** `Y.Map` ячейки; создаётся, если её ещё нет. */
export function cellMap(map: Y.Map<unknown>, key: string): Y.Map<unknown> {
  const { cells } = parts(map);
  const existing = cells.get(key);
  if (existing instanceof Y.Map) return existing;
  const cell = new Y.Map<unknown>();
  cells.set(key, cell);
  return cell;
}

/** Текст ячейки для правки (COL-01: правки двух участников сливаются по символам). */
export function cellText(map: Y.Map<unknown>, key: string): Y.Text {
  const cell = cellMap(map, key);
  const text = cell.get("text");
  if (text instanceof Y.Text) return text;
  const created = new Y.Text(typeof text === "string" ? text : "");
  cell.set("text", created);
  return created;
}

/** Поля `width`, `height` таблицы — по сумме размеров столбцов и строк. */
export function syncFrame(map: Y.Map<unknown>): void {
  const table = readTable(map.toJSON());
  if (table === null) return;
  if (map.get("width") !== table.width) map.set("width", table.width);
  if (map.get("height") !== table.height) map.set("height", table.height);
}

/** TBL-01: ширина столбца или высота строки (не меньше `MIN_CELL_SIZE`). */
export function setLineSize(
  map: Y.Map<unknown>,
  id: string,
  size: number,
): void {
  parts(map).sizes.set(id, Math.max(MIN_CELL_SIZE, Math.round(size)));
  syncFrame(map);
}

/**
 * CVS-14 для таблицы: размер рамки меняется пропорциональным изменением всех столбцов
 * и строк.
 */
export function resizeTable(
  map: Y.Map<unknown>,
  size: { width?: number; height?: number },
): void {
  const table = readTable(map.toJSON());
  if (table === null) return;
  const { sizes } = parts(map);
  const scale = (
    list: TableLine[],
    total: number | undefined,
    from: number,
  ) => {
    if (total === undefined || from <= 0) return;
    const factor = total / from;
    for (const line of list) {
      sizes.set(line.id, Math.max(MIN_CELL_SIZE, line.size * factor));
    }
  };
  scale(table.columns, size.width, table.width);
  scale(table.rows, size.height, table.height);
  syncFrame(map);
}

/**
 * TBL-01: новая строка или столбец на месте `index` (0 — в начало). Размер — как у соседа,
 * объединения, через которые проходит новая линия, растягиваются на неё.
 */
export function insertLine(
  map: Y.Map<unknown>,
  axis: Axis,
  index: number,
): string {
  const table = readTable(map.toJSON());
  const { columns, rows, sizes, cells } = parts(map);
  const list = axis === "row" ? rows : columns;
  const at = Math.max(0, Math.min(index, list.length));
  const neighbor = list.get(Math.max(0, at - 1)) as string | undefined;
  const id = lineId();
  const fallback = axis === "row" ? DEFAULT_ROW_HEIGHT : DEFAULT_COLUMN_WIDTH;
  sizes.set(id, (neighbor && sizes.get(neighbor)) || fallback);
  list.insert(at, [id]);
  if (table !== null) {
    for (const [key, cell] of table.cells) {
      const position = cellIndex(table, key);
      if (position === null) continue;
      const start = axis === "row" ? position.row : position.column;
      const count = axis === "row" ? cell.rowSpan : cell.colSpan;
      if (at > start && at < start + count) {
        cells.get(key)?.set(axis === "row" ? "rowSpan" : "colSpan", count + 1);
      }
    }
  }
  syncFrame(map);
  return id;
}

/**
 * TBL-01: удалить строку или столбец; последнюю строку и последний столбец не удаляют.
 * Ячейки линии удаляются, объединения через неё сжимаются, объединение, чья левая
 * верхняя ячейка удалена, распадается. Возвращает `false`, если удалять нельзя.
 */
export function deleteLine(
  map: Y.Map<unknown>,
  axis: Axis,
  id: string,
): boolean {
  const table = readTable(map.toJSON());
  if (table === null) return false;
  const lines = axis === "row" ? table.rows : table.columns;
  const index = lines.findIndex((line) => line.id === id);
  if (index < 0 || lines.length <= 1) return false;
  const { columns, rows, sizes, cells } = parts(map);
  for (const [key, cell] of table.cells) {
    const position = cellIndex(table, key);
    if (position === null) continue;
    const start = axis === "row" ? position.row : position.column;
    const count = axis === "row" ? cell.rowSpan : cell.colSpan;
    if (index > start && index < start + count) {
      cells.get(key)?.set(axis === "row" ? "rowSpan" : "colSpan", count - 1);
    }
  }
  for (const key of [...cells.keys()]) {
    const { row, column } = splitKey(key);
    if ((axis === "row" ? row : column) === id) cells.delete(key);
  }
  const list = axis === "row" ? rows : columns;
  const at = list.toArray().indexOf(id);
  if (at >= 0) list.delete(at, 1);
  sizes.delete(id);
  syncFrame(map);
  return true;
}

/** Прямоугольник ячеек по номерам строк и столбцов (включительно). */
export interface CellBox {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/** Прямоугольник, расширенный до целых объединений, которые он задевает. */
export function expandBox(table: TableShape, box: CellBox): CellBox {
  const next = { ...box };
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key, cell] of table.cells) {
      const position = cellIndex(table, key);
      if (position === null) continue;
      const bottom = position.row + cell.rowSpan - 1;
      const right = position.column + cell.colSpan - 1;
      const overlaps =
        position.row <= next.bottom &&
        bottom >= next.top &&
        position.column <= next.right &&
        right >= next.left;
      if (!overlaps) continue;
      const grown = {
        top: Math.min(next.top, position.row),
        left: Math.min(next.left, position.column),
        bottom: Math.max(next.bottom, bottom),
        right: Math.max(next.right, right),
      };
      if (
        grown.top !== next.top ||
        grown.left !== next.left ||
        grown.bottom !== next.bottom ||
        grown.right !== next.right
      ) {
        Object.assign(next, grown);
        changed = true;
      }
    }
  }
  return next;
}

/** Видимые ячейки (владельцы) внутри прямоугольника, по строкам. */
export function boxCells(table: TableShape, box: CellBox): string[] {
  const keys: string[] = [];
  for (let r = box.top; r <= box.bottom; r++) {
    for (let c = box.left; c <= box.right; c++) {
      const key = keyAt(table, r, c);
      if (key !== null && table.cells.has(key)) keys.push(key);
    }
  }
  return keys;
}

/**
 * TBL-03: объединить ячейки прямоугольника в левую верхнюю. Текст закрытых ячеек
 * дописывается в неё с новой строки, чтобы ничего не потерялось. Возвращает ключ
 * объединённой ячейки или `null`, если объединять нечего.
 */
export function mergeCells(
  map: Y.Map<unknown>,
  table: TableShape,
  box: CellBox,
): string | null {
  const area = expandBox(table, box);
  const anchor = keyAt(table, area.top, area.left);
  const keys = boxCells(table, area);
  if (anchor === null || keys.length < 2) return null;
  const target = cellMap(map, anchor);
  const text = cellText(map, anchor);
  const { cells } = parts(map);
  for (const key of keys) {
    if (key === anchor) continue;
    const moved = table.cells.get(key)?.text ?? "";
    if (moved !== "")
      text.insert(text.length, text.length > 0 ? `\n${moved}` : moved);
    cells.delete(key);
  }
  target.set("rowSpan", area.bottom - area.top + 1);
  target.set("colSpan", area.right - area.left + 1);
  return anchor;
}

/** TBL-03: разъединить объединённые ячейки прямоугольника. */
export function unmergeCells(
  map: Y.Map<unknown>,
  table: TableShape,
  box: CellBox,
): void {
  for (const key of boxCells(table, expandBox(table, box))) {
    const cell = table.cells.get(key);
    if (cell === undefined || (cell.rowSpan === 1 && cell.colSpan === 1)) {
      continue;
    }
    const target = cellMap(map, key);
    target.delete("rowSpan");
    target.delete("colSpan");
  }
}

/** TBL-02, TBL-03: оформление ячеек. */
export function setCellStyle(
  map: Y.Map<unknown>,
  keys: readonly string[],
  key: CellStyleKey,
  value: string,
): void {
  for (const cell of keys) cellMap(map, cell).set(key, value);
}

/** Очистить текст ячеек (Delete у выделенных ячеек). */
export function clearCells(map: Y.Map<unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    const text = cellText(map, key);
    if (text.length > 0) text.delete(0, text.length);
  }
}

/**
 * Значение поля таблицы при вставке копии (CVS-20): структура из JSON копии снова
 * становится общими типами Yjs. Остальные поля — `undefined` (не поле таблицы).
 */
export function tableFieldValue(key: string, value: unknown): unknown {
  if (key === "columns" || key === "rows") {
    const list = new Y.Array<string>();
    list.push(ids(value));
    return list;
  }
  if (key === "sizes") {
    const sizes = new Y.Map<number>();
    for (const [id, size] of Object.entries(asRecord(value))) {
      if (isSize(size)) sizes.set(id, size);
    }
    return sizes;
  }
  if (key === "cells") {
    const cells = new Y.Map<Y.Map<unknown>>();
    for (const [id, data] of Object.entries(asRecord(value))) {
      const cell = new Y.Map<unknown>();
      for (const [field, v] of Object.entries(asRecord(data))) {
        cell.set(
          field,
          field === "text" && typeof v === "string" ? new Y.Text(v) : v,
        );
      }
      cells.set(id, cell);
    }
    return cells;
  }
  return undefined;
}
