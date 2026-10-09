import { afterEach, describe, expect, it } from "vitest";
import type { DeltaOp } from "./delta";
import type { Quill } from "./quill";
import { applyShortcut } from "./shortcuts";
import { mountQuill, typeInto } from "./testQuill";

afterEach(() => {
  document.body.innerHTML = "";
});

/** Редактор с быстрой разметкой, как в RichTextEditor. */
function editor(): Quill {
  const quill = mountQuill();
  quill.on("text-change", (delta: { ops: DeltaOp[] }, _old, source) => {
    if (source === "user") applyShortcut(quill, delta.ops);
  });
  quill.setSelection(0, 0, "silent");
  return quill;
}

describe("TXT-03: быстрая разметка", () => {
  it.each([
    ["# ", { header: 1 }],
    ["## ", { header: 2 }],
    ["### ", { header: 3 }],
    ["- ", { list: "bullet" }],
    ["* ", { list: "bullet" }],
    ["1. ", { list: "ordered" }],
    ["[] ", { list: "unchecked" }],
    ["[x] ", { list: "checked" }],
  ])(
    "«%s» в начале строки задаёт формат строки и исчезает",
    (prefix, format) => {
      const quill = editor();
      typeInto(quill, `${prefix}Item`);
      expect(quill.getText()).toBe("Item\n");
      expect(quill.getFormat(0, 1)).toEqual(format);
    },
  );

  it("второй строкой тоже работает; не в начале строки — обычный текст", () => {
    const quill = editor();
    typeInto(quill, "a # b\n- c");
    expect(quill.getText()).toBe("a # b\nc\n");
    expect(quill.getFormat(0, 1)).toEqual({});
    expect(quill.getFormat(6, 1)).toEqual({ list: "bullet" });
  });

  it("два дефиса подряд в тексте — длинное тире", () => {
    const quill = editor();
    typeInto(quill, "A--B");
    expect(quill.getText()).toBe("A—B\n");
  });
});
