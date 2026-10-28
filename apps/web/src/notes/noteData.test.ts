import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import {
  checkNoteItem,
  ensureNoteText,
  isNoteOpenForAll,
  noteOps,
  noteText,
  setNoteOpenForAll,
} from "./noteData";

/** Обмен обновлениями двух копий документа — как через сервер. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("NTE-01…NTE-03: заметка доски в корне notes", () => {
  it("новая доска — заметки нет и она не закреплена", () => {
    const { notes } = createBoardDocument();
    expect(noteText(notes)).toBeNull();
    expect(noteOps(notes)).toEqual([]);
    expect(isNoteOpenForAll(notes)).toBe(false);
  });

  it("текст с блоками и ссылкой на объект и флаг доходят до другого участника", () => {
    const alice = createBoardDocument();
    const bob = createBoardDocument();
    ensureNoteText(alice.notes).applyDelta([
      { insert: "Goals" },
      { insert: "\n", attributes: { header: 1 } },
      { insert: { objectLink: "sticky-1" } },
      { insert: "\n" },
    ]);
    setNoteOpenForAll(alice.notes, true);
    sync(alice.doc, bob.doc);
    expect(isNoteOpenForAll(bob.notes)).toBe(true);
    expect(noteOps(bob.notes)).toEqual([
      { insert: "Goals" },
      { insert: "\n", attributes: { header: 1 } },
      { insert: { objectLink: "sticky-1" } },
      { insert: "\n" },
    ]);
    setNoteOpenForAll(bob.notes, false);
    sync(alice.doc, bob.doc);
    expect(isNoteOpenForAll(alice.notes)).toBe(false);
  });

  it("заметку начали двое одновременно — у обоих одна и та же заметка", () => {
    const alice = createBoardDocument();
    const bob = createBoardDocument();
    ensureNoteText(alice.notes).insert(0, "from Alice");
    ensureNoteText(bob.notes).insert(0, "from Bob");
    sync(alice.doc, bob.doc);
    expect(noteText(alice.notes)?.toString()).toBe(
      noteText(bob.notes)?.toString(),
    );
    // Дальнейшие правки обоих идут в один текст.
    ensureNoteText(bob.notes).insert(0, "> ");
    sync(alice.doc, bob.doc);
    expect(noteText(alice.notes)?.toString()).toMatch(/^> from /);
  });

  it("отметка пункта списка дел пишется в атрибут строки", () => {
    const { notes } = createBoardDocument();
    ensureNoteText(notes).applyDelta([
      { insert: "Buy milk" },
      { insert: "\n", attributes: { list: "unchecked" } },
    ]);
    checkNoteItem(notes, 8, true);
    expect(noteOps(notes)).toEqual([
      { insert: "Buy milk" },
      { insert: "\n", attributes: { list: "checked" } },
    ]);
  });
});
