import type { Point } from "../realtime/messages";
import {
  capPath,
  endAngle,
  isCap,
  lineStyle,
  routeOf,
  segmentMiddle,
  svgPath,
  type LineLabel,
} from "./connectors";
import type { ConnectHint } from "./lineGestures";
import { labelPlace, labelTextStyle, linePaint } from "./lineLayout";
import type { SceneObject } from "./sceneObjects";

/** Подпись выбрана или открыта для ввода текста (CON-03). */
export interface LabelState {
  line: string;
  label: string;
  editing: boolean;
}

/**
 * Соединительная линия на холсте (T6.4): контур SVG её вида (CON-01), наконечники
 * (CON-01, CON-07) и подписи (CON-03, CON-04). Нажатия ловит широкая прозрачная полоса
 * вдоль линии, а не описанный прямоугольник.
 */
export function LineView({
  object,
  label,
}: {
  object: SceneObject;
  label: LabelState | null;
}) {
  const line = object.line;
  if (line === null) return null;
  const origin = { x: object.x, y: object.y };
  const style = lineStyle(object.style.lineStyle);
  const { color, width } = linePaint(object);
  const route = routeOf(line);
  const d = svgPath(style, line, origin);
  const capSize = 8 + width * 3;
  const caps = (
    [
      ["start", object.style.startCap, route[0], endAngle(route, true)],
      ["end", object.style.endCap, route.at(-1), endAngle(route, false)],
    ] as const
  ).flatMap(([end, cap, tip, angle]) => {
    if (tip === undefined) return [];
    const path = capPath(
      isCap(cap) ? cap : "none",
      tip,
      angle,
      capSize,
      origin,
    );
    return path === null ? [] : [{ end, cap: String(cap), ...path }];
  });
  return (
    <>
      <svg
        className="line-svg"
        aria-hidden="true"
        width={Math.max(object.width, 1)}
        height={Math.max(object.height, 1)}
      >
        <path
          className="line-hit"
          data-testid="line-hit"
          d={d}
          strokeWidth={Math.max(16, width + 12)}
        />
        <path
          className="line-stroke"
          data-testid="line-stroke"
          data-line-style={style}
          d={d}
          stroke={color}
          strokeWidth={width}
        />
        {caps.map((cap) => (
          <path
            key={cap.end}
            className="line-cap"
            data-testid="line-cap"
            data-end={cap.end}
            data-cap={cap.cap}
            d={cap.d}
            fill={cap.filled ? color : "none"}
            stroke={color}
            strokeWidth={width}
          />
        ))}
      </svg>
      {line.labels.map((item) => {
        const state = label?.label === item.id ? label : null;
        if (state?.editing) return null;
        const place = labelPlace(object, item);
        return (
          <LabelView
            key={item.id}
            label={item}
            at={{
              point: {
                x: place.point.x - origin.x,
                y: place.point.y - origin.y,
              },
              angle: place.angle,
            }}
            active={state !== null}
          />
        );
      })}
    </>
  );
}

function LabelView({
  label,
  at,
  active,
}: {
  label: LineLabel;
  at: { point: Point; angle: number };
  active: boolean;
}) {
  return (
    <div
      className="line-label"
      data-label-id={label.id}
      data-testid="line-label"
      data-orientation={label.orientation}
      data-active={active ? "true" : undefined}
      style={{
        left: at.point.x,
        top: at.point.y,
        transform: `translate(-50%, -50%) rotate(${String(at.angle)}deg)`,
        ...labelTextStyle(label),
      }}
    >
      {label.text}
    </div>
  );
}

/**
 * Маркеры выделенной линии: концы (CVS-26), точки изгиба (двойной щелчок удаляет,
 * CON-06) и середины участков — потянуть, чтобы добавить точку изгиба.
 */
export function LineHandles({ line }: { line: SceneObject }) {
  const shape = line.line;
  if (shape === null) return null;
  const { path, segments } = shape;
  const start = path[0];
  const end = path.at(-1);
  const handle = (name: string, label: string, p: Point, kind: string) => (
    <div
      key={name}
      className={`selection-handle line-handle line-handle-${kind}`}
      data-handle={name}
      aria-label={label}
      style={{ left: p.x, top: p.y }}
    />
  );
  return (
    <>
      {segments.map((segment, i) =>
        handle(
          `line-add-${String(i)}`,
          "Add bend point",
          segmentMiddle(segment),
          "add",
        ),
      )}
      {path
        .slice(1, -1)
        .map((p, i) =>
          handle(
            `line-point-${String(i)}`,
            `Bend point ${String(i + 1)}`,
            p,
            "point",
          ),
        )}
      {start && handle("line-start", "Line start", start, "end")}
      {end && handle("line-end", "Line end", end, "end")}
    </>
  );
}

/** CVS-26: точки привязки объекта, к которому сейчас притянется конец линии. */
export function ConnectOverlay({ hint }: { hint: ConnectHint }) {
  if (hint === null) return null;
  return (
    <>
      {hint.points.map((p) => (
        <div
          key={`${String(p.x)}:${String(p.y)}`}
          className="connect-point"
          data-testid="connect-point"
          data-active={
            p.x === hint.active.x && p.y === hint.active.y ? "true" : undefined
          }
          aria-hidden="true"
          style={{ left: p.x, top: p.y }}
        />
      ))}
    </>
  );
}
