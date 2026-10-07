import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WHEEL_MODE,
  loadWheelMode,
  saveWheelMode,
  wheelAction,
} from "./wheel";

const plain = {
  deltaX: 0,
  deltaY: 100,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
};

describe("CVS-03: поведение колеса", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("режим «масштаб»: каждое вращение меняет масштаб, вниз — отдаляет", () => {
    const down = wheelAction(plain, "zoom");
    expect(down.kind).toBe("zoom");
    expect(down.kind === "zoom" && down.factor < 1).toBe(true);
    const up = wheelAction({ ...plain, deltaY: -100 }, "zoom");
    expect(up.kind === "zoom" && up.factor > 1).toBe(true);
  });

  it("режим «прокрутка»: колесо двигает вид, с Ctrl или ⌘ — масштаб", () => {
    expect(wheelAction({ ...plain, deltaX: 30 }, "scroll")).toEqual({
      kind: "pan",
      dx: -30,
      dy: -100,
    });
    expect(wheelAction({ ...plain, ctrlKey: true }, "scroll").kind).toBe(
      "zoom",
    );
    expect(wheelAction({ ...plain, metaKey: true }, "scroll").kind).toBe(
      "zoom",
    );
  });

  it("режим «прокрутка»: Shift — по горизонтали; строки пересчитываются в пиксели", () => {
    expect(wheelAction({ ...plain, shiftKey: true }, "scroll")).toEqual({
      kind: "pan",
      dx: -100,
      dy: 0,
    });
    expect(
      wheelAction({ ...plain, deltaY: 3, deltaMode: 1 }, "scroll"),
    ).toEqual({ kind: "pan", dx: -0, dy: -48 });
  });

  it("выбор режима запоминается в браузере; мусор в хранилище — режим по умолчанию", () => {
    expect(loadWheelMode()).toBe(DEFAULT_WHEEL_MODE);
    saveWheelMode("scroll");
    expect(loadWheelMode()).toBe("scroll");
    localStorage.setItem("myboard.wheelMode", "sideways");
    expect(loadWheelMode()).toBe(DEFAULT_WHEEL_MODE);
  });
});
