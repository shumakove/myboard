import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { readScene } from "../scene/sceneObjects";
import type { Rect } from "./camera";

/**
 * Прямоугольники объектов верхнего уровня из `objects` документа — для миникарты (CVS-04).
 * Дочерние (с `parent`) лежат внутри родителя и отдельно не нужны; рамка группы —
 * по её объектам (CVS-17). Объект может быть JSON или `Y.Map`.
 */
export function sceneRects(objects: Y.Map<unknown>): Rect[] {
  return readScene(objects)
    .filter((o) => o.parent === null)
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
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
