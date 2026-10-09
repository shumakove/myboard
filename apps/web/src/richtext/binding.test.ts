import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { bindQuill } from "./binding";
import { Delta } from "./quill";
import { mountQuill } from "./testQuill";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("COL-01: редактор и Y.Text объекта", () => {
  it("правка в поле — в Y.Text с форматированием; onEdit — в той же транзакции", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    const quill = mountQuill();
    let transactions = 0;
    doc.on("afterTransaction", () => {
      transactions += 1;
    });
    let edits = 0;
    bindQuill(quill, text, () => {
      edits += 1;
    });
    quill.insertText(0, "Hi", { bold: true }, "user");
    expect(text.toDelta()).toEqual([
      { insert: "Hi", attributes: { bold: true } },
    ]);
    expect(edits).toBe(1);
    expect(transactions).toBe(1);
  });

  it("чужая правка Y.Text сразу видна в поле и не наследует соседний формат", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "bold", { bold: true });
    const quill = mountQuill();
    bindQuill(quill, text);
    expect(quill.getContents().ops[0]).toEqual({
      insert: "bold",
      attributes: { bold: true },
    });
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    other.getText("t").insert(4, "!", { bold: null });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, Y.encodeStateVector(doc)));
    expect(quill.getText()).toBe("bold!\n");
    expect(quill.getFormat(4, 1)).toEqual({});
  });

  it("два участника пишут в один текст одновременно — оба фрагмента у обоих", () => {
    const a = new Y.Doc();
    a.getText("t").insert(0, "middle");
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const quillA = mountQuill();
    const quillB = mountQuill();
    bindQuill(quillA, a.getText("t"));
    bindQuill(quillB, b.getText("t"));
    // Правки сделаны без связи друг с другом, затем обмен обновлениями.
    quillA.insertText(6, "XX", "user");
    quillB.insertText(0, "YY", "user");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    expect(a.getText("t").toJSON()).toBe("YYmiddleXX");
    expect(quillA.getText()).toBe("YYmiddleXX\n");
    expect(quillB.getText()).toBe("YYmiddleXX\n");
  });

  it("BUG-014: правка поля, которую Quill описал заменой всего текста, пишется в Y.Text минимально", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    text.insert(0, "base");
    const quill = mountQuill();
    bindQuill(quill, text);
    let deleted = 0;
    text.observe((event) => {
      for (const op of event.delta) deleted += op.delete ?? 0;
    });
    // Так Quill описывает первый символ, если считает выделенным весь текст.
    quill.updateContents(new Delta().insert("base ").delete(4), "user");
    expect(text.toJSON()).toBe("base ");
    expect(deleted).toBe(0);
  });

  it("CVS-07 BUG-014: отмена своей правки после правки другого участника убирает только свою", () => {
    const owner = new Y.Doc();
    owner.getText("t").insert(0, "base");
    const guest = new Y.Doc();
    Y.applyUpdate(guest, Y.encodeStateAsUpdate(owner));
    const sync = (from: Y.Doc, to: Y.Doc) => {
      Y.applyUpdate(
        to,
        Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)),
        "remote",
      );
    };
    // Отмена владельца — только его транзакции (origin `null`), как у доски.
    const undo = new Y.UndoManager(owner.getText("t"));
    const ownerQuill = mountQuill();
    const unbindOwner = bindQuill(ownerQuill, owner.getText("t"));
    ownerQuill.updateContents(new Delta().insert("base mine").delete(4), "user");
    unbindOwner();
    sync(owner, guest);
    const guestQuill = mountQuill();
    const unbindGuest = bindQuill(guestQuill, guest.getText("t"));
    guestQuill.updateContents(
      new Delta().insert("theirs base mine").delete(9),
      "user",
    );
    unbindGuest();
    sync(guest, owner);
    expect(owner.getText("t").toJSON()).toBe("theirs base mine");
    undo.undo();
    sync(owner, guest);
    expect(owner.getText("t").toJSON()).toBe("theirs base");
    expect(guest.getText("t").toJSON()).toBe("theirs base");
  });

  it("после отписки поле и Y.Text больше не связаны", () => {
    const doc = new Y.Doc();
    const text = doc.getText("t");
    const quill = mountQuill();
    const unbind = bindQuill(quill, text);
    unbind();
    quill.insertText(0, "local", "user");
    text.insert(0, "remote");
    expect(text.toJSON()).toBe("remote");
    expect(quill.getText()).toBe("local\n");
  });
});
