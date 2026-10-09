import type { DeltaOp } from "./delta";
import type { Quill } from "./quill";

/**
 * TXT-03: быстрая разметка в начале строки — после пробела префикс превращается в формат
 * строки и исчезает: `#`, `##`, `###` — заголовок, `-` или `*` — маркированный список,
 * `1.` — нумерованный, `[]` / `[ ]` — список дел, `[x]` — отмеченный пункт.
 */
const LINE_PREFIXES: readonly [RegExp, string, unknown][] = [
  [/^#$/, "header", 1],
  [/^##$/, "header", 2],
  [/^###$/, "header", 3],
  [/^[-*]$/, "list", "bullet"],
  [/^\d+\.$/, "list", "ordered"],
  [/^\[ ?\]$/, "list", "unchecked"],
  [/^\[x\]$/i, "list", "checked"],
];

/** Позиция единственной вставки `text` в дельте правки или `null`. */
export function insertedAt(
  ops: readonly DeltaOp[],
  text: string,
): number | null {
  let index = 0;
  let found: number | null = null;
  for (const op of ops) {
    if (op.retain !== undefined) index += op.retain;
    else if (op.insert !== undefined) {
      if (op.insert !== text || found !== null) return null;
      found = index;
      index += 1;
    }
  }
  return found;
}

/**
 * Применяет быструю разметку к только что введённому символу (правка пользователя
 * `ops`). Правки — тоже от пользователя: попадают в документ и в отмену поля.
 * Возвращает `true`, если разметка сработала.
 */
export function applyShortcut(quill: Quill, ops: readonly DeltaOp[]): boolean {
  const space = insertedAt(ops, " ");
  if (space !== null) return lineShortcut(quill, space);
  const dash = insertedAt(ops, "-");
  if (dash !== null && dash > 0 && quill.getText(dash - 1, 1) === "-") {
    // Два дефиса подряд — длинное тире.
    quill.deleteText(dash - 1, 2, "user");
    quill.insertText(dash - 1, "—", "user");
    quill.setSelection(dash, 0, "silent");
    return true;
  }
  return false;
}

function lineShortcut(quill: Quill, space: number): boolean {
  const [line, offset] = quill.getLine(space);
  if (line === null) return false;
  const start = space - offset;
  const prefix = quill.getText(start, offset);
  const match = LINE_PREFIXES.find(([pattern]) => pattern.test(prefix));
  if (match === undefined) return false;
  const [, format, value] = match;
  const current = quill.getFormat(start, 0);
  // Префикс внутри уже оформленной строки того же вида — обычный текст.
  if (current[format] !== undefined) return false;
  quill.deleteText(start, offset + 1, "user");
  quill.formatLine(start, 0, format, value, "user");
  quill.setSelection(start, 0, "silent");
  return true;
}
