import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { placeInFrames, reparent } from "./frames";
import type { Gesture, ScenePointer } from "./gestures";
import { snap } from "./geometry";
import { OBJECT_TYPES } from "./objectTypes";
import {
  createObject,
  objectMap,
  readScene,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";
import {
  boxCells,
  cellIndex,
  DEFAULT_COLUMN_WIDTH,
  DEFAULT_ROW_HEIGHT,
  deleteLine,
  expandBox,
  initTable,
  insertLine,
  keyAt,
  mergeCells,
  ownerOf,
  setLineSize,
  splitKey,
  TABLE_TYPE,
  type Axis,
  type CellBox,
  type TableShape,
} from "./tableData";
import type { Grid } from "./tableExchange";

export { TABLE_TYPE };

/**
 * Таблицы (T6.7) на доске: создание, вставка внешних данных таблицей или стикерами,
 * перемещение по ячейкам и правки строк, столбцов и объединений вместе с объектами,
 * лежащими в ячейках (TBL-05).
 */

/** Выделенные ячейки одной таблицы: от `anchor` до `focus` (Shift расширяет, TBL-04). */
export interface CellSelection {
  table: string;
  anchor: string;
  focus: string;
}

/** Шаг сетки стикеров из внешней таблицы: стикер 200 и промежуток 20 (TBL-07). */
export const STICKY_GRID_STEP = 220;

/** Пустая сетка `rows` × `columns`. */
export function emptyGrid(rows: number, columns: number): Grid {
  return Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ""),
  );
}

/**
 * TBL-01: новая таблица с левым верхним углом в `at` и текстом ячеек из `grid`.
 * Возвращает id таблицы.
 */
export function createTable(
  objects: Y.Map<unknown>,
  at: Point,
  grid: Grid,
  actor: string,
): string {
  const columns = Math.max(1, ...grid.map((row) => row.length));
  const size = {
    width: columns * DEFAULT_COLUMN_WIDTH,
    height: Math.max(1, grid.length) * DEFAULT_ROW_HEIGHT,
  };
  let id = "";
  transact(objects, () => {
    id = createObject(objects, TABLE_TYPE, at, "", actor, {}, size);
    const map = objectMap(objects, id);
    if (map === null) return;
    map.delete("text"); // текст таблицы — в ячейках
    initTable(map, grid);
  });
  return id;
}

/** Левый верхний угол блока размера `size` центром в точке, угол — на сетке. */
function centered(
  point: Point,
  size: { width: number; height: number },
  gridStep: number,
): Point {
  return {
    x: snap(point.x - size.width / 2, gridStep),
    y: snap(point.y - size.height / 2, gridStep),
  };
}

/** TBL-06: данные внешней таблицы — таблицей центром в точке. Возвращает её id. */
export function pasteTableGrid(
  objects: Y.Map<unknown>,
  grid: Grid,
  point: Point,
  gridStep: number,
  actor: string,
): string {
  const columns = Math.max(1, ...grid.map((row) => row.length));
  const size = {
    width: columns * DEFAULT_COLUMN_WIDTH,
    height: grid.length * DEFAULT_ROW_HEIGHT,
  };
  let id = "";
  transact(objects, () => {
    id = createTable(objects, centered(point, size, gridStep), grid, actor);
    placeInFrames(objects, readScene(objects), [id], actor);
  });
  return id;
}

/**
 * TBL-07: данные внешней таблицы — стикерами: стикер на каждую непустую ячейку, на месте
 * её строки и столбца. Возвращает id стикеров.
 */
export function stickiesFromGrid(
  objects: Y.Map<unknown>,
  grid: Grid,
  point: Point,
  gridStep: number,
  actor: string,
): string[] {
  const columns = Math.max(1, ...grid.map((row) => row.length));
  const sticky = OBJECT_TYPES.sticky;
  const size = {
    width: (columns - 1) * STICKY_GRID_STEP + sticky.width,
    height: (grid.length - 1) * STICKY_GRID_STEP + sticky.height,
  };
  const origin = centered(point, size, gridStep);
  const ids: string[] = [];
  transact(objects, () => {
    grid.forEach((row, r) => {
      row.forEach((text, c) => {
        if (text.trim() === "") return;
        const at = {
          x: origin.x + c * STICKY_GRID_STEP,
          y: origin.y + r * STICKY_GRID_STEP,
        };
        ids.push(createObject(objects, "sticky", at, text, actor));
      });
    });
    placeInFrames(objects, readScene(objects), ids, actor);
  });
  return ids;
}

