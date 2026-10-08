import type { Point } from "../realtime/messages";
import type { Rect, Size } from "../canvas/camera";

/** Прямоугольник с поворотом вокруг центра (градусы) — рамка объекта или выделения. */
export interface Frame extends Rect {
  rotation: number;
}

/** Угол рамки: n/s — верх/низ, w/e — лево/право. */
export type Corner = "nw" | "ne" | "sw" | "se";

/** Наименьшая сторона объекта при изменении размера, в единицах доски. */
export const MIN_SIZE = 10;
/** Шаг угла поворота с Shift, градусы. */
export const ROTATION_STEP = 15;

const RAD = Math.PI / 180;

export function center(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Поворот вектора на угол в градусах. */
export function rotateVector(v: Point, degrees: number): Point {
  const cos = Math.cos(degrees * RAD);
  const sin = Math.sin(degrees * RAD);
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos };
}

/** Знаки угла относительно центра рамки. */
export function cornerSign(corner: Corner): Point {
  return {
    x: corner.endsWith("w") ? -1 : 1,
    y: corner.startsWith("n") ? -1 : 1,
  };
}

export function opposite(corner: Corner): Corner {
  const flip: Record<Corner, Corner> = {
    nw: "se",
    ne: "sw",
    sw: "ne",
    se: "nw",
  };
  return flip[corner];
}

/** Угол рамки в координатах доски с учётом поворота. */
export function cornerPoint(frame: Frame, corner: Corner): Point {
  const sign = cornerSign(corner);
  const c = center(frame);
  const offset = rotateVector(
    { x: (sign.x * frame.width) / 2, y: (sign.y * frame.height) / 2 },
    frame.rotation,
  );
  return { x: c.x + offset.x, y: c.y + offset.y };
}

export function corners(frame: Frame): Point[] {
  return (["nw", "ne", "se", "sw"] as const).map((c) => cornerPoint(frame, c));
}

