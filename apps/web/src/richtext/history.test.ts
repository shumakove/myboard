import { describe, expect, it } from "vitest";
import { mountQuill, typeInto } from "./testQuill";

describe("CVS-25: отмена в поле текста", () => {
  it("Ctrl+Z после стёртой буквы возвращает её, а не стирает весь набранный текст", () => {
    const quill = mountQuill();
    quill.setSelection(0, 0, "silent");
    typeInto(quill, "vlnst");
    quill.deleteText(4, 1, "user");
    expect(quill.getText()).toBe("vlns\n");
    quill.history.undo();
    expect(quill.getText()).toBe("vlnst\n");
    quill.history.undo();
    expect(quill.getText()).toBe("\n");
  });
});
