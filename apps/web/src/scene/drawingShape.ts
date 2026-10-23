import type { Point } from "../realtime/messages";
import { center, rotateVector } from "./geometry";
import type { SceneObject } from "./sceneObjects";

/**
 * Рисунок — свободный штрих пера или маркера (DRW-01). В документе — объект типа
 * `drawing`: рамка `x`, `y`, `width`, `height`, точки `points` — плоский массив
 * `[x0, y0, x1, y1, …]` относительно рамки в размере `baseWidth` × `baseHeight`, каким
 * штрих нарисован. Изменение размера рамки растягивает точки (DRW-06); толщина линии
 * при этом не меняется.
 */

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export type Brush = "pen" | "marker";

export const BRUSHES: readonly Brush[] = ["pen", "marker"];

/** DRW-01: маркер — полупрозрачный, сквозь него видно нарисованное под ним. */
export const MARKER_OPACITY = 0.5;

/** Штрих рисунка на сцене: точки — в координатах его рамки, уже растянутые под размер. */
export interface DrawingShape {
  brush: Brush;
  points: Point[];
}

/** Поля рисунка из записи документа; `null` — точек нет или они испорчены. */
export function readDrawing(
  record: Record<string, unknown>,
  width: number,
  height: number,
): DrawingShape | null {
  const { points, baseWidth, baseHeight, brush } = record;
  if (!Array.isArray(points) || points.length < 2 || points.length % 2 !== 0) {
    return null;
  }
  if (!points.every(isNumber)) return null;
  const sx = isNumber(baseWidth) && baseWidth > 0 ? width / baseWidth : 1;
  const sy = isNumber(baseHeight) && baseHeight > 0 ? height / baseHeight : 1;
  const scaled: Point[] = [];
  for (let i = 0; i < points.length; i += 2) {
    scaled.push({
      x: (points[i] as number) * sx,
      y: (points[i + 1] as number) * sy,
    });
  }
  return { brush: brush === "marker" ? "marker" : "pen", points: scaled };
}

/** Рамка штриха на доске, его точки и толщина. */
type PlacedStroke = Pick<
  SceneObject,
  "x" | "y" | "width" | "height" | "rotation" | "drawing" | "style"
>;

/** Точка доски в координатах рамки штриха (с учётом его поворота вокруг центра). */
function toLocal(stroke: PlacedStroke, p: Point): Point {
  const c = center(stroke);
  const v = rotateVector({ x: p.x - c.x, y: p.y - c.y }, -stroke.rotation);
  return { x: c.x + v.x - stroke.x, y: c.y + v.y - stroke.y };
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length),
        );
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** DRW-03: ластик радиусом `radius` в точке `p` доски задевает штрих. */
export function touchesStroke(
  stroke: PlacedStroke,
  p: Point,
  radius: number,
): boolean {
  const points = stroke.drawing?.points ?? [];
  const local = toLocal(stroke, p);
  const width = stroke.style.strokeWidth;
  const reach = radius + (typeof width === "number" ? width / 2 : 0);
  for (let i = 0; i < points.length; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] ?? a;
    if (segmentDistance(local, a, b) <= reach) return true;
  }
  return false;
}

/** DRW-04: с Shift штрих — прямой отрезок от начала до указателя. */
export function straightStroke(start: Point, end: Point): Point[] {
  return [start, end];
}

/** Путь SVG по точкам; одна точка — отрезок нулевой длины (с круглым концом это точка). */
export function strokePath(points: readonly Point[]): string {
  const [first, ...rest] = points;
  if (first === undefined) return "";
  const tail = rest.length > 0 ? rest : [first];
  return `M${String(first.x)} ${String(first.y)}${tail
    .map((p) => ` L${String(p.x)} ${String(p.y)}`)
    .join("")}`;
}
