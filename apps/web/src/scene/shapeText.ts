import type { CSSProperties } from "react";
import type { SceneObject } from "./sceneObjects";
import { shapeKind, textBoxOf, type ShapeKind } from "./shapes";

/** Положение области текста внутри рамки фигуры, единицы доски. */
export function textBoxStyle(
  kind: ShapeKind,
  w: number,
  h: number,
): CSSProperties {
  const box = textBoxOf(kind);
  return {
    left: box.x * w,
    top: box.y * h,
    width: box.width * w,
    height: box.height * h,
    writingMode: kind.verticalText ? "vertical-rl" : undefined,
    transform: kind.verticalText ? "rotate(180deg)" : undefined,
  };
}

/** Поле правки текста фигуры — над её областью текста, с тем же поворотом, что у рамки. */
export function shapeEditorStyle(object: SceneObject): CSSProperties {
  const kind = shapeKind(object.style.shape);
  const box = textBoxStyle(kind, object.width, object.height);
  const left = Number(box.left);
  const top = Number(box.top);
  const rotate = object.rotation ? `rotate(${String(object.rotation)}deg)` : "";
  return {
    ...box,
    left: object.x + left,
    top: object.y + top,
    // Поворот — вокруг центра фигуры, а не поля; вертикальное поле правят без разворота.
    transformOrigin: `${String(object.width / 2 - left)}px ${String(object.height / 2 - top)}px`,
    transform: rotate || undefined,
  };
}
