import { describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { linkedDocs } from "./testDocs";
import {
  DEFAULT_SETTINGS,
  isDark,
  readSettings,
  updateSettings,
} from "./boardSettings";

describe("CVS-06: фон и шаг сетки доски", () => {
  it("по умолчанию — светлый фон и сетка; испорченные значения не принимаются", () => {
    const { settings } = createBoardDocument();
    expect(readSettings(settings)).toEqual(DEFAULT_SETTINGS);
    settings.set("background", "url(evil)");
    settings.set("gridStep", -5);
    expect(readSettings(settings)).toEqual(DEFAULT_SETTINGS);
  });

  it("смена видна другому участнику: настройки лежат в документе доски", () => {
    const [a, b] = linkedDocs();
    updateSettings(createBoardDocument(a).settings, {
      background: "#263238",
      gridStep: 0,
    });
    expect(readSettings(createBoardDocument(b).settings)).toEqual({
      background: "#263238",
      gridStep: 0,
    });
  });

  it("тёмный фон распознаётся для цвета точек сетки", () => {
    expect(isDark("#263238")).toBe(true);
    expect(isDark("#fafafa")).toBe(false);
  });
});
