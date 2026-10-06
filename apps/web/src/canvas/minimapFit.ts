import type { Point } from "../realtime/messages";
import type { Rect, Size } from "./camera";

/** Поле вокруг содержимого миникарты, доля большей стороны. */
const MARGIN = 0.1;

/**
 * CVS-04: какую часть доски показывает миникарта — объекты, видимая область и начало
 * координат (чтобы с пустой доски всегда был путь «домой»), с полем по краям.
 */
export function minimapWorld(rects: readonly Rect[], view: Rect): Rect {
  let left = Math.min(0, view.x);
  let top = Math.min(0, view.y);
  let right = Math.max(0, view.x + view.width);
  let bottom = Math.max(0, view.y + view.height);
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  const margin = Math.max(right - left, bottom - top, 1) * MARGIN;
  return {
    x: left - margin,
    y: top - margin,
    width: right - left + 2 * margin,
    height: bottom - top + 2 * margin,
  };
}

/** Вписывание мира в миникарту: точка миникарты = точка доски × scale + offset. */
export interface MinimapFit {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Мир целиком и по центру миникарты, пропорции сохранены. */
export function fitWorld(world: Rect, size: Size): MinimapFit {
  const scale = Math.min(size.width / world.width, size.height / world.height);
  return {
    scale,
    offsetX: (size.width - world.width * scale) / 2 - world.x * scale,
    offsetY: (size.height - world.height * scale) / 2 - world.y * scale,
  };
}

export function toMinimap(rect: Rect, fit: MinimapFit): Rect {
  return {
    x: rect.x * fit.scale + fit.offsetX,
    y: rect.y * fit.scale + fit.offsetY,
    width: rect.width * fit.scale,
    height: rect.height * fit.scale,
  };
}

/** Точка миникарты → точка доски. */
export function toBoard(point: Point, fit: MinimapFit): Point {
  return {
    x: (point.x - fit.offsetX) / fit.scale,
    y: (point.y - fit.offsetY) / fit.scale,
  };
}
