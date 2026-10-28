import * as Y from "yjs";
import type { DeltaOp } from "../richtext/delta";

/**
 * Заметка доски в корне `notes` (`Y.XmlFragment`, ARCHITECTURE.md, раздел 6; NTE-01…NTE-03).
 * Строение — docs/decisions.md, T6.12: в корне один `Y.XmlText` с текстом заметки в той же
 * модели, что у документа (атрибуты Quill, вставки `divider` и `objectLink` с id объекта),
 * флаг «открывать всем при входе» — атрибут этого `Y.XmlText`.
 */

/** Атрибут текста заметки: `true` — заметка открыта у каждого входящего (NTE-02). */
export const OPEN_FOR_ALL = "openForAll";

/**
 * Текст заметки; `null` — заметку ещё не начинали. Если два участника одновременно
 * начали заметку, у всех берётся один и тот же первый текст корня.
 */
export function noteText(notes: Y.XmlFragment): Y.XmlText | null {
  for (const child of notes.toArray()) {
    if (child instanceof Y.XmlText) return child;
  }
  return null;
}

/** Текст заметки; создаётся при первой правке или закреплении. */
export function ensureNoteText(notes: Y.XmlFragment): Y.XmlText {
  const existing = noteText(notes);
  if (existing !== null) return existing;
  const text = new Y.XmlText();
  notes.insert(0, [text]);
  return text;
}

/** NTE-02: заметка закреплена — открывается у всех при входе. */
export function isNoteOpenForAll(notes: Y.XmlFragment): boolean {
  return noteText(notes)?.getAttribute(OPEN_FOR_ALL) === true;
}

export function setNoteOpenForAll(notes: Y.XmlFragment, open: boolean): void {
  const apply = () => {
    ensureNoteText(notes).setAttribute(OPEN_FOR_ALL, open);
  };
  if (notes.doc === null) apply();
  else notes.doc.transact(apply);
}

/** Содержимое заметки дельтой — для показа (`RichText`). */
export function noteOps(notes: Y.XmlFragment): DeltaOp[] {
  return (noteText(notes)?.toDelta() ?? []) as DeltaOp[];
}

/** TXT-02 в заметке: отметка пункта списка дел; `end` — перевод строки пункта. */
export function checkNoteItem(
  notes: Y.XmlFragment,
  end: number,
  checked: boolean,
): void {
  const text = noteText(notes);
  if (text === null || end >= text.length) return;
  text.format(end, 1, { list: checked ? "checked" : "unchecked" });
}
