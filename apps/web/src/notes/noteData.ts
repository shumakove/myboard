import * as Y from "yjs";
import type { DeltaOp } from "../richtext/delta";

/**
 * Заметка доски в корне `notes` (`Y.XmlFragment`, ARCHITECTURE.md, раздел 6; NTE-01…NTE-03).
 * Строение — docs/decisions.md, T6.12: в корне один `Y.XmlText` с текстом заметки в той же
 * модели, что у документа (атрибуты Quill, вставки `divider` и `objectLink` с id объекта),
 * флаг «открывать всем при входе» — атрибут этого `Y.XmlText`.
 *
 * BUG-027 (COL-01): текст заметки создаётся детерминированно — одним и тем же обновлением
 * от служебного клиента `NOTE_CLIENT_ID` у всех участников. Если двое начали пустую
 * заметку одновременно (в сети или без связи), их обновления совпадают побайтно, Yjs
 * считает узел одним и тем же, и правки обоих пишутся в один текст.
 */

/** Атрибут текста заметки: `true` — заметка открыта у каждого входящего (NTE-02). */
export const OPEN_FOR_ALL = "openForAll";

/** Служебный клиент Yjs, от имени которого создаётся текст заметки. */
const NOTE_CLIENT_ID = 0;

/** Обновление «в корне `notes` есть текст заметки» — одинаковое у всех участников. */
let noteUpdate: Uint8Array | null = null;

function createNoteUpdate(): Uint8Array {
  if (noteUpdate === null) {
    const seed = new Y.Doc();
    seed.clientID = NOTE_CLIENT_ID;
    seed.getXmlFragment("notes").insert(0, [new Y.XmlText()]);
    noteUpdate = Y.encodeStateAsUpdate(seed);
    seed.destroy();
  }
  return noteUpdate;
}

function isCanonical(text: Y.XmlText): boolean {
  return text._item?.id.client === NOTE_CLIENT_ID;
}

/**
 * Текст заметки; `null` — заметку ещё не начинали. Предпочитается детерминированный узел;
 * заметка, записанная до BUG-027 (узел со случайным id), читается как раньше — первый
 * текст корня.
 */
export function noteText(notes: Y.XmlFragment): Y.XmlText | null {
  const texts = notes
    .toArray()
    .filter((child): child is Y.XmlText => child instanceof Y.XmlText);
  return texts.find(isCanonical) ?? texts[0] ?? null;
}

/** Текст заметки; создаётся при первой правке или закреплении (BUG-027 — см. выше). */
export function ensureNoteText(notes: Y.XmlFragment): Y.XmlText {
  const existing = noteText(notes);
  if (existing !== null) return existing;
  const doc = notes.doc;
  if (doc === null) throw new Error("Заметка доски вне документа");
  Y.applyUpdate(doc, createNoteUpdate());
  const created = noteText(notes);
  if (created === null) throw new Error("Текст заметки не создан");
  return created;
}

/** NTE-02: заметка закреплена — открывается у всех при входе. */
export function isNoteOpenForAll(notes: Y.XmlFragment): boolean {
  return noteText(notes)?.getAttribute(OPEN_FOR_ALL) === true;
}

export function setNoteOpenForAll(notes: Y.XmlFragment, open: boolean): void {
  ensureNoteText(notes).setAttribute(OPEN_FOR_ALL, open);
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
