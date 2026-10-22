import { afterEach, describe, expect, it } from "vitest";
import {
  brushWidth,
  DEFAULT_DRAW_SETTINGS,
  DRAW_SETTINGS_KEY,
  loadDrawSettings,
  setPresetWidth,
} from "./drawSettings";

afterEach(() => {
  localStorage.clear();
});

describe("DRW-02: три пресета толщины пера", () => {
  it("по умолчанию у пера три разных пресета, выбран средний", () => {
    const { pen } = loadDrawSettings();
    expect(pen.presets).toHaveLength(3);
    expect(new Set(pen.presets).size).toBe(3);
    expect(brushWidth(pen)).toBe(pen.presets[1]);
  });

  it("новое значение меняет только выбранный пресет", () => {
    const pen = { ...DEFAULT_DRAW_SETTINGS.pen, preset: 2 };
    const changed = setPresetWidth(pen, 32);
    expect(changed.presets).toEqual([pen.presets[0], pen.presets[1], 32]);
    expect(brushWidth(changed)).toBe(32);
  });

  it("сохранённые пресеты, цвет и режим стилуса читаются; испорченные поля — по умолчанию", () => {
    localStorage.setItem(
      DRAW_SETTINGS_KEY,
      JSON.stringify({
        pen: { color: "#AA0000", presets: [1, 3, 16], preset: 2 },
        marker: { color: "red", presets: [5, 5], preset: 7 },
        stylusDraws: true,
      }),
    );
    expect(loadDrawSettings()).toEqual({
      pen: { color: "#aa0000", presets: [1, 3, 16], preset: 2 },
      marker: DEFAULT_DRAW_SETTINGS.marker,
      stylusDraws: true,
    });
    localStorage.setItem(DRAW_SETTINGS_KEY, "{oops");
    expect(loadDrawSettings()).toEqual(DEFAULT_DRAW_SETTINGS);
  });
});
