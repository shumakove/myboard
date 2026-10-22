import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { Brush } from "./drawingShape";
import { createObject, objectMap, transact } from "./sceneObjects";

/** Оформление нового штриха: кисть, цвет и толщина. */
export interface StrokeStyle {
  brush: Brush;
  color: string;
  width: number;
}

/** Точки хранятся с точностью до десятой доли единицы доски — документ не раздувается. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * DRW-01: новый штрих по точкам доски — объект верхнего уровня поверх остальных.
 * Возвращает id объекта.
 */
export function createDrawing(
  objects: Y.Map<unknown>,
  points: readonly Point[],
  style: StrokeStyle,
  actor: string,
): string {
  const first = points[0] ?? { x: 0, y: 0 };
  const minX = Math.min(...points.map((p) => p.x), first.x);
  const minY = Math.min(...points.map((p) => p.y), first.y);
  const flat = (points.length > 0 ? points : [first]).flatMap((p) => [
    round(p.x - minX),
    round(p.y - minY),
  ]);
  // Одна точка — это точка-штрих: путь из одной точки дважды.
  if (flat.length === 2) flat.push(...flat);
  const xs = flat.filter((_, i) => i % 2 === 0);
  const ys = flat.filter((_, i) => i % 2 === 1);
  // Прямой горизонтальный или вертикальный штрих — рамка не нулевая.
  const width = Math.max(...xs, 1);
  const height = Math.max(...ys, 1);
  let id = "";
  transact(objects, () => {
    id = createObject(
      objects,
      "drawing",
      { x: round(minX), y: round(minY) },
      "",
      actor,
      { stroke: style.color, strokeWidth: style.width },
      { width, height },
    );
    const map = objectMap(objects, id);
    map?.delete("text");
    map?.set("brush", style.brush);
    map?.set("points", flat);
    map?.set("baseWidth", width);
    map?.set("baseHeight", height);
  });
  return id;
}
