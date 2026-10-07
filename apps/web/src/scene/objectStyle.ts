import type { CSSProperties } from "react";
import type { Frame } from "./geometry";
import type { SceneObject } from "./sceneObjects";

/** Положение рамки в слое доски: координаты доски, поворот вокруг центра. */
export function frameStyle(frame: Frame): CSSProperties {
  return {
    left: frame.x,
    top: frame.y,
    width: frame.width,
    height: frame.height,
    transform: frame.rotation
      ? `rotate(${String(frame.rotation)}deg)`
      : undefined,
  };
}

/** Оформление объекта по его типу и свойствам. */
export function objectStyle(object: SceneObject): CSSProperties {
  const { fill, stroke, color, fontSize } = object.style;
  return {
    ...frameStyle(object),
    background: typeof fill === "string" ? fill : undefined,
    borderColor: typeof stroke === "string" ? stroke : undefined,
    color: typeof color === "string" ? color : undefined,
    fontSize: typeof fontSize === "number" ? fontSize : undefined,
  };
}
