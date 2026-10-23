import { MARKER_OPACITY, strokePath } from "./drawingShape";
import type { InkDraft } from "./drawGestures";
import type { SceneObject } from "./sceneObjects";

/**
 * Рисунок на холсте (DRW-01, DRW-06): штрих SVG в рамке объекта, точки растянуты под её
 * размер, толщина — свойство штриха. Нажатия ловит полоса вдоль штриха, а не рамка.
 */
export function DrawingView({ object }: { object: SceneObject }) {
  const drawing = object.drawing;
  if (drawing === null) return null;
  const width = numberOr(object.style.strokeWidth, 4);
  const d = strokePath(drawing.points);
  return (
    <svg
      className="drawing-svg"
      aria-hidden="true"
      width={Math.max(object.width, 1)}
      height={Math.max(object.height, 1)}
    >
      <path
        className="drawing-hit"
        d={d}
        strokeWidth={Math.max(16, width + 12)}
      />
      <path
        className="drawing-stroke"
        data-testid="drawing-stroke"
        data-brush={drawing.brush}
        d={d}
        stroke={String(object.style.stroke ?? "#1f2937")}
        strokeWidth={width}
        strokeOpacity={drawing.brush === "marker" ? MARKER_OPACITY : undefined}
      />
    </svg>
  );
}

/** Штрих, который рисуют сейчас, — в координатах доски поверх объектов. */
export function InkOverlay({ ink }: { ink: InkDraft | null }) {
  if (ink === null) return null;
  return (
    <svg className="ink-overlay" aria-hidden="true" data-testid="ink-draft">
      <path
        className="drawing-stroke"
        d={strokePath(ink.points)}
        stroke={ink.color}
        strokeWidth={ink.width}
        strokeOpacity={ink.brush === "marker" ? MARKER_OPACITY : undefined}
      />
    </svg>
  );
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
