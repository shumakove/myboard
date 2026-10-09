import { describe, expect, it } from "vitest";
import { historyKey, toolKey } from "./keymap";

const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({
  code,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("CVS-25 горячие клавиши сцены", () => {
  it("клавиши основных инструментов выбирают инструмент", () => {
    expect(toolKey(key("KeyV"))).toBe("select");
    expect(toolKey(key("KeyL"))).toBe("lasso");
    expect(toolKey(key("KeyN"))).toBe("sticky");
    expect(toolKey(key("KeyS"))).toBe("shape");
    expect(toolKey(key("KeyT"))).toBe("text");
  });

  it("с модификатором клавиша инструмента не срабатывает", () => {
    expect(toolKey(key("KeyV", { ctrlKey: true }))).toBeNull();
    expect(toolKey(key("KeyS", { metaKey: true }))).toBeNull();
    expect(toolKey(key("KeyT", { shiftKey: true }))).toBeNull();
    expect(toolKey(key("KeyQ"))).toBeNull();
  });

  it("CVS-07: Ctrl/⌘+Z отменяет, Ctrl/⌘+Shift+Z и Ctrl+Y повторяют", () => {
    expect(historyKey(key("KeyZ", { ctrlKey: true }))).toBe("undo");
    expect(historyKey(key("KeyZ", { metaKey: true }))).toBe("undo");
    expect(historyKey(key("KeyZ", { ctrlKey: true, shiftKey: true }))).toBe(
      "redo",
    );
    expect(historyKey(key("KeyZ", { metaKey: true, shiftKey: true }))).toBe(
      "redo",
    );
    expect(historyKey(key("KeyY", { ctrlKey: true }))).toBe("redo");
    expect(historyKey(key("KeyZ"))).toBeNull();
    expect(historyKey(key("KeyZ", { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
