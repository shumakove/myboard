import type * as Y from "yjs";
import type { SceneObject } from "./sceneObjects";
import type { TableActions } from "./TableControls";
import {
  CELL_DEFAULTS,
  CELL_STYLE_KEYS,
  cellIndex,
  ownerOf,
  setCellStyle,
  setLineSize,
  unmergeCells,
  type CellStyleKey,
  type TableShape,
} from "./tableData";
import {
  addLine,
  editTable,
  mergeSelection,
  removeLine,
  selectedCells,
  selectionBox,
  type CellSelection,
} from "./tables";

export interface TableContext {
  objects: Y.Map<unknown>;
  scene: readonly SceneObject[];
  /** Одна выделенная незаблокированная таблица. */
  table: SceneObject;
  /** Выделенные ячейки (если они этой таблицы). */
  cells: CellSelection | null;
  actor: string;
  setCells: (cells: CellSelection | null) => void;
  editCell: (table: string, cell: string) => void;
}

/** Общие для ячеек значения оформления; разные — без значения (Mixed). */
function sharedStyle(
  shape: TableShape,
  keys: readonly string[],
): TableActions["style"] {
  const style: TableActions["style"] = {};
  for (const key of CELL_STYLE_KEYS) {
    const values = new Set(
      keys.map((k) => shape.cells.get(k)?.style[key] ?? CELL_DEFAULTS[key]),
    );
    const [only] = values;
    if (values.size === 1 && only !== undefined) style[key] = only;
  }
  return style;
}

/**
 * Действия панели таблицы (T6.7) над выделенными ячейками: оформление (TBL-02, TBL-03),
 * объединение (TBL-03), ввод (TBL-04), строки и столбцы (TBL-01). Без выделенных ячеек
 * строки и столбцы добавляются у края таблицы.
 */
export function tableActionsFor(context: TableContext): TableActions | null {
  const { objects, scene, table, actor, setCells } = context;
  const shape = table.table;
  if (shape === null || table.locked) return null;
  const selection = context.cells?.table === table.id ? context.cells : null;
  const keys = selection === null ? [] : selectedCells(shape, selection);
  const box =
    selection === null
      ? null
      : selectionBox(shape, selection.anchor, selection.focus);
  const focus =
    selection === null || keys.length === 0
      ? null
      : ownerOf(shape, selection.focus);
  const position = focus === null ? null : cellIndex(shape, focus);
  const focusCell = focus === null ? undefined : shape.cells.get(focus);
  const row = position === null ? undefined : shape.rows[position.row];
  const column = position === null ? undefined : shape.columns[position.column];
  const lastRow =
    position === null
      ? shape.rows.at(-1)
      : shape.rows[position.row + (focusCell?.rowSpan ?? 1) - 1];
  const lastColumn =
    position === null
      ? shape.columns.at(-1)
      : shape.columns[position.column + (focusCell?.colSpan ?? 1) - 1];
  const merged = keys.some((k) => {
    const cell = shape.cells.get(k);
    return cell !== undefined && (cell.rowSpan > 1 || cell.colSpan > 1);
  });

  const write = (change: (map: Y.Map<unknown>) => void) => {
    editTable(objects, table, actor, change);
  };

  return {
    cells: keys.length,
    style: sharedStyle(shape, keys),
    setStyle: (key: CellStyleKey, value: string) => {
      write((map) => {
        setCellStyle(map, keys, key, value);
      });
    },
    merge:
      box !== null && keys.length > 1
        ? () => {
            const cell = mergeSelection(objects, scene, table, box, actor);
            if (cell !== null)
              setCells({ table: table.id, anchor: cell, focus: cell });
          }
        : null,
    unmerge:
      box !== null && merged
        ? () => {
            write((map) => {
              unmergeCells(map, shape, box);
            });
          }
        : null,
    editCell:
      focus === null
        ? null
        : () => {
            context.editCell(table.id, focus);
          },
    addRow: (below) => {
      const line = below ? lastRow : (row ?? shape.rows[0]);
      if (line !== undefined)
        addLine(objects, table, "row", line.id, below, actor);
    },
    addColumn: (right) => {
      const line = right ? lastColumn : (column ?? shape.columns[0]);
      if (line !== undefined) {
        addLine(objects, table, "column", line.id, right, actor);
      }
    },
    deleteRow:
      row !== undefined && shape.rows.length > 1
        ? () => {
            if (removeLine(objects, scene, table, "row", row.id, actor)) {
              setCells(null);
            }
          }
        : null,
    deleteColumn:
      column !== undefined && shape.columns.length > 1
        ? () => {
            if (removeLine(objects, scene, table, "column", column.id, actor)) {
              setCells(null);
            }
          }
        : null,
    size:
      row === undefined || column === undefined
        ? null
        : {
            width: column.size,
            height: row.size,
            setWidth: (value) => {
              write((map) => {
                setLineSize(map, column.id, value);
              });
            },
            setHeight: (value) => {
              write((map) => {
                setLineSize(map, row.id, value);
              });
            },
          },
  };
}
