import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { GROUP_TYPE } from "./objectTypes";
import { REACTION_TYPE } from "./reactionData";
import {
  createObject,
  objectMap,
  transact,
  type SceneObject,
} from "./sceneObjects";

/** Реакция-штамп (T6.11): на какой объект и как её ставят (RCT-01, RCT-03). */

/** RCT-01: реакцию ставят на объект — не на линию, группу и другую реакцию. */
export function canReactTo(object: SceneObject): boolean {
  return (
    object.type !== "line" &&
    object.type !== GROUP_TYPE &&
    object.type !== REACTION_TYPE
  );
}

/**
 * RCT-01: реакция центром в точке доски `center` на объекте `target`; координаты —
 * относительно объекта. Возвращает id.
 */
export function createReaction(
  objects: Y.Map<unknown>,
  target: SceneObject,
  center: Point,
  size: number,
  image: string,
  actor: string,
): string {
  // Начало координат детей объекта — его записанное положение (у группы и карты оно
  // отличается от угла рамки на `offset`).
  const origin = {
    x: target.x - target.offset.x,
    y: target.y - target.offset.y,
  };
  let id = "";
  transact(objects, () => {
    id = createObject(
      objects,
      REACTION_TYPE,
      { x: center.x - size / 2 - origin.x, y: center.y - size / 2 - origin.y },
      "",
      actor,
      {},
      { width: size, height: size },
    );
    const map = objectMap(objects, id);
    if (map === null) return;
    map.delete("text");
    map.set("parent", target.id);
    map.set("image", image);
  });
  return id;
}
