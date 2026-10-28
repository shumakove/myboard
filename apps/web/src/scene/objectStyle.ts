import type { CSSProperties } from "react";
import type { FlipSide } from "./flipData";
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

/**
 * Оформление объекта по его типу и свойствам. Заливку и обводку фигуры рисует её контур
 * SVG (SHP-03), а не рамка элемента.
 */
export function objectStyle(object: SceneObject): CSSProperties {
  if (object.type === "frame") {
    return { ...frameStyle(object), ...frameLook(object.style) };
  }
  const { fill, stroke, color, fontSize, background } = object.style;
  // Заливку фигуры рисует контур SVG, кубика — его тело по числу граней (DICE-01).
  const outlined = object.type === "shape" || object.type === "dice";
  return {
    ...frameStyle(object),
    background: outlined ? undefined : (str(fill) ?? str(background)),
    borderColor: outlined ? undefined : str(stroke),
    color: str(color),
    fontSize: num(fontSize),
    ...textStyle(object.style),
  };
}

/** Цвет фона рамки в виде Border only: цвет — только у границы (FRM-02). */
const FRAME_PAPER = "#ffffff";

/**
 * FRM-02: оформление фрейма. Fill — фон цветом (тонкая нейтральная граница видна и на
 * фоне того же цвета); Border only — граница цветом, фон белый; No background — граница
 * цветом, фон прозрачный (видна доска).
 */
export function frameLook(style: SceneObject["style"]): CSSProperties {
  const color = str(style.fill) ?? FRAME_PAPER;
  switch (style.appearance) {
    case "border":
      return { background: FRAME_PAPER, borderColor: color };
    case "outline":
      return { background: "transparent", borderColor: color };
    default:
      return { background: color, borderColor: undefined };
  }
}

/** TXT-01: шрифт, начертание, выравнивание и межстрочный интервал текста. */
export function textStyle(style: SceneObject["style"]): CSSProperties {
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

/** FLP-03: размер и форматирование текста стороны флип-карточки. */
export function sideTextStyle(side: FlipSide): CSSProperties {
  return {
    color: side.color,
    fontSize: side.fontSize,
    ...textStyle({ fontStyle: side.fontStyle, align: side.align }),
  };
}
