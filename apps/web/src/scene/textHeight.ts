import { toBlocks, type DeltaOp } from "../richtext/delta";
import { OBJECT_TYPES, type StyleKey } from "./objectTypes";

/** Поля текстового блока сверху и снизу вместе, единицы доски (scene.css). */
const TEXT_PADDING = 8;
/** Высота строки заголовков относительно размера шрифта (richText.css). */
const HEADER_LINE: Record<1 | 2 | 3, number> = { 1: 2.4, 2: 1.8, 3: 1.44 };

/**
 * Высота нового текстового блока под вставленный текст (TXT-08) — по числу строк без
 * переносов; точную высоту задаёт редактор при первой правке.
 */
export function estimateHeight(
  delta: readonly DeltaOp[],
  style: Partial<Record<StyleKey, string | number>> = {},
): number {
  const defaults = OBJECT_TYPES.text.style;
  const size = Number(style.fontSize ?? defaults.fontSize);
  const lineHeight = Number(style.lineHeight ?? defaults.lineHeight);
  const lines = toBlocks(delta).reduce(
    (sum, block) =>
      sum +
      (block.kind === "divider"
        ? 1
        : block.header === 0
          ? lineHeight
          : HEADER_LINE[block.header]),
    0,
  );
  return Math.ceil(Math.max(1, lines) * size + TEXT_PADDING);
}

/**
 * Новая высота текста или документа под измеренное содержимое, `null` — менять не нужно.
 * Текстовый блок следует за текстом в обе стороны; документ только растёт — его высоту
 * можно задать больше содержимого (TXT-06). Размер стикера текст не меняет (STK-02).
 */
export function fittedHeight(
  type: string,
  current: number,
  measured: number,
): number | null {
  if (type !== "text" && type !== "document") return null;
  const fits =
    type === "document"
      ? measured <= current
      : Math.abs(measured - current) < 1;
  return fits ? null : measured;
}
