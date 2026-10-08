import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { applyTextChange, shiftIndex } from "./textBinding";

describe("поле ввода ↔ Y.Text", () => {
  it("правка поля меняет только изменённую середину текста", () => {
    const text = new Y.Doc().getText("t");
    text.insert(0, "hello world");
    const ops: unknown[] = [];
    text.observe((event) => {
      ops.push(...event.delta);
    });
    applyTextChange(text, "hello world", "hello brave world");
    expect(text.toJSON()).toBe("hello brave world");
    expect(ops).toEqual([{ retain: 6 }, { insert: "brave " }]);

    applyTextChange(text, "hello brave world", "hello world!");
    expect(text.toJSON()).toBe("hello world!");
  });

  it("курсор сдвигается чужой вставкой и удалением перед ним", () => {
    expect(shiftIndex(5, [{ insert: "ab" }])).toBe(7);
    expect(shiftIndex(5, [{ retain: 6 }, { insert: "ab" }])).toBe(5);
    expect(shiftIndex(5, [{ retain: 1 }, { delete: 2 }])).toBe(3);
    expect(shiftIndex(2, [{ retain: 1 }, { delete: 5 }])).toBe(1);
  });
});