/** Прямоугольник выделенных ячеек, расширенный до целых объединений. */
export function selectionBox(
  table: TableShape,
  anchor: string,
  focus: string,
): CellBox | null {
  const a = cellIndex(table, anchor);
  const b = cellIndex(table, focus);
  if (a === null || b === null) return null;
  return expandBox(table, {
    top: Math.min(a.row, b.row),
    left: Math.min(a.column, b.column),
    bottom: Math.max(a.row, b.row),
    right: Math.max(a.column, b.column),
  });
}

/** Видимые ячейки выделения; выделения нет или оно устарело — пусто. */
export function selectedCells(
  table: TableShape,
  selection: Pick<CellSelection, "anchor" | "focus">,
): string[] {
  const box = selectionBox(table, selection.anchor, selection.focus);
  return box === null ? [] : boxCells(table, box);
}

export type Direction = "left" | "right" | "up" | "down";

/**
 * TBL-04: соседняя ячейка в сторону стрелки (объединённая ячейка — целиком). У края
 * таблицы — та же ячейка.
 */
export function neighborCell(
  table: TableShape,
  key: string,
  direction: Direction,
): string {
  const owner = ownerOf(table, key);
  const position = owner === null ? null : cellIndex(table, owner);
  const cell = owner === null ? undefined : table.cells.get(owner);
  if (owner === null || position === null || cell === undefined) return key;
  const { row, column } = position;
  const next =
    direction === "left"
      ? keyAt(table, row, column - 1)
      : direction === "right"
        ? keyAt(table, row, column + cell.colSpan)
        : direction === "up"
          ? keyAt(table, row - 1, column)
          : keyAt(table, row + cell.rowSpan, column);
  return next === null ? owner : (ownerOf(table, next) ?? owner);
}

/**
 * TBL-04: следующая (Tab) или предыдущая (Shift+Tab) ячейка по строкам; после последней
 * ячейки строки — первая следующей. На краю таблицы — та же ячейка.
 */
export function stepCell(
  table: TableShape,
  key: string,
  backwards: boolean,
): string {
  const owner = ownerOf(table, key) ?? key;
  const order: string[] = [];
  for (const row of table.rows) {
    for (const column of table.columns) {
      const k = `${row.id}:${column.id}`;
      if (table.cells.has(k)) order.push(k);
    }
  }
  const at = order.indexOf(owner);
  if (at < 0) return owner;
  return order[at + (backwards ? -1 : 1)] ?? owner;
}

/** Объекты, лежащие в ячейках `keys` таблицы (TBL-05). */
function cellChildren(
  scene: readonly SceneObject[],
  table: SceneObject,
  keys: ReadonlySet<string>,
): SceneObject[] {
  const shape = table.table;
  if (shape === null) return [];
  return scene.filter((o) => {
    if (o.parent !== table.id || o.cell === null) return false;
    const owner = ownerOf(shape, o.cell);
    return owner !== null && keys.has(owner);
  });
}

/** Свежая таблица после правки — для пересчёта координат объектов в ячейках. */
function fresh(objects: Y.Map<unknown>, id: string): SceneObject | null {
  return readScene(objects).find((o) => o.id === id) ?? null;
}

/** Правка структуры таблицы одной транзакцией с отметкой «изменил» (CVS-22). */
export function editTable(
  objects: Y.Map<unknown>,
  table: SceneObject,
  actor: string,
  write: (map: Y.Map<unknown>) => void,
): void {
  transact(objects, () => {
    const map = objectMap(objects, table.id);
    if (map === null) return;
    write(map);
    touch(map, actor);
  });
}

/**
 * TBL-01: новая строка (столбец) до или после линии `lineId`. Возвращает id новой линии.
 */
export function addLine(
  objects: Y.Map<unknown>,
  table: SceneObject,
  axis: Axis,
  lineId: string,
  after: boolean,
  actor: string,
): string | null {
  const shape = table.table;
  if (shape === null) return null;
  const lines = axis === "row" ? shape.rows : shape.columns;
  const index = lines.findIndex((line) => line.id === lineId);
  let id: string | null = null;
  editTable(objects, table, actor, (map) => {
    id = insertLine(
      map,
      axis,
      index < 0 ? lines.length : index + (after ? 1 : 0),
    );
  });
  return id;
}

