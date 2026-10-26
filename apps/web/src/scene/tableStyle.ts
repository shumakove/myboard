import type { CSSProperties } from "react";
import { textStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";
import { cellRect, type CellRect, type TableCell } from "./tableData";

const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" };
const ALIGN_ITEMS = { top: "flex-start", middle: "center", bottom: "flex-end" };

/** Положение ячейки в слое таблицы. */
export function place(rect: CellRect): CSSProperties {
  return {
    left: rect.x,
    top: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

/** TBL-02, TBL-03: оформление текста и заливка ячейки. */
export function cellLook(cell: TableCell | undefined): CSSProperties {
  const style = cell?.style ?? {};
  const align = style.align ?? "left";
  const valign = style.valign ?? "top";
  return {
    ...textStyle({ fontStyle: style.fontStyle, align }),
    color: style.color,
    background: style.fill,
    justifyContent: JUSTIFY[align as keyof typeof JUSTIFY],
    alignItems: ALIGN_ITEMS[valign as keyof typeof ALIGN_ITEMS],
  };
}

/** Поле правки ячейки — поверх ячейки, с её оформлением. */
export function cellEditorStyle(
  object: SceneObject,
  key: string,
): CSSProperties | null {
  const table = object.table;
  const rect = table === null ? null : cellRect(table, key);
  if (table === null || rect === null) return null;
  const cell = table.cells.get(key);
  const look = cellLook(cell);
  return {
    left: object.x + rect.x,
    top: object.y + rect.y,
    width: rect.width,
    height: rect.height,
    color: look.color,
    fontWeight: look.fontWeight,
    fontStyle: look.fontStyle,
    textDecorationLine: look.textDecorationLine,
    textAlign: look.textAlign,
    background: cell?.style.fill ?? "#ffffff",
  };
}
