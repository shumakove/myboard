import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import {
  FLIP_TYPE,
  NEW_SIDES,
  sideKey,
  sideTextKey,
  STYLE_FIELDS,
  type FlipDirection,
  type FlipSideName,
  type FlipSideStyle,
} from "./flipData";
import {
  createObject,
  objectMap,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

/** Флип-карточка (T6.11): постановка, переворот и свойства сторон (FLP-01…FLP-03). */

/** FLP-01: новая флип-карточка с левым верхним углом в `at`; возвращает id. */
export function createFlipCard(
  objects: Y.Map<unknown>,
  at: Point,
  actor: string,
): string {
  let id = "";
  transact(objects, () => {
    id = createObject(objects, FLIP_TYPE, at, "", actor);
    const map = objectMap(objects, id);
    if (map === null) return;
    map.set("backText", new Y.Text());
    map.set("flipped", false);
    map.set("direction", "horizontal");
    for (const side of ["front", "back"] as const) {
      const style = NEW_SIDES[side];
      for (const field of Object.keys(STYLE_FIELDS) as (keyof FlipSideStyle)[])
        map.set(sideKey(side, field), style[field]);
    }
  });
  return id;
}

/**
 * FLP-02: перевернуть карточки одной транзакцией — каждая показывает другую сторону.
 * Заблокированные не переворачиваются (CVS-19).
 */
export function flipCards(
  objects: Y.Map<unknown>,
  cards: readonly SceneObject[],
  actor: string,
): void {
  transact(objects, () => {
    for (const card of cards) {
      if (card.flip === null || card.locked) continue;
      const map = objectMap(objects, card.id);
      if (map === null) continue;
      map.set("flipped", !card.flip.flipped);
      touch(map, actor);
    }
  });
}

/** FLP-01, FLP-03: свойства стороны или направление переворота одной карточки. */
export function setFlipFields(
  objects: Y.Map<unknown>,
  card: SceneObject,
  side: FlipSideName,
  fields: Partial<FlipSideStyle> & { direction?: FlipDirection },
  actor: string,
): void {
  if (card.flip === null || card.locked) return;
  transact(objects, () => {
    const map = objectMap(objects, card.id);
    if (map === null) return;
    for (const [field, value] of Object.entries(fields)) {
      if (field === "direction") map.set("direction", value);
      else map.set(sideKey(side, field as keyof FlipSideStyle), value);
    }
    touch(map, actor);
  });
}

/** Текст стороны для правки; поле создаётся, если его не было. */
export function sideText(
  objects: Y.Map<unknown>,
  id: string,
  side: FlipSideName,
): Y.Text | null {
  const map = objectMap(objects, id);
  if (map === null) return null;
  const key = sideTextKey(side);
  const text = map.get(key);
  if (text instanceof Y.Text) return text;
  const created = new Y.Text(typeof text === "string" ? text : "");
  map.set(key, created);
  return created;
}
