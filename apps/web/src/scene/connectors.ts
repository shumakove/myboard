import type { Point } from "../realtime/messages";
import type { Rect } from "../canvas/camera";
import { center, rotateVector, type Frame } from "./geometry";

/**
 * Соединительная линия (T6.4): модель и геометрия.
 *
 * Объект типа `line` хранит концы `start`, `end` и промежуточные точки `points`
 * относительно своего положения `x`, `y` (так линию двигают, выравнивают и копируют
 * как любой объект). Конец, привязанный к объекту (CVS-26), хранит `object` и точку
 * привязки `anchor`; его положение берётся из рамки этого объекта при каждом чтении
 * документа — линия следует за объектом. `x`, `y` конца — запасное положение, если
 * объекта нет. Подписи — `labels`: id → поля подписи (CON-03, CON-04).
 */

/** CON-01: прямая, ломаная (под прямыми углами) и кривая. */
export type LineStyle = "straight" | "elbow" | "curved";

/** CON-01, CON-07: наконечник конца линии; `none` — без наконечника. */
export type Cap = "none" | "arrow" | "triangle" | "circle" | "diamond";

/** CVS-26: точки привязки — середины сторон рамки объекта. */
export type Anchor = "n" | "e" | "s" | "w";

export const ANCHORS: readonly Anchor[] = ["n", "e", "s", "w"];

export interface LineEnd {
  x: number;
  y: number;
  object?: string;
  anchor?: Anchor;
}

/** CON-03: подпись идёт горизонтально или вдоль направления линии. */
export type LabelOrientation = "horizontal" | "along";

export interface LineLabel {
  id: string;
  text: string;
  /** Положение вдоль линии: 0 — начало, 1 — конец (по длине линии). */
  position: number;
  orientation: LabelOrientation;
  /** Выравнивание строк подписи (CON-04: несколько строк). */
  align: "left" | "center" | "right";
  fontFamily: string;
  fontSize: number;
  color: string;
}

export interface LineData {
  start: LineEnd;
  end: LineEnd;
  points: Point[];
  labels: LineLabel[];
}

/** Линия на сцене: данные и положение на доске. */
export interface LineShape extends LineData {
  /** Опорные точки на доске: начало, промежуточные, конец. */
  path: Point[];
  /** Направления выхода из объектов привязанных концов (наружу), иначе `null`. */
  startDir: Point | null;
  endDir: Point | null;
  /** Ломаная, повторяющая нарисованную линию (кривая — с шагом), по участкам. */
  segments: Point[][];
}

export const LABEL_DEFAULTS: Omit<LineLabel, "id" | "text" | "position"> = {
  orientation: "horizontal",
  align: "center",
  fontFamily: "sans",
  fontSize: 16,
  color: "#1f2937",
};

/** CON-03: положения подписи у начала, по центру и у конца линии. */
export const LABEL_PLACES = { start: 0.1, center: 0.5, end: 0.9 } as const;

/** Шагов на один участок кривой при разбиении на отрезки. */
const CURVE_STEPS = 24;

// --- Чтение -----------------------------------------------------------------

function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readPoint(value: unknown): Point | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y } = value as Record<string, unknown>;
  return isNum(x) && isNum(y) ? { x, y } : null;
}

export function readEnd(value: unknown, fallback: Point): LineEnd {
  const point = readPoint(value) ?? fallback;
  const end: LineEnd = { x: point.x, y: point.y };
  if (typeof value === "object" && value !== null) {
    const { object, anchor } = value as Record<string, unknown>;
    if (typeof object === "string" && ANCHORS.includes(anchor as Anchor)) {
      end.object = object;
      end.anchor = anchor as Anchor;
    }
  }
  return end;
}

function readLabel(id: string, value: unknown): LineLabel | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const pick = <T>(key: string, ok: (v: unknown) => boolean, fallback: T): T =>
    ok(record[key]) ? (record[key] as T) : fallback;
  return {
    id,
    text: typeof record.text === "string" ? record.text : "",
    position: Math.min(1, Math.max(0, pick("position", isNum, 0.5))),
    orientation: record.orientation === "along" ? "along" : "horizontal",
    align: pick(
      "align",
      (v) => v === "left" || v === "center" || v === "right",
      LABEL_DEFAULTS.align,
    ),
    fontFamily: pick(
      "fontFamily",
      (v) => typeof v === "string",
      LABEL_DEFAULTS.fontFamily,
    ),
    fontSize: pick(
      "fontSize",
      (v) => isNum(v) && v > 0,
      LABEL_DEFAULTS.fontSize,
    ),
    color: pick("color", (v) => typeof v === "string", LABEL_DEFAULTS.color),
  };
}

