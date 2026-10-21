import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { OBJECT_TYPES, STICKY_COLORS } from "./objectTypes";
import {
  createObject,
  objectMap,
  transact,
  writeTags,
  type SceneObject,
} from "./sceneObjects";

/** STK-04: промежуток между стикером и следующим, созданным по Tab, единицы доски. */
export const NEXT_STICKY_GAP = 20;

/** STK-01: выбранный до постановки цвет стикера — на время сессии вкладки. */
export const STICKY_COLOR_KEY = "myboard.stickyColor";

const DEFAULT_COLOR = String(OBJECT_TYPES.sticky.style.fill);

/** Цвет из палитры стикеров; чужое значение — цвет по умолчанию. */
export function stickyColor(value: unknown): string {
  return STICKY_COLORS.some((color) => color.value === value)
    ? String(value)
    : DEFAULT_COLOR;
}

export function loadStickyColor(): string {
  try {
    return stickyColor(window.sessionStorage.getItem(STICKY_COLOR_KEY));
  } catch {
    return DEFAULT_COLOR;
  }
}

export function rememberStickyColor(color: string): void {
  try {
    window.sessionStorage.setItem(STICKY_COLOR_KEY, color);
  } catch {
    // Без хранилища выбор живёт, пока открыта доска.
  }
}

/** Новый стикер верхнего уровня с рамкой `frame` (координаты доски) и полями `fields`. */
function placeSticky(
  objects: Y.Map<unknown>,
  frame: Point & { width: number; height: number },
  fields: Record<string, unknown>,
  tags: readonly string[],
  actor: string,
): string {
  let id = "";
  transact(objects, () => {
    id = createObject(objects, "sticky", frame, "", actor);
    const map = objectMap(objects, id);
    if (map === null) return;
    map.set("width", frame.width);
    map.set("height", frame.height);
    for (const [key, value] of Object.entries(fields)) map.set(key, value);
    if (tags.length > 0) writeTags(map, tags);
  });
  return id;
}

/**
 * STK-04: следующий стикер справа от `sticky` — того же размера, цвета, размера шрифта
 * и с тем же показом автора. Возвращает id нового стикера.
 */
export function createNextSticky(
  objects: Y.Map<unknown>,
  sticky: SceneObject,
  actor: string,
): string {
  const { fill, fontSize } = sticky.style;
  return placeSticky(
    objects,
    {
      x: sticky.x + sticky.width + NEXT_STICKY_GAP,
      y: sticky.y,
      width: sticky.width,
      height: sticky.height,
    },
    {
      ...(fill !== undefined && { fill }),
      ...(fontSize !== undefined && { fontSize }),
      ...(!sticky.showAuthor && { showAuthor: false }),
    },
    [],
    actor,
  );
}

/**
 * STK-05: стикер из стопки — цвета стопки и с её тегами, центром в точке `at`.
 * Возвращает id нового стикера.
 */
export function pullSticky(
  objects: Y.Map<unknown>,
  stack: SceneObject,
  at: Point,
  actor: string,
): string {
  const { width, height } = OBJECT_TYPES.sticky;
  return placeSticky(
    objects,
    { x: at.x - width / 2, y: at.y - height / 2, width, height },
    { fill: stack.style.fill ?? DEFAULT_COLOR },
    stack.tags,
    actor,
  );
}
