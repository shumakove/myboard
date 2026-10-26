import { useEffect, useRef } from "react";
import { isTypingTarget } from "../canvas/keyboard";
import { ownerOf, type TableShape } from "./tableData";
import {
  cellAfter,
  selectedCells,
  type CellExit,
  type CellSelection,
} from "./tables";
import { dialogOpen } from "./useSceneShortcuts";

/** Выделенные ячейки таблицы и что с ними делают клавиши. */
export interface TableKeyTarget {
  table: TableShape;
  cells: CellSelection;
  setCells: (cells: CellSelection) => void;
  /** Открыть ячейку для ввода. */
  edit: (cell: string) => void;
  /** Очистить текст ячеек. */
  clear: (cells: string[]) => void;
  /** Снять выделение ячеек (таблица остаётся выделенной). */
  exit: () => void;
}

const ARROWS: Record<string, CellExit> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

/**
 * TBL-04: пока выделены ячейки таблицы (и их текст не правят), стрелки переходят между
 * ячейками (Shift — расширяют выделение), Tab и Shift+Tab — к следующей и предыдущей,
 * Enter и F2 открывают ячейку для ввода, Delete и Backspace очищают текст ячеек (а не
 * удаляют таблицу), Escape снимает выделение ячеек. Клавиши перехватываются раньше
 * камеры (стрелки) и команд сцены.
 */
export function useTableKeys(target: TableKeyTarget | null): void {
  const latest = useRef(target);
  useEffect(() => {
    latest.current = target;
  });
  const active = target !== null;

  useEffect(() => {
    if (!active) return;
    function keydown(event: KeyboardEvent) {
      const current = latest.current;
      if (
        current === null ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isTypingTarget(event.target) ||
        dialogOpen()
      ) {
        return;
      }
      const { table, cells } = current;
      const focus = ownerOf(table, cells.focus) ?? cells.focus;
      const arrow = ARROWS[event.key];
      if (arrow !== undefined || event.key === "Tab") {
        event.preventDefault();
        const exit: CellExit = arrow ?? (event.shiftKey ? "previous" : "next");
        const next = cellAfter(table, focus, exit);
        current.setCells(
          event.shiftKey && arrow !== undefined
            ? { ...cells, focus: next }
            : { table: cells.table, anchor: next, focus: next },
        );
      } else if (event.key === "Enter" || event.key === "F2") {
        event.preventDefault();
        current.edit(focus);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        current.clear(selectedCells(table, cells));
      } else if (event.key === "Escape") {
        event.preventDefault();
        current.exit();
      }
    }
    window.addEventListener("keydown", keydown, { capture: true });
    return () => {
      window.removeEventListener("keydown", keydown, { capture: true });
    };
  }, [active]);
}
