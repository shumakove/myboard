import { typeName } from "./objectTypes";
import type { SceneObject } from "./sceneObjects";

/** Длина текста в подписи объекта, символов. */
const LABEL_TEXT = 40;

/**
 * Подпись объекта для ссылки документа (TXT-06) и списка выбора: тип и начало текста —
 * «Sticky note: Idea». `null` — объекта на доске нет.
 */
export function objectLabel(
  scene: readonly SceneObject[],
  id: string,
): string | null {
  const object = scene.find((o) => o.id === id);
  if (object === undefined) return null;
  const text = object.text.replace(/\s+/g, " ").trim();
  const short =
    text.length > LABEL_TEXT ? `${text.slice(0, LABEL_TEXT - 1)}…` : text;
  const type = typeName(object.type);
  return short === "" ? type : `${type}: ${short}`;
}