/** Описанный прямоугольник по осям для набора рамок; `null` — рамок нет. */
export function boundsOf(frames: readonly Frame[]): Rect | null {
  const points = frames.flatMap(corners);
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/** Прямоугольник по двум противоположным точкам. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function rectContains(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x &&
    p.x <= rect.x + rect.width &&
    p.y >= rect.y &&
    p.y <= rect.y + rect.height
  );
}

/** Точка внутри многоугольника (правило чётности пересечений). */
export function polygonContains(polygon: readonly Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** CVS-10: объект попадает в рамку или лассо, если внутри все его углы. */
export function frameInside(
  frame: Frame,
  contains: (p: Point) => boolean,
): boolean {
  return corners(frame).every(contains);
}

/** CVS-12: прилипание к сетке; шаг 0 — сетки нет. */
export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** CVS-12: с Shift сдвиг идёт только по оси, вдоль которой мышь ушла дальше. */
export function lockAxis(delta: Point): Point {
  return Math.abs(delta.x) >= Math.abs(delta.y)
    ? { x: delta.x, y: 0 }
    : { x: 0, y: delta.y };
}

/**
 * CVS-14: изменение размера одного объекта за угол. Противоположный угол стоит на месте,
 * размеры считаются в повёрнутой системе объекта.
 */
export function resizeFrame(
  frame: Frame,
  corner: Corner,
  pointer: Point,
): Frame {
  const fixed = cornerPoint(frame, opposite(corner));
  const sign = cornerSign(corner);
  const local = rotateVector(
    { x: pointer.x - fixed.x, y: pointer.y - fixed.y },
    -frame.rotation,
  );
  const width = Math.max(MIN_SIZE, local.x * sign.x);
  const height = Math.max(MIN_SIZE, local.y * sign.y);
  const half = rotateVector(
    { x: (sign.x * width) / 2, y: (sign.y * height) / 2 },
    frame.rotation,
  );
  const c = { x: fixed.x + half.x, y: fixed.y + half.y };
  return {
    x: c.x - width / 2,
    y: c.y - height / 2,
    width,
    height,
    rotation: frame.rotation,
  };
}

/**
 * CVS-14: изменение размера нескольких объектов — равномерный масштаб от противоположного
 * угла общей рамки. Возвращает коэффициент масштаба.
 */
export function groupScale(
  bounds: Rect,
  corner: Corner,
  pointer: Point,
): number {
  const frame = { ...bounds, rotation: 0 };
  const fixed = cornerPoint(frame, opposite(corner));
  const sign = cornerSign(corner);
  const sx = ((pointer.x - fixed.x) * sign.x) / Math.max(bounds.width, 1);
  const sy = ((pointer.y - fixed.y) * sign.y) / Math.max(bounds.height, 1);
  const smallest = Math.min(bounds.width, bounds.height) || 1;
  return Math.max(MIN_SIZE / smallest, sx, sy);
}

/** Рамка объекта после масштаба `scale` относительно неподвижной точки `origin`. */
export function scaleFrame(frame: Frame, origin: Point, scale: number): Frame {
  const c = center(frame);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const nc = {
    x: origin.x + (c.x - origin.x) * scale,
    y: origin.y + (c.y - origin.y) * scale,
  };
  return {
    x: nc.x - width / 2,
    y: nc.y - height / 2,
    width,
    height,
    rotation: frame.rotation,
  };
}

/** Угол направления из точки `from` в `to`, градусы. */
export function angleBetween(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x) / RAD;
}

/** Рамка после поворота на `degrees` вокруг точки `pivot`. */
export function rotateFrame(
  frame: Frame,
  pivot: Point,
  degrees: number,
): Frame {
  const c = center(frame);
  const v = rotateVector({ x: c.x - pivot.x, y: c.y - pivot.y }, degrees);
  return {
    ...frame,
    x: pivot.x + v.x - frame.width / 2,
    y: pivot.y + v.y - frame.height / 2,
    rotation: normalizeAngle(frame.rotation + degrees),
  };
}

/** Угол в диапазоне (−180; 180]. */
export function normalizeAngle(degrees: number): number {
  const a = ((degrees % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

/** Ширина полосы у края холста, где начинается автопрокрутка, px. */
export const EDGE_ZONE = 40;
/** Наибольший сдвиг вида за шаг автопрокрутки, px экрана. */
export const EDGE_SPEED = 18;

/**
 * CVS-13: скорость автопрокрутки (px экрана за шаг), когда объект тянут у края холста:
 * чем ближе к краю, тем быстрее. Вид едет в сторону края. Слишком маленькая область
 * (или неизвестный размер) не прокручивается.
 */
export function edgeVelocity(point: Point, size: Size): Point {
  if (size.width < EDGE_ZONE * 3 || size.height < EDGE_ZONE * 3) {
    return { x: 0, y: 0 };
  }
  const axis = (value: number, length: number) => {
    if (value < EDGE_ZONE) return -speed(EDGE_ZONE - value);
    if (value > length - EDGE_ZONE) return speed(value - (length - EDGE_ZONE));
    return 0;
  };
  return { x: axis(point.x, size.width), y: axis(point.y, size.height) };
}

function speed(depth: number): number {
  return (Math.min(depth, EDGE_ZONE) / EDGE_ZONE) * EDGE_SPEED;
}

/**
 * BUG-005: меню открывается от точки вправо-вниз, а если там не хватает места в видимой
 * области `bounds` — влево и/или вверх; в крайнем случае прижимается к её краю.
 */
export function placeMenu(at: Point, menu: Size, bounds: Rect): Point {
  const axis = (from: number, size: number, start: number, length: number) => {
    const end = start + length;
    const placed = from + size <= end ? from : from - size;
    return Math.max(start, Math.min(placed, end - size));
  };
  return {
    x: axis(at.x, menu.width, bounds.x, bounds.width),
    y: axis(at.y, menu.height, bounds.y, bounds.height),
  };
}
