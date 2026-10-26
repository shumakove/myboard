import type { SceneObject } from "./sceneObjects";
import { cellRect } from "./tableData";
import { cellLook, place } from "./tableStyle";

/** Выделенные ячейки таблицы на холсте (TBL-02…TBL-04). */
export interface TableCellsState {
  keys: ReadonlySet<string>;
  /** Активная ячейка — от неё ходят стрелками (TBL-04). */
  focus: string;
  /** Ячейка, текст которой сейчас правят: на холсте её текст скрыт под полем. */
  editing: string | null;
}

/**
 * Таблица на холсте (T6.7): ячейки — DOM-элементы с текстом и оформлением (TBL-02,
 * TBL-03), объединённая ячейка — один элемент на всю площадь. У выделенной таблицы —
 * маркеры границ столбцов и строк: их тянут, чтобы менять ширину и высоту (TBL-01).
 */
export function TableView({
  object,
  cells,
  handles,
}: {
  object: SceneObject;
  cells: TableCellsState | null;
  handles: boolean;
}) {
  const table = object.table;
  if (table === null) return null;
  return (
    <>
      {[...table.cells].map(([key, cell]) => {
        const rect = cellRect(table, key);
        if (rect === null) return null;
        const selected = cells?.keys.has(key) === true;
        return (
          <div
            key={key}
            className="table-cell"
            data-cell={key}
            data-selected={selected ? "true" : undefined}
            data-focus={cells?.focus === key ? "true" : undefined}
            style={{ ...place(rect), ...cellLook(cell) }}
          >
            {cells?.editing !== key && (
              <span className="table-cell-text">{cell.text}</span>
            )}
          </div>
        );
      })}
      {handles &&
        table.columns.map((column) => (
          <div
            key={`col:${column.id}`}
            className="table-resize table-resize-column"
            data-handle={`col:${column.id}`}
            aria-hidden="true"
            style={{ left: column.start + column.size, height: table.height }}
          />
        ))}
      {handles &&
        table.rows.map((row) => (
          <div
            key={`row:${row.id}`}
            className="table-resize table-resize-row"
            data-handle={`row:${row.id}`}
            aria-hidden="true"
            style={{ top: row.start + row.size, width: table.width }}
          />
        ))}
    </>
  );
}
