import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  addRecentColor,
  colorCategory,
  loadRecentColors,
  RECENT_COLORS_KEY,
  RECENT_LIMIT,
  useRecentColors,
} from "./recentColors";

afterEach(() => {
  localStorage.clear();
});

describe("SHP-04: недавние свои цвета — отдельно по категориям", () => {
  it("цвет, выбранный у стикера, есть только в списке стикера", () => {
    const { result } = renderHook(() => useRecentColors());
    act(() => {
      result.current.remember(["sticky"], "#123ABC");
    });
    expect(result.current.recent).toEqual({
      text: [],
      sticky: ["#123abc"],
      shape: [],
      line: [],
      drawing: [],
    });
  });

  it("списки переживают закрытие вкладки (хранилище браузера)", () => {
    const first = renderHook(() => useRecentColors());
    act(() => {
      first.result.current.remember(["shape"], "#00ff00");
      first.result.current.remember(["text"], "#0000ff");
    });
    first.unmount();
    const second = renderHook(() => useRecentColors());
    expect(second.result.current.recent.shape).toEqual(["#00ff00"]);
    expect(second.result.current.recent.text).toEqual(["#0000ff"]);
    expect(second.result.current.recent.line).toEqual([]);
  });

  it("последний — первым, повтор поднимается наверх, не больше предела", () => {
    let recent = loadRecentColors();
    for (let i = 0; i < RECENT_LIMIT + 2; i += 1) {
      recent = addRecentColor(
        recent,
        ["line"],
        `#0000${i.toString(16).padStart(2, "0")}`,
      );
    }
    recent = addRecentColor(recent, ["line"], "#000005");
    expect(recent.line).toHaveLength(RECENT_LIMIT);
    expect(recent.line[0]).toBe("#000005");
    expect(recent.line.filter((c) => c === "#000005")).toHaveLength(1);
    expect(recent.line).not.toContain("#000000");
  });

  it("не цвет и испорченная запись хранилища — пустые списки", () => {
    expect(addRecentColor(loadRecentColors(), ["text"], "red").text).toEqual(
      [],
    );
    localStorage.setItem(RECENT_COLORS_KEY, "{oops");
    expect(loadRecentColors().sticky).toEqual([]);
    localStorage.setItem(
      RECENT_COLORS_KEY,
      JSON.stringify({ sticky: ["#ABCDEF", 5, "nope"], line: "x" }),
    );
    expect(loadRecentColors()).toEqual({
      text: [],
      sticky: ["#abcdef"],
      shape: [],
      line: [],
      drawing: [],
    });
  });

  it("категория — по типу объекта: текст и документ, стикер и стопка, фигура, линия", () => {
    expect(
      ["text", "document", "sticky", "stack", "shape", "line", "group"].map(
        colorCategory,
      ),
    ).toEqual(["text", "text", "sticky", "sticky", "shape", "line", null]);
  });
});
