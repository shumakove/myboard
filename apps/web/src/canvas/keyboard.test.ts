import { describe, expect, it } from "vitest";
import { HOME, ZOOM_STEP } from "./camera";
import { ARROW_STEP, cameraKeyAction, isTypingTarget } from "./keyboard";

const key = (name: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key: name,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...modifiers,
});

function apply(name: string, modifiers?: Partial<KeyboardEvent>) {
  return cameraKeyAction(key(name, modifiers))?.(HOME) ?? null;
}

describe("CVS-02: клавиши камеры", () => {
  it("«+» и «−» приближают и отдаляют вид", () => {
    expect(apply("+")?.zoom).toBe(ZOOM_STEP);
    expect(apply("=")?.zoom).toBe(ZOOM_STEP);
    expect(apply("-")?.zoom).toBe(1 / ZOOM_STEP);
  });

  it("стрелки двигают вид в свою сторону", () => {
    expect(apply("ArrowRight")).toEqual({ x: ARROW_STEP, y: 0, zoom: 1 });
    expect(apply("ArrowLeft")).toEqual({ x: -ARROW_STEP, y: 0, zoom: 1 });
    expect(apply("ArrowDown")).toEqual({ x: 0, y: ARROW_STEP, zoom: 1 });
    expect(apply("ArrowUp")).toEqual({ x: 0, y: -ARROW_STEP, zoom: 1 });
  });

  it("сочетания с Ctrl/⌘/Alt и прочие клавиши остаются браузеру", () => {
    expect(apply("+", { ctrlKey: true })).toBeNull();
    expect(apply("-", { metaKey: true })).toBeNull();
    expect(apply("ArrowLeft", { altKey: true })).toBeNull();
    expect(apply("a")).toBeNull();
  });

  it("поля ввода свои клавиши не отдают", () => {
    expect(isTypingTarget(document.createElement("input"))).toBe(true);
    expect(isTypingTarget(document.createElement("textarea"))).toBe(true);
    expect(isTypingTarget(document.createElement("select"))).toBe(true);
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });
});
