import type { CSSProperties } from "react";
import type { Frame } from "./geometry";
import { FONT_STACKS } from "./objectTypes";
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
  const { fill, stroke, color, fontSize, background } = object.style;
  return {
    ...frameStyle(object),
    background: str(fill) ?? str(background),
    borderColor: str(stroke),
    color: str(color),
    fontSize: num(fontSize),
    ...textStyle(object.style),
  };
}

/** TXT-01: шрифт, начертание, выравнивание и межстрочный интервал текста. */
function textStyle(style: SceneObject["style"]): CSSProperties {
  const { fontFamily, fontStyle, align, lineHeight } = style;
  const family = str(fontFamily);
  const variant = str(fontStyle) ?? "";
  return {
    fontFamily: family === undefined ? undefined : FONT_STACKS[family],
    fontWeight: variant.startsWith("bold") ? 700 : undefined,
    fontStyle: variant.endsWith("italic") ? "italic" : undefined,
    textDecorationLine:
      variant === "underline"
        ? "underline"
        : variant === "strike"
          ? "line-through"
          : undefined,
    textAlign: ALIGNS.find((value) => value === align),
    lineHeight: num(lineHeight),
  };
}

const ALIGNS = ["left", "center", "right", "justify"] as const;

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
