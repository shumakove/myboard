import type { CameraView, Point } from "../realtime/messages";

/**
 * Камера холста (CVS-01…CVS-04, MOB-02): центр вида в координатах доски и масштаб.
 * Экранные точки — относительно левого верхнего угла области холста. Плоскость без края:
 * сдвиг не ограничен, ограничен только масштаб.
 */
export const HOME: CameraView = { x: 0, y: 0, zoom: 1 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
/** Шаг масштаба кнопками и клавишами «+»/«−». */
export const ZOOM_STEP = 1.25;

export interface Size {
  width: number;
  height: number;
}

/** Прямоугольник в координатах доски. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Масштаб в `factor` раз относительно центра вида (кнопки, клавиши). */
export function zoomBy(camera: CameraView, factor: number): CameraView {
  return { x: camera.x, y: camera.y, zoom: clampZoom(camera.zoom * factor) };
}

/** Тот же масштаб, центр вида — в точке доски (переход по миникарте, CVS-04). */
export function centerOn(camera: CameraView, point: Point): CameraView {
  return { x: point.x, y: point.y, zoom: camera.zoom };
}

/** Поля вокруг объекта, к которому переходит вид, экранные px. */
export const FOCUS_MARGIN = 48;

/**
 * Вид на прямоугольник доски (переход к объекту — CVS-08, SHR-07): его центр — в центре
 * вида, масштаб 100 %, а если прямоугольник с полями не помещается — меньше.
 */
export function focusOn(rect: Rect, size: Size): CameraView {
  const fit = Math.min(
    (size.width - 2 * FOCUS_MARGIN) / rect.width,
    (size.height - 2 * FOCUS_MARGIN) / rect.height,
  );
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    zoom: clampZoom(Number.isFinite(fit) && fit > 0 ? Math.min(1, fit) : 1),
  };
}

/** Видимая часть доски. */
export function viewRect(camera: CameraView, size: Size): Rect {
  const width = size.width / camera.zoom;
  const height = size.height / camera.zoom;
  return {
    x: camera.x - width / 2,
    y: camera.y - height / 2,
    width,
    height,
  };
}

export function screenToBoard(
  point: Point,
  camera: CameraView,
  size: Size,
): Point {
  return {
    x: camera.x + (point.x - size.width / 2) / camera.zoom,
    y: camera.y + (point.y - size.height / 2) / camera.zoom,
  };
}

export function boardToScreen(
  point: Point,
  camera: CameraView,
  size: Size,
): Point {
  return {
    x: (point.x - camera.x) * camera.zoom + size.width / 2,
    y: (point.y - camera.y) * camera.zoom + size.height / 2,
  };
}

/** Сдвиг вида на экранный вектор: содержимое едет вслед за пальцем или мышью. */
export function panBy(camera: CameraView, dx: number, dy: number): CameraView {
  return {
    x: camera.x - dx / camera.zoom,
    y: camera.y - dy / camera.zoom,
    zoom: camera.zoom,
  };
}

/** Масштаб в `factor` раз; точка доски под `anchor` остаётся на месте. */
export function zoomAt(
  camera: CameraView,
  factor: number,
  anchor: Point,
  size: Size,
): CameraView {
  return pinch(camera, [anchor, anchor], [anchor, anchor], size, factor);
}

/**
 * MOB-02: щипок двумя пальцами. Масштаб меняется как расстояние между пальцами,
 * точка доски под серединой пальцев остаётся под ней же — щипок и сдвиг одним жестом.
 * `factor` задаётся явно, когда пальцы совпадают (масштаб колесом в точке).
 */
export function pinch(
  camera: CameraView,
  from: readonly [Point, Point],
  to: readonly [Point, Point],
  size: Size,
  factor: number = distance(to) / distance(from),
): CameraView {
  const zoom = clampZoom(camera.zoom * (Number.isFinite(factor) ? factor : 1));
  const fixed = screenToBoard(middle(from), camera, size);
  const anchor = middle(to);
  return {
    x: fixed.x - (anchor.x - size.width / 2) / zoom,
    y: fixed.y - (anchor.y - size.height / 2) / zoom,
    zoom,
  };
}

function distance([a, b]: readonly [Point, Point]): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function middle([a, b]: readonly [Point, Point]): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