/** Данные линии из записи документа (JSON); неверные поля — значения по умолчанию. */
export function readLineData(record: Record<string, unknown>): LineData {
  const points = Array.isArray(record.points)
    ? record.points.map(readPoint).filter((p) => p !== null)
    : [];
  const labels =
    typeof record.labels === "object" && record.labels !== null
      ? Object.entries(record.labels as Record<string, unknown>)
          .map(([id, value]) => readLabel(id, value))
          .filter((label) => label !== null)
          .sort((a, b) => a.position - b.position || (a.id < b.id ? -1 : 1))
      : [];
  return {
    start: readEnd(record.start, { x: 0, y: 0 }),
    end: readEnd(record.end, { x: 0, y: 0 }),
    points,
    labels,
  };
}

// --- Привязка (CVS-26) ------------------------------------------------------

const DIRECTIONS: Record<Anchor, Point> = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

/** Точка привязки на рамке объекта с учётом поворота. */
export function anchorPoint(frame: Frame, anchor: Anchor): Point {
  const c = center(frame);
  const d = DIRECTIONS[anchor];
  const v = rotateVector(
    { x: (d.x * frame.width) / 2, y: (d.y * frame.height) / 2 },
    frame.rotation,
  );
  return { x: c.x + v.x, y: c.y + v.y };
}

/** Направление из объекта наружу в точке привязки. */
export function anchorDirection(frame: Frame, anchor: Anchor): Point {
  return rotateVector(DIRECTIONS[anchor], frame.rotation);
}

/** Объекты, к которым привязывают линии: всё, кроме линий и групп. */
export function isConnectable(type: string): boolean {
  return type !== "line" && type !== "group";
}

/**
 * Положение линии на доске: привязанный конец — в точке привязки своего объекта
 * (`frames` — рамки объектов на доске), остальные точки — от положения линии.
 */
export function resolveLine(
  data: LineData,
  position: Point,
  frames: ReadonlyMap<string, Frame>,
  style: unknown,
): LineShape {
  const at = (p: Point): Point => ({
    x: position.x + p.x,
    y: position.y + p.y,
  });
  const end = (e: LineEnd): { point: Point; dir: Point | null } => {
    const frame = e.object === undefined ? undefined : frames.get(e.object);
    if (frame === undefined || e.anchor === undefined) {
      return { point: at(e), dir: null };
    }
    return {
      point: anchorPoint(frame, e.anchor),
      dir: anchorDirection(frame, e.anchor),
    };
  };
  const start = end(data.start);
  const finish = end(data.end);
  const path = [start.point, ...data.points.map(at), finish.point];
  return {
    ...data,
    path,
    startDir: start.dir,
    endDir: finish.dir,
    segments: routeSegments(lineStyle(style), path, start.dir, finish.dir),
  };
}

export function lineStyle(value: unknown): LineStyle {
  return value === "elbow" || value === "curved" ? value : "straight";
}

/**
 * Ближайшая точка привязки объекта под точкой `p` (или рядом, в пределах `threshold`).
 * Верхние объекты проверяются первыми; `exclude` — объекты, к которым не привязывать.
 */
export function findAttachment(
  objects: readonly (Frame & { id: string; type: string })[],
  p: Point,
  threshold: number,
  exclude: ReadonlySet<string> = new Set(),
): { object: string; anchor: Anchor; point: Point } | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const frame = objects[i];
    if (frame === undefined) continue;
    if (!isConnectable(frame.type) || exclude.has(frame.id)) continue;
    if (!nearFrame(frame, p, threshold)) continue;
    let best: { anchor: Anchor; point: Point; d: number } | null = null;
    for (const anchor of ANCHORS) {
      const point = anchorPoint(frame, anchor);
      const d = distance(point, p);
      if (best === null || d < best.d) best = { anchor, point, d };
    }
    if (best !== null) {
      return { object: frame.id, anchor: best.anchor, point: best.point };
    }
  }
  return null;
}

/** Точка внутри повёрнутой рамки, расширенной на `margin`. */
function nearFrame(frame: Frame, p: Point, margin: number): boolean {
  const c = center(frame);
  const local = rotateVector({ x: p.x - c.x, y: p.y - c.y }, -frame.rotation);
  return (
    Math.abs(local.x) <= frame.width / 2 + margin &&
    Math.abs(local.y) <= frame.height / 2 + margin
  );
}

// --- Геометрия --------------------------------------------------------------

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * CON-05: без Shift направление от `base` к `p` встаёт на ближайший угол, кратный 45°;
 * с Shift — любой угол.
 */
