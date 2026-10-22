import type { CSSProperties } from "react";
import type { Point } from "../realtime/messages";
import {
  pointAlong,
  routeOf,
  uprightAngle,
  type LineLabel,
} from "./connectors";
import { FONT_STACKS } from "./objectTypes";
import type { SceneObject } from "./sceneObjects";

/** Цвет и толщина линии: записанные или значения по умолчанию. */
export function linePaint(object: SceneObject): {
  color: string;
  width: number;
} {
  const { stroke, strokeWidth } = object.style;
  return {
    color: typeof stroke === "string" ? stroke : "#1f2937",
    width: typeof strokeWidth === "number" && strokeWidth > 0 ? strokeWidth : 2,
  };
}

/** Место подписи на линии и угол её текста (CON-03). */
export function labelPlace(
  object: SceneObject,
  label: LineLabel,
): { point: Point; angle: number } {
  const route = object.line === null ? [] : routeOf(object.line);
  const { point, angle } = pointAlong(route, label.position);
  return {
    point,
    angle: label.orientation === "along" ? uprightAngle(angle) : 0,
  };
}

/** Оформление текста подписи (CON-04). */
export function labelTextStyle(label: LineLabel): CSSProperties {
  return {
    fontFamily: FONT_STACKS[label.fontFamily],
    fontSize: label.fontSize,
    color: label.color,
    textAlign: label.align,
  };
}
