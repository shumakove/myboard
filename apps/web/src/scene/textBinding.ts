import type * as Y from "yjs";

/**
 * Правка поля ввода → `Y.Text` минимальной заменой: общий префикс и суффикс остаются,
 * меняется только середина. Так одновременные правки разных мест текста сливаются (COL-01).
 */
export function applyTextChange(
  text: Y.Text,
  before: string,
  after: string,
): void {
  if (before === after) return;
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  ) {
    start++;
  }
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end++;
  }
  const removed = before.length - start - end;
  const inserted = after.slice(start, after.length - end);
  const write = () => {
    if (removed > 0) text.delete(start, removed);
    if (inserted) text.insert(start, inserted);
  };
  if (text.doc === null) write();
  else text.doc.transact(write);
}

/** Позиция курсора после чужой правки текста (дельта события `Y.Text`). */
export function shiftIndex(
  index: number,
  delta: readonly { retain?: number; insert?: unknown; delete?: number }[],
): number {
  // `position` — позиция в прежнем тексте: вставка её не двигает, удаление и пропуск — да.
  let position = 0;
  let result = index;
  for (const op of delta) {
    if (position > index) break;
    if (op.retain !== undefined) {
      position += op.retain;
    } else if (op.insert !== undefined) {
      result += typeof op.insert === "string" ? op.insert.length : 1;
    } else if (op.delete !== undefined) {
      result -= Math.min(op.delete, index - position);
      position += op.delete;
    }
  }
  return Math.max(0, result);
}