export function constrainAngle(base: Point, p: Point, free: boolean): Point {
  if (free) return p;
  const length = distance(base, p);
  const step = Math.PI / 4;
  const angle =
    Math.round(Math.atan2(p.y - base.y, p.x - base.x) / step) * step;
  return {
    x: round(base.x + Math.cos(angle) * length),
    y: round(base.y + Math.sin(angle) * length),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Ломаная по участкам между опорными точками для вида линии (CON-01). */
export function routeSegments(
  style: LineStyle,
  path: readonly Point[],
  startDir: Point | null,
  endDir: Point | null,
): Point[][] {
  const segments: Point[][] = [];
  if (style === "curved") {
    const controls = curveControls(path, startDir, endDir);
    controls.forEach(([c1, c2], i) => {
      const a = path[i] as Point;
      const b = path[i + 1] as Point;
      const points: Point[] = [];
      for (let s = 0; s <= CURVE_STEPS; s++) {
        points.push(cubic(a, c1, c2, b, s / CURVE_STEPS));
      }
      segments.push(points);
    });
    return segments;
  }
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i] as Point;
    const b = path[i + 1] as Point;
    if (style === "straight") {
      segments.push([a, b]);
      continue;
    }
    const first = i === 0 ? startDir : null;
    const last = i + 2 === path.length ? endDir : null;
    segments.push(elbow(a, b, first, last));
  }
  return segments;
}

/** Участок ломаной под прямыми углами: первый ход — по направлению выхода из объекта. */
function elbow(
  a: Point,
  b: Point,
  first: Point | null,
  last: Point | null,
): Point[] {
  const horizontal = (dir: Point | null, dx: number, dy: number) =>
    dir === null
      ? Math.abs(dx) >= Math.abs(dy)
      : Math.abs(dir.x) > Math.abs(dir.y);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const startH = horizontal(first, dx, dy);
  const endH = last === null ? startH : horizontal(last, dx, dy);
  if (startH !== endH) {
    // Выход и вход по разным осям — один поворот.
    return [a, startH ? { x: b.x, y: a.y } : { x: a.x, y: b.y }, b];
  }
  if (startH) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  const my = (a.y + b.y) / 2;
  return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
}

/**
 * Управляющие точки кривой через опорные точки (сплайн Катмулла — Рома). У привязанного
 * конца кривая выходит из объекта по направлению наружу.
 */
export function curveControls(
  path: readonly Point[],
  startDir: Point | null,
  endDir: Point | null,
): [Point, Point][] {
  const n = path.length;
  const tangent = (i: number): Point => {
    const prev = path[Math.max(0, i - 1)] as Point;
    const next = path[Math.min(n - 1, i + 1)] as Point;
    const span = distance(prev, next);
    if (i === 0 && startDir !== null) {
      return { x: startDir.x * span * 1.5, y: startDir.y * span * 1.5 };
    }
    if (i === n - 1 && endDir !== null) {
      return { x: -endDir.x * span * 1.5, y: -endDir.y * span * 1.5 };
    }
    const scale = i === 0 || i === n - 1 ? 1 : 0.5;
    return { x: (next.x - prev.x) * scale, y: (next.y - prev.y) * scale };
  };
  const controls: [Point, Point][] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = path[i] as Point;
    const b = path[i + 1] as Point;
    const ta = tangent(i);
    const tb = tangent(i + 1);
    controls.push([
      { x: a.x + ta.x / 3, y: a.y + ta.y / 3 },
      { x: b.x - tb.x / 3, y: b.y - tb.y / 3 },
    ]);
  }
  return controls;
}

function cubic(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t] as const;
  return {
    x: k[0] * a.x + k[1] * c1.x + k[2] * c2.x + k[3] * b.x,
    y: k[0] * a.y + k[1] * c1.y + k[2] * c2.y + k[3] * b.y,
  };
}

/** Вся ломаная линии одной цепочкой точек. */
export function routeOf(shape: Pick<LineShape, "segments">): Point[] {
  const route: Point[] = [];
  for (const segment of shape.segments) {
    route.push(...(route.length === 0 ? segment : segment.slice(1)));
  }
  return route;
}

/** Описанный прямоугольник точек. */
export function pointsBounds(points: readonly Point[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function lengthOf(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1] as Point, points[i] as Point);
  }
  return total;
}

/** Точка на ломаной в доле `t` её длины и направление линии там (градусы). */
export function pointAlong(
  route: readonly Point[],
  t: number,
): { point: Point; angle: number } {
  const total = lengthOf(route);
  let left = Math.min(1, Math.max(0, t)) * total;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Point;
    const b = route[i] as Point;
    const d = distance(a, b);
    if (d === 0) continue;
    if (left <= d || i === route.length - 1) {
      const k = Math.min(1, left / d);
      return {
        point: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k },
        angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
      };
    }
    left -= d;
  }
  return { point: route[0] ?? { x: 0, y: 0 }, angle: 0 };
}

