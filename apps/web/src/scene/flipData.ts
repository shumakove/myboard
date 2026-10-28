/**
 * Флип-карточка (T6.11) в документе — поля `Y.Map` объекта `type: "flipcard"`:
 * - `text` и `backText` — `Y.Text` лицевой и оборотной стороны (правки сливаются по
 *   символам, COL-01);
 * - `flipped` — показана оборотная сторона (FLP-02), общее для всех участников;
 * - `direction` — направление переворота: `horizontal` (вокруг вертикальной оси) или
 *   `vertical` (FLP-01);
 * - у каждой стороны свои поля с префиксом `front`/`back`: `Fill` — цвет стороны,
 *   `FontSize`, `FontStyle`, `Color`, `Align` — размер и форматирование текста (FLP-03),
 *   `Image` — картинка стороны, data URL (FLP-01).
 * Каждое поле — свой ключ: одновременные правки разных свойств не затирают друг друга.
 */

export const FLIP_TYPE = "flipcard";

export type FlipSideName = "front" | "back";
export type FlipDirection = "horizontal" | "vertical";

export const FLIP_DIRECTIONS: readonly {
  value: FlipDirection;
  label: string;
}[] = [
  { value: "horizontal", label: "Horizontal" },
  { value: "vertical", label: "Vertical" },
];

/** Свойства стороны, кроме текста. */
export interface FlipSideStyle {
  fill: string;
  fontSize: number;
  fontStyle: string;
  color: string;
  align: string;
  /** Картинка стороны — data URL; `null` — без картинки. */
  image: string | null;
}

export interface FlipSide extends FlipSideStyle {
  text: string;
}

export interface FlipShape {
  flipped: boolean;
  direction: FlipDirection;
  front: FlipSide;
  back: FlipSide;
}

/** Оформление сторон новой карточки: лицевая — светлая, оборотная — цветная. */
export const NEW_SIDES: Record<FlipSideName, FlipSideStyle> = {
  front: {
    fill: "#ffffff",
    fontSize: 24,
    fontStyle: "normal",
    color: "#1f2937",
    align: "center",
    image: null,
  },
  back: {
    fill: "#81d4fa",
    fontSize: 24,
    fontStyle: "normal",
    color: "#1f2937",
    align: "center",
    image: null,
  },
};

export const STYLE_FIELDS: Record<keyof FlipSideStyle, string> = {
  fill: "Fill",
  fontSize: "FontSize",
  fontStyle: "FontStyle",
  color: "Color",
  align: "Align",
  image: "Image",
};

/** Ключ поля стороны в документе: `front` + `Fill` → `frontFill`. */
export function sideKey(
  side: FlipSideName,
  field: keyof FlipSideStyle,
): string {
  return `${side}${STYLE_FIELDS[field]}`;
}

/** Ключ текста стороны: у лицевой — общий текст объекта `text`. */
export function sideTextKey(side: FlipSideName): string {
  return side === "front" ? "text" : "backText";
}

/** Сторона, которую сейчас видно. */
export function shownSide(flip: FlipShape): FlipSideName {
  return flip.flipped ? "back" : "front";
}

export function readFlip(record: Record<string, unknown>): FlipShape {
  return {
    flipped: record.flipped === true,
    direction: record.direction === "vertical" ? "vertical" : "horizontal",
    front: readSide(record, "front"),
    back: readSide(record, "back"),
  };
}

function readSide(
  record: Record<string, unknown>,
  side: FlipSideName,
): FlipSide {
  const base = NEW_SIDES[side];
  const str = (field: keyof FlipSideStyle, fallback: string) => {
    const value = record[sideKey(side, field)];
    return typeof value === "string" && value !== "" ? value : fallback;
  };
  const size = record[sideKey(side, "fontSize")];
  const image = record[sideKey(side, "image")];
  const text = record[sideTextKey(side)];
  return {
    text: typeof text === "string" ? text : "",
    fill: str("fill", base.fill),
    fontSize: isNumber(size) && size > 0 ? size : base.fontSize,
    fontStyle: str("fontStyle", base.fontStyle),
    color: str("color", base.color),
    align: str("align", base.align),
    image: typeof image === "string" && isImageUrl(image) ? image : null,
  };
}

/** Картинка стороны — только data URL изображения: чужой адрес не загружается. */
export function isImageUrl(value: string): boolean {
  return value.startsWith("data:image/");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
