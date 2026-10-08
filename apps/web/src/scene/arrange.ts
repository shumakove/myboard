import type { Rect } from "../canvas/camera";
import type { Point } from "../realtime/messages";

/** CVS-15: выравнивание по краю или центру общей рамки выделения. */
export type AlignOp = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type Axis = "x" | "y";

/** Объект для выравнивания: id и описанный прямоугольник по осям. */
export interface Placed {
  id: string;
  bounds: Rect;
}

type Deltas = Map<string, Point>;

const SIZE = { x: "width", y: "height" } as const;

function span(items: readonly Placed[], axis: Axis): [number, number] {
  const starts = items.map((o) => o.bounds[axis]);
  const ends = items.map((o) => o.bounds[axis] + o.bounds[SIZE[axis]]);
  return [Math.min(...starts), Math.max(...ends)];
}

/** CVS-15: сдвиги, выравнивающие объекты по краю или центру их общей рамки. */
export function alignDeltas(items: readonly Placed[], op: AlignOp): Deltas {
  const axis: Axis =
    op === "left" || op === "center" || op === "right" ? "x" : "y";
  const [start, end] = span(items, axis);
  const deltas: Deltas = new Map();
  for (const { id, bounds } of items) {
    const size = bounds[SIZE[axis]];
    const target =
      op === "left" || op === "top"
        ? start
        : op === "right" || op === "bottom"
          ? end - size
          : (start + end) / 2 - size / 2;
    const shift = target - bounds[axis];
    deltas.set(id, axis === "x" ? { x: shift, y: 0 } : { x: 0, y: shift });
  }
  return deltas;
}

/**
 * CVS-15: объекты по порядку вдоль оси с равным промежутком `gap`; первый остаётся на месте.
 */
export function spacingDeltas(
  items: readonly Placed[],
  axis: Axis,
  gap: number,
): Deltas {
  const ordered = [...items].sort(
    (a, b) => a.bounds[axis] - b.bounds[axis] || (a.id < b.id ? -1 : 1),
  );
  const deltas: Deltas = new Map();
  let next = ordered[0]?.bounds[axis] ?? 0;
  for (const { id, bounds } of ordered) {
    const shift = next - bounds[axis];
    deltas.set(id, axis === "x" ? { x: shift, y: 0 } : { x: 0, y: shift });
    next += bounds[SIZE[axis]] + gap;
  }
  return deltas;
}

/** Промежуток, при котором объекты заполняют длину `length` вдоль оси. */
export function gapFor(
  items: readonly Placed[],
  axis: Axis,
  length: number,
): number {
  const sizes = items.reduce((sum, o) => sum + o.bounds[SIZE[axis]], 0);
  return items.length > 1 ? (length - sizes) / (items.length - 1) : 0;
}

/**
 * CVS-15: распределение с равным промежутком: крайние объекты на месте, остальные
 * встают между ними.
 */
export function distributeDeltas(items: readonly Placed[], axis: Axis): Deltas {
  const [start, end] = span(items, axis);
  return spacingDeltas(items, axis, gapFor(items, axis, end - start));
}
