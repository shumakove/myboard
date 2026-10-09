import { afterEach, describe, expect, it } from "vitest";
import {
  allTools,
  DEFAULT_PINNED,
  loadPinned,
  movePinned,
  PINNED_TOOLS_KEY,
  savePinned,
  togglePin,
} from "./pinnedTools";

afterEach(() => {
  localStorage.clear();
});

describe("CVS-24 закреплённые инструменты", () => {
  it("по умолчанию закреплены инструменты T5.4; документ — только в полном списке", () => {
    expect(loadPinned()).toEqual([
      "select",
      "lasso",
      "sticky",
      "shape",
      "text",
    ]);
    expect(allTools(DEFAULT_PINNED)).toEqual([...DEFAULT_PINNED, "document"]);
  });

  it("набор и порядок сохраняются в браузере", () => {
    savePinned(["text", "select"]);
    expect(loadPinned()).toEqual(["text", "select"]);
  });

  it("пустой набор тоже сохраняется", () => {
    savePinned([]);
    expect(loadPinned()).toEqual([]);
  });

  it("испорченная запись — набор по умолчанию, неизвестные и повторы — мимо", () => {
    localStorage.setItem(PINNED_TOOLS_KEY, "{oops");
    expect(loadPinned()).toEqual([...DEFAULT_PINNED]);
    localStorage.setItem(PINNED_TOOLS_KEY, '{"a":1}');
    expect(loadPinned()).toEqual([...DEFAULT_PINNED]);
    localStorage.setItem(
      PINNED_TOOLS_KEY,
      JSON.stringify(["shape", "laser", "shape", 7, "select"]),
    );
    expect(loadPinned()).toEqual(["shape", "select"]);
  });

  it("закрепление ставит инструмент в конец, повторное — открепляет", () => {
    expect(togglePin(["select"], "text")).toEqual(["select", "text"]);
    expect(togglePin(["select", "text"], "select")).toEqual(["text"]);
  });

  it("порядок меняется сдвигом; за краем — без изменений", () => {
    const pinned = ["select", "lasso", "text"] as const;
    expect(movePinned(pinned, "text", -1)).toEqual(["select", "text", "lasso"]);
    expect(movePinned(pinned, "select", 1)).toEqual([
      "lasso",
      "select",
      "text",
    ]);
    expect(movePinned(pinned, "select", -1)).toEqual([...pinned]);
    expect(movePinned(pinned, "text", 1)).toEqual([...pinned]);
    expect(movePinned(pinned, "shape", 1)).toEqual([...pinned]);
  });

  it("полный список: закреплённые в своём порядке, затем остальные", () => {
    expect(allTools(["text", "select"])).toEqual([
      "text",
      "select",
      "lasso",
      "sticky",
      "shape",
      "document",
    ]);
  });
});
