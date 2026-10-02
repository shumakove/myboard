import type { CameraView, Point } from "../realtime/messages";

/**
 * Камера холста: центр вида в координатах доски и масштаб. Экранные точки — относительно
 * левого верхнего угла области холста. Минимальная камера для присутствия (курсоры,
 * слежение — COL-02, COL-04); полное управление видом — T5.1.
 */
export const HOME: CameraView = { x: 0, y: 0, zoom: 1 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export interface Size {
  width: number;
  height: number;
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
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
  const fixed = screenToBoard(anchor, camera, size);
  return {
    x: fixed.x - (anchor.x - size.width / 2) / zoom,
    y: fixed.y - (anchor.y - size.height / 2) / zoom,
    zoom,
  };
}
