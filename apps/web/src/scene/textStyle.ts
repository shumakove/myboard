import type { StyleKey } from "./objectTypes";

/**
 * TXT-05: последний выбранный размер и цвет шрифта текста — в хранилище сессии вкладки
 * (`sessionStorage`): новый текстовый блок этой вкладки получает их, после закрытия
 * вкладки — снова значения по умолчанию.
 */
export const TEXT_STYLE_KEY = "myboard.textStyle";

/** Какие свойства запоминаются. */
const REMEMBERED: readonly StyleKey[] = ["fontSize", "color"];

export type RememberedStyle = Partial<Record<StyleKey, string | number>>;

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Запомненные размер и цвет; испорченная запись — пусто. */
export function loadTextStyle(): RememberedStyle {
  try {
    const raw = storage()?.getItem(TEXT_STYLE_KEY);
    if (raw == null) return {};
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return {};
    const style: RememberedStyle = {};
    const record = data as Record<string, unknown>;
    if (typeof record.fontSize === "number" && record.fontSize > 0) {
      style.fontSize = record.fontSize;
    }
    if (typeof record.color === "string") style.color = record.color;
    return style;
  } catch {
    return {};
  }
}

/** Выбор свойства у текста: размер и цвет запоминаются, остальное — нет. */
export function rememberTextStyle(key: StyleKey, value: string | number): void {
  if (!REMEMBERED.includes(key)) return;
  try {
    storage()?.setItem(
      TEXT_STYLE_KEY,
      JSON.stringify({ ...loadTextStyle(), [key]: value }),
    );
  } catch {
    // Без хранилища новый текст получает значения по умолчанию.
  }
}
