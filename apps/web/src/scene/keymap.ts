import { TOOLS, type ToolId } from "./tools";

/** Клавиши для подсказок кнопок (`aria-keyshortcuts`, CVS-25). */
export const UNDO_KEYS = "Control+Z Meta+Z";
export const REDO_KEYS = "Control+Shift+Z Meta+Shift+Z Control+Y";

export type HistoryKey = "undo" | "redo";

type KeyEvent = Pick<
  KeyboardEvent,
  "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/**
 * CVS-07, CVS-25: Ctrl/⌘+Z — отмена, Ctrl/⌘+Shift+Z и Ctrl+Y — повтор.
 * По коду клавиши, а не символу: работает и в русской раскладке.
 */
export function historyKey(event: KeyEvent): HistoryKey | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  if (event.code === "KeyZ") return event.shiftKey ? "redo" : "undo";
  if (event.code === "KeyY" && !event.shiftKey) return "redo";
  return null;
}

/** CVS-25: инструмент по клавише без модификаторов (V, L, N, S, T). */
export function toolKey(event: KeyEvent): ToolId | null {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    return null;
  }
  return TOOLS.find((tool) => tool.key === event.code)?.id ?? null;
}
