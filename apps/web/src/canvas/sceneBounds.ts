import { useEffect, useState } from "react";
import * as Y from "yjs";
import type { Rect } from "./camera";

/**
 * Прямоугольники объектов верхнего уровня из `objects` документа — для миникарты (CVS-04).
 * Берутся объекты с числовыми `x`, `y`, `width`, `height`; дочерние (с `parent`) лежат
 * внутри родителя и отдельно не нужны. Объект может быть JSON или `Y.Map`.
 */
export function sceneRects(objects: Y.Map<unknown>): Rect[] {
  const rects: Rect[] = [];
  for (const value of objects.values()) {
    const object: unknown =
      value instanceof Y.AbstractType ? value.toJSON() : value;
    if (typeof object !== "object" || object === null) continue;
    const { x, y, width, height, parent } = object as Record<string, unknown>;
    if (parent !== undefined && parent !== null) continue;
    if (
      isFiniteNumber(x) &&
      isFiniteNumber(y) &&
      isFiniteNumber(width) &&
      isFiniteNumber(height)
    ) {
      rects.push({ x, y, width, height });
    }
  }
  return rects;
}

/** Прямоугольники объектов, пересчитываются при любой правке `objects`. */
export function useSceneRects(objects: Y.Map<unknown>): Rect[] {
  const [rects, setRects] = useState(() => sceneRects(objects));
  useEffect(() => {
    const update = () => {
      setRects(sceneRects(objects));
    };
    update();
    objects.observeDeep(update);
    return () => {
      objects.unobserveDeep(update);
    };
  }, [objects]);
  return rects;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