/** Доля длины ломаной до ближайшей к `p` точки на ней (подпись двигают вдоль линии). */
export function projectOnto(route: readonly Point[], p: Point): number {
  const total = lengthOf(route);
  if (total === 0) return 0;
  let best = { d: Infinity, at: 0 };
  let passed = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as Point;
    const b = route[i] as Point;
    const len = distance(a, b);
    if (len === 0) continue;
    const k = Math.min(
      1,
      Math.max(
        0,
        ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len * len),
      ),
    );
    const q = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    const d = distance(q, p);
    if (d < best.d) best = { d, at: passed + len * k };
    passed += len;
  }
  return best.at / total;
}

/** Середина участка ломаной по длине — сюда ставится маркер новой точки изгиба. */
export function segmentMiddle(segment: readonly Point[]): Point {
  return pointAlong(segment, 0.5).point;
}

/** Текст подписи читается слева направо: угол вдоль линии — в пределах (−90°; 90°]. */
export function uprightAngle(angle: number): number {
  let a = ((angle % 360) + 360) % 360;
  if (a > 180) a -= 360;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
}

/** Контур SVG линии: кривая — кубическими дугами, иначе — ломаной. */
export function svgPath(
  style: LineStyle,
  shape: Pick<LineShape, "path" | "startDir" | "endDir" | "segments">,
  origin: Point,
): string {
  const f = (p: Point) => `${fmt(p.x - origin.x)} ${fmt(p.y - origin.y)}`;
  const [first] = shape.path;
  if (first === undefined) return "";
  if (style === "curved") {
    const controls = curveControls(shape.path, shape.startDir, shape.endDir);
    return (
      `M ${f(first)}` +
      controls
        .map(
          ([c1, c2], i) =>
            ` C ${f(c1)} ${f(c2)} ${f(shape.path[i + 1] as Point)}`,
        )
        .join("")
    );
  }
  const route = routeOf(shape);
  return route.map((p, i) => `${i === 0 ? "M" : "L"} ${f(p)}`).join(" ");
}

function fmt(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * CON-01, CON-07: контур наконечника на конце `tip`, к которому линия приходит
 * с направлением `angle` (градусы). `none` — наконечника нет.
 */
export function capPath(
  cap: Cap,
  tip: Point,
  angle: number,
  size: number,
  origin: Point,
): { d: string; filled: boolean } | null {
  if (cap === "none") return null;
  const rad = (angle * Math.PI) / 180;
  const back = { x: -Math.cos(rad), y: -Math.sin(rad) };
  const side = { x: -back.y, y: back.x };
  const at = (along: number, across: number): string => {
    const x = tip.x + back.x * along + side.x * across - origin.x;
    const y = tip.y + back.y * along + side.y * across - origin.y;
    return `${fmt(x)} ${fmt(y)}`;
  };
  const h = size / 2;
  switch (cap) {
    case "arrow":
      return {
        d: `M ${at(size, h)} L ${at(0, 0)} L ${at(size, -h)}`,
        filled: false,
      };
    case "triangle":
      return {
        d: `M ${at(0, 0)} L ${at(size, h)} L ${at(size, -h)} Z`,
        filled: true,
      };
    case "diamond":
      return {
        d: `M ${at(0, 0)} L ${at(h, h)} L ${at(size, 0)} L ${at(h, -h)} Z`,
        filled: true,
      };
    case "circle": {
      const r = fmt(h * 0.8);
      const far = at(h * 1.6, 0);
      return {
        d: `M ${at(0, 0)} A ${r} ${r} 0 1 0 ${far} A ${r} ${r} 0 1 0 ${at(0, 0)} Z`,
        filled: true,
      };
    }
  }
}

export function isCap(value: unknown): value is Cap {
  return (
    value === "none" ||
    value === "arrow" ||
    value === "triangle" ||
    value === "circle" ||
    value === "diamond"
  );
}

/** Направление прихода линии в конец (градусы): по последнему отрезку ломаной. */
export function endAngle(route: readonly Point[], atStart: boolean): number {
  const points = atStart ? [...route].reverse() : route;
  const tip = points.at(-1);
  for (let i = points.length - 2; i >= 0; i--) {
    const p = points[i] as Point;
    if (tip !== undefined && distance(p, tip) > 0.001) {
      return (Math.atan2(tip.y - p.y, tip.x - p.x) * 180) / Math.PI;
    }
  }
  return 0;
}
