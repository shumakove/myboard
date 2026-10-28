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

/** Видимый текст заметки — то, что показывает панель. */
function plainText(notes: Y.XmlFragment): string {
  return noteOps(notes)
    .map((op) => (typeof op.insert === "string" ? op.insert : ""))
    .join("");
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

  it("BUG-027: двое одновременно начали пустую заметку — текст обоих сохраняется у всех", () => {
    const owner = createBoardDocument();
    const guest = createBoardDocument();
    // Оба начали заметку и пишут, пока не получили правок друг друга.
    ensureNoteText(owner.notes).insert(0, "OWNERWORD");
    ensureNoteText(guest.notes).insert(0, "GUESTWORD");
    sync(owner.doc, guest.doc);
    for (const board of [owner, guest]) {
      expect(board.notes.length).toBe(1);
      const shown = plainText(board.notes);
      expect(shown).toContain("OWNERWORD");
      expect(shown).toContain("GUESTWORD");
    }
    expect(noteText(owner.notes)?.toString()).toBe(
      noteText(guest.notes)?.toString(),
    );
    // Узел, в который каждый уже пишет, остаётся заметкой и после обмена.
    const ownerText = noteText(owner.notes);
    ensureNoteText(owner.notes).insert(0, "> ");
    expect(noteText(owner.notes)).toBe(ownerText);
    sync(owner.doc, guest.doc);
    expect(noteText(guest.notes)?.toString()).toMatch(/^> /);
  });

  it("BUG-027: участник без связи написал в пустую заметку — после восстановления у всех оба текста", () => {
    const owner = createBoardDocument();
    const guest = createBoardDocument();
    const server = createBoardDocument();
    sync(server.doc, guest.doc);
    // Участник офлайн; владелец пишет через сервер.
    ensureNoteText(guest.notes).insert(0, "GUESTWORD");
    setNoteOpenForAll(guest.notes, true);
    ensureNoteText(owner.notes).insert(0, "OWNERWORD");
    sync(owner.doc, server.doc);
    // Связь участника восстановилась.
    sync(guest.doc, server.doc);
    sync(owner.doc, server.doc);
    for (const board of [owner, guest, server]) {
      expect(board.notes.length).toBe(1);
      const shown = plainText(board.notes);
      expect(shown).toContain("OWNERWORD");
      expect(shown).toContain("GUESTWORD");
      expect(isNoteOpenForAll(board.notes)).toBe(true);
    }
  });

  it("заметка, записанная прежним узлом, читается и правится дальше", () => {
    const board = createBoardDocument();
    const legacy = new Y.XmlText();
    board.notes.insert(0, [legacy]);
    legacy.insert(0, "Old note");
    expect(ensureNoteText(board.notes)).toBe(legacy);
    setNoteOpenForAll(board.notes, true);
    expect(board.notes.length).toBe(1);
    expect(noteText(board.notes)?.toString()).toBe("Old note");
    expect(isNoteOpenForAll(board.notes)).toBe(true);
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
