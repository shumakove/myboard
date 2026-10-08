import type { Rect } from "../canvas/camera";
import type { Axis } from "./arrange";

/**
 * CVS-16: направляющая выравнивания. `axis: "x"` — вертикальная линия `x = value`
 * от `from` до `to` по y; `axis: "y"` — горизонтальная.
 */
export interface Guide {
  axis: Axis;
  value: number;
  from: number;
  to: number;
}

/** Расстояние прилипания к соседу, экранные px. */
export const GUIDE_SNAP_PX = 6;
/** Линии считаются совпавшими при расхождении меньше этого, единицы доски. */
const EPSILON = 0.5;

/** Края и центр прямоугольника вдоль оси. */
function lines(rect: Rect, axis: Axis): number[] {
  const start = rect[axis];
  const size = axis === "x" ? rect.width : rect.height;
  return [start, start + size / 2, start + size];
}

/**
 * CVS-16: поправка вдоль оси, чтобы край или центр `moving` совпал с краем или центром
 * ближайшего соседа не дальше `threshold`. `null` — совпадать не с чем.
 */
export function snapToNeighbors(
  moving: Rect,
  neighbors: readonly Rect[],
  axis: Axis,
  threshold: number,
): number | null {
  let best: number | null = null;
  for (const neighbor of neighbors) {
    for (const target of lines(neighbor, axis)) {
      for (const line of lines(moving, axis)) {
        const shift = target - line;
        if (
          Math.abs(shift) <= threshold &&
          (best === null || Math.abs(shift) < Math.abs(best))
        ) {
          best = shift;
        }
      }
    }
  }
  return best;
}

/** CVS-16: направляющие для всех совпавших линий `moving` и соседей. */
export function guidesFor(moving: Rect, neighbors: readonly Rect[]): Guide[] {
  const guides: Guide[] = [];
  for (const axis of ["x", "y"] as const) {
    const cross: Axis = axis === "x" ? "y" : "x";
    const crossSize = cross === "x" ? "width" : "height";
    for (const line of lines(moving, axis)) {
      const matched = neighbors.filter((n) =>
        lines(n, axis).some((l) => Math.abs(l - line) < EPSILON),
      );
      if (matched.length === 0) continue;
      const all = [moving, ...matched];
      guides.push({
        axis,
        value: line,
        from: Math.min(...all.map((r) => r[cross])),
        to: Math.max(...all.map((r) => r[cross] + r[crossSize])),
      });
    }
  }
  return guides;
}
