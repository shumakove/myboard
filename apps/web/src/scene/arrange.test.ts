import { describe, expect, it } from "vitest";
import {
  alignDeltas,
  distributeDeltas,
  spacingDeltas,
  type Placed,
} from "./arrange";

const items: Placed[] = [
  { id: "a", bounds: { x: 0, y: 10, width: 100, height: 50 } },
  { id: "b", bounds: { x: 130, y: 40, width: 40, height: 100 } },
  { id: "c", bounds: { x: 400, y: 0, width: 100, height: 20 } },
];

function moved(deltas: Map<string, { x: number; y: number }>) {
  return items.map(({ id, bounds }) => {
    const d = deltas.get(id) ?? { x: 0, y: 0 };
    return { ...bounds, x: bounds.x + d.x, y: bounds.y + d.y };
  });
}

describe("CVS-15: выравнивание и распределение", () => {
  it("выравнивает по краям и по центру общей рамки", () => {
    expect(moved(alignDeltas(items, "left")).map((r) => r.x)).toEqual([
      0, 0, 0,
    ]);
    expect(
      moved(alignDeltas(items, "right")).map((r) => r.x + r.width),
    ).toEqual([500, 500, 500]);
    expect(moved(alignDeltas(items, "top")).map((r) => r.y)).toEqual([0, 0, 0]);
    expect(
      moved(alignDeltas(items, "bottom")).map((r) => r.y + r.height),
    ).toEqual([140, 140, 140]);
    expect(
      moved(alignDeltas(items, "center")).map((r) => r.x + r.width / 2),
    ).toEqual([250, 250, 250]);
    expect(
      moved(alignDeltas(items, "middle")).map((r) => r.y + r.height / 2),
    ).toEqual([70, 70, 70]);
    // Выравнивание по горизонтали не трогает вертикаль.
    expect(moved(alignDeltas(items, "left")).map((r) => r.y)).toEqual([
      10, 40, 0,
    ]);
  });

  it("распределение даёт равные промежутки, крайние объекты на месте", () => {
    const rects = moved(distributeDeltas(items, "x"));
    expect(rects[0]?.x).toBe(0);
    expect(rects[2]?.x).toBe(400);
    const gaps = [(rects[1]?.x ?? 0) - 100, 400 - ((rects[1]?.x ?? 0) + 40)];
    expect(gaps[0]).toBeCloseTo(gaps[1] ?? NaN);
    expect(gaps[0]).toBeCloseTo(130);
  });

  it("распределение по вертикали упорядочивает объекты по положению", () => {
    const rects = moved(distributeDeltas(items, "y"));
    // Порядок сверху вниз: c (0..20), a (10..60), b (40..140); общая высота 140.
    const [a, b, c] = rects;
    expect(c?.y).toBe(0);
    expect(b?.y).toBe(40);
    expect((a?.y ?? 0) - 20).toBeCloseTo(40 - ((a?.y ?? 0) + 50));
  });

  it("промежуток задаётся явно: первый на месте, остальные через равный шаг", () => {
    const rects = moved(spacingDeltas(items, "x", 10));
    expect(rects.map((r) => r.x)).toEqual([0, 110, 160]);
  });
});
