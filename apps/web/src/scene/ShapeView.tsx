import { shapeIcons, type IconPart } from "./bpmnMarkers";
import { shapeParts } from "./shapeGeometry";
import { shapeKind, shapeMarker, type ShapeKind } from "./shapes";
import { textBoxStyle } from "./shapeText";
import type { SceneObject } from "./sceneObjects";

/** Цвета и толщина контура фигуры. */
export interface ShapePaint {
  fill: string;
  stroke: string;
  width: number;
}

/** Цвета и толщина контура фигуры: записанные или значения по умолчанию. */
function paintOf(object: SceneObject): ShapePaint {
  const { fill, stroke, strokeWidth } = object.style;
  return {
    fill: typeof fill === "string" ? fill : "#ffffff",
    stroke: typeof stroke === "string" ? stroke : "#1f2937",
    width: typeof strokeWidth === "number" ? Math.max(strokeWidth, 0) : 2,
  };
}

/**
 * Фигура на холсте (SHP-01…SHP-03): контур SVG с заливкой, обводкой и скруглением,
 * значки маркера BPMN и текст в области текста вида фигуры.
 */
export function ShapeView({
  object,
  editing,
}: {
  object: SceneObject;
  /** Текст правят в поле поверх фигуры — свой текст фигура не показывает. */
  editing: boolean;
}) {
  const kind = shapeKind(object.style.shape);
  const { width: w, height: h } = object;
  return (
    <>
      <svg
        className="shape-svg"
        data-testid="shape-outline"
        aria-hidden="true"
        width={w}
        height={h}
        viewBox={`0 0 ${String(w)} ${String(h)}`}
      >
        <ShapeGraphic
          kind={kind}
          marker={shapeMarker(kind, object.style.marker)}
          width={w}
          height={h}
          radius={
            typeof object.style.radius === "number" ? object.style.radius : 0
          }
          paint={paintOf(object)}
        />
      </svg>
      {!editing && (
        <div className="shape-text" style={textBoxStyle(kind, w, h)}>
          {object.text}
        </div>
      )}
    </>
  );
}

/** Образец вида фигуры для панели наборов: контур и маркер по умолчанию. */
export function ShapePreview({ kind }: { kind: ShapeKind }) {
  const { width: w, height: h } = kind;
  const pad = Math.max(w, h) * 0.04;
  return (
    <svg
      aria-hidden="true"
      viewBox={`${String(-pad)} ${String(-pad)} ${String(w + 2 * pad)} ${String(h + 2 * pad)}`}
    >
      <ShapeGraphic
        kind={kind}
        marker={shapeMarker(kind, undefined)}
        width={w}
        height={h}
        radius={Number(kind.style?.radius ?? 0)}
        paint={{
          fill: kind.style?.fill === "transparent" ? "transparent" : "#ffffff",
          stroke: "currentColor",
          width: Math.max(w, h) / 20,
        }}
      />
    </svg>
  );
}

function ShapeGraphic({
  kind,
  marker,
  width: w,
  height: h,
  radius,
  paint,
}: {
  kind: ShapeKind;
  marker: string | null;
  width: number;
  height: number;
  radius: number;
  paint: ShapePaint;
}) {
  const paper = paint.fill === "transparent" ? "#ffffff" : paint.fill;
  const tone = (value: IconPart["fill"]) =>
    value === "ink" ? paint.stroke : value === "paper" ? paper : "none";
  const dash = `${String(paint.width * 4)} ${String(paint.width * 3)}`;
  return (
    <>
      {shapeParts(kind, w, h, radius).map((part, index) => (
        <path
          key={index}
          d={part.d}
          fill={part.filled ? paint.fill : "none"}
          stroke={part.noStroke ? "none" : paint.stroke}
          strokeWidth={paint.width}
          strokeDasharray={part.dashed ? dash : undefined}
          strokeLinejoin="round"
        />
      ))}
      {shapeIcons(kind, marker, w, h).map(({ at, parts }, index) => (
        <g
          key={index}
          data-testid="shape-marker"
          transform={`translate(${String(at.x)} ${String(at.y)}) scale(${String(at.size / 24)})`}
        >
          {parts.map((part, i) => (
            <path
              key={i}
              d={part.d}
              fill={tone(part.fill)}
              stroke={part.stroke === "none" ? "none" : tone(part.stroke)}
              strokeWidth={part.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </g>
      ))}
    </>
  );
}
