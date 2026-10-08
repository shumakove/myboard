import { describe, expect, it } from "vitest";
import { guidesFor, snapToNeighbors } from "./guides";

const neighbor = { x: 300, y: 100, width: 100, height: 60 };

describe("CVS-16: направляющие к соседям", () => {
  it("край или центр прилипает к ближайшей линии соседа в пределах расстояния", () => {
    const moving = { x: 0, y: 96, width: 50, height: 50 };
    // Верх 96 → верх соседа 100.
    expect(snapToNeighbors(moving, [neighbor], "y", 6)).toBe(4);
    // Линии 150, 175, 200 — ближайшая линия соседа (160) дальше 6.
    expect(
      snapToNeighbors({ ...moving, y: 150 }, [neighbor], "y", 6),
    ).toBeNull();
    // Правый край 347 → центр соседа 350.
    expect(snapToNeighbors({ ...moving, x: 297 }, [neighbor], "x", 6)).toBe(3);
  });

  it("направляющая проходит через совпавшую линию и тянется от объекта до соседа", () => {
    const guides = guidesFor({ x: 0, y: 100, width: 50, height: 20 }, [
      neighbor,
    ]);
    expect(guides).toEqual([{ axis: "y", value: 100, from: 0, to: 400 }]);
    expect(
      guidesFor({ x: 0, y: 0, width: 10, height: 10 }, [neighbor]),
    ).toEqual([]);
  });
});