/**
 * TBL-01: удалить строку (столбец). Объекты из её ячеек остаются на доске на своём месте —
 * у родителя таблицы. Последнюю строку и последний столбец не удаляют.
 */
export function removeLine(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  table: SceneObject,
  axis: Axis,
  lineId: string,
  actor: string,
): boolean {
  const shape = table.table;
  if (shape === null) return false;
  const lines = axis === "row" ? shape.rows : shape.columns;
  if (lines.length <= 1) return false;
  const owners = new Set(
    [...shape.cells.keys()].filter((key) => {
      const { row, column } = splitKey(key);
      return (axis === "row" ? row : column) === lineId;
    }),
  );
  const parent = scene.find((o) => o.id === table.parent) ?? null;
  let removed = false;
  editTable(objects, table, actor, (map) => {
    for (const child of cellChildren(scene, table, owners)) {
      reparent(
        objects,
        scene,
        child,
        parent === null ? null : { parent, cell: table.cell },
        actor,
      );
    }
    removed = deleteLine(map, axis, lineId);
  });
  return removed;
}

/**
 * TBL-03: объединить выделенные ячейки. Объекты из закрытых ячеек переходят в объединённую
 * и остаются на месте доски. Возвращает ключ объединённой ячейки.
 */
export function mergeSelection(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  table: SceneObject,
  box: CellBox,
  actor: string,
): string | null {
  const shape = table.table;
  if (shape === null) return null;
  const keys = new Set(boxCells(shape, expandBox(shape, box)));
  let merged: string | null = null;
  editTable(objects, table, actor, (map) => {
    merged = mergeCells(map, shape, box);
    const target = merged === null ? null : fresh(objects, table.id);
    if (merged === null || target === null) return;
    for (const child of cellChildren(scene, table, keys)) {
      if (child.cell === merged) continue;
      reparent(objects, scene, child, { parent: target, cell: merged }, actor);
    }
  });
  return merged;
}

/**
 * TBL-01: границу столбца (строки) тянут — ширина (высота) следует за указателем,
 * не меньше `MIN_CELL_SIZE`.
 */
export function lineResizeGesture(
  objects: Y.Map<unknown>,
  table: SceneObject,
  axis: Axis,
  lineId: string,
  start: Point,
  actor: string,
): Gesture {
  const lines = axis === "row" ? table.table?.rows : table.table?.columns;
  const line = lines?.find((l) => l.id === lineId);
  const apply = ({ board }: ScenePointer) => {
    if (line === undefined) return;
    const delta = axis === "row" ? board.y - start.y : board.x - start.x;
    editTable(objects, table, actor, (map) => {
      setLineSize(map, lineId, line.size + delta);
    });
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/** Куда уходит ввод из ячейки по клавише (TBL-04); `null` — клавиша остаётся полю. */
export type CellExit = Direction | "next" | "previous";

/**
 * TBL-04: стрелка на краю текста ячейки переводит ввод в соседнюю ячейку — влево с начала
 * текста, вправо с конца, вверх с первой строки, вниз с последней; Tab и Shift+Tab —
 * в следующую и предыдущую ячейку.
 */
export function editorExit(
  key: string,
  field: { value: string; selectionStart: number; selectionEnd: number },
  shiftKey: boolean,
): CellExit | null {
  if (key === "Tab") return shiftKey ? "previous" : "next";
  const { value, selectionStart: start, selectionEnd: end } = field;
  if (start !== end || shiftKey) return null;
  if (key === "ArrowLeft" && start === 0) return "left";
  if (key === "ArrowRight" && end === value.length) return "right";
  if (key === "ArrowUp" && !value.slice(0, start).includes("\n")) return "up";
  if (key === "ArrowDown" && !value.slice(end).includes("\n")) return "down";
  return null;
}

/** Ячейка, в которую ведёт выход из ввода или клавиша навигации. */
export function cellAfter(
  table: TableShape,
  key: string,
  exit: CellExit,
): string {
  if (exit === "next") return stepCell(table, key, false);
  if (exit === "previous") return stepCell(table, key, true);
  return neighborCell(table, key, exit);
}
