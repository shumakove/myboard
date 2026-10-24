import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { FRAME_TYPE } from "./frameOptions";
import {
  boundsOf,
  center,
  cornerPoint,
  cornerSign,
  MIN_SIZE,
  opposite,
  rectContains,
  resizeFrame,
  type Corner,
  type Frame,
} from "./geometry";
import type { Gesture } from "./gestures";
import { ancestors } from "./groups";
import {
  GROUP_TYPE,
  objectMap,
  patchObjects,
  touch,
  transact,
  writeFields,
  type SceneObject,
} from "./sceneObjects";

export { FRAME_TYPE };

/**
 * Фреймы (T6.6). Фрейм — родитель объектов, попавших в него: их координаты в документе
 * относительно фрейма, поэтому они двигаются вместе с ним (FRM-01). Объект попадает
 * во фрейм, когда его центр оказался внутри рамки фрейма после перемещения или
 * постановки, и выходит из него, когда центр снаружи.
 */

export function isFrame(object: SceneObject): boolean {
  return object.type === FRAME_TYPE;
}

/** Записанное положение объекта на доске (у группы — начало координат её объектов). */
function anchor(object: SceneObject): Point {
  return { x: object.x - object.offset.x, y: object.y - object.offset.y };
}

/**
 * Может ли объект сам переходить между фреймами: не фрейм и не линия (её положение
 * задают концы), не заблокирован и лежит на верхнем уровне или во фрейме, а не в группе.
 */
function movable(object: SceneObject, byId: ReadonlyMap<string, SceneObject>) {
  if (object.type === FRAME_TYPE || object.type === "line" || object.locked) {
    return false;
  }
  const parent = object.parent === null ? undefined : byId.get(object.parent);
  return parent === undefined || parent.type === FRAME_TYPE;
}

/**
 * Фрейм, в который попадает объект: верхний из фреймов, внутри которых его центр.
 * Фрейм со скрытым содержимым (FRM-04) и заблокированный вместе с содержимым (FRM-05)
 * новых объектов не принимают.
 */
export function frameUnder(
  scene: readonly SceneObject[],
  object: SceneObject,
): SceneObject | null {
  const bounds = boundsOf([object]);
  if (bounds === null) return null;
  const point = center(bounds);
  for (let i = scene.length - 1; i >= 0; i--) {
    const frame = scene[i];
    if (frame === undefined || frame.frameOptions === null) continue;
    if (frame.id === object.id || frame.hidden) continue;
    if (frame.frameOptions.contentHidden || frame.frameOptions.contentLocked) {
      continue;
    }
    if (ancestors(scene, frame.id).some((a) => a.id === object.id)) continue;
    if (rectContains(frame, point)) return frame;
  }
  return null;
}

/**
 * FRM-01: объекты `ids` переходят во фрейм под своим центром или выходят из фрейма
 * на верхний уровень; на доске они остаются на месте и встают поверх новых соседей.
 */
export function placeInFrames(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  ids: Iterable<string>,
  actor: string,
): void {
  const byId = new Map(scene.map((o) => [o.id, o]));
  transact(objects, () => {
    for (const id of ids) {
      const object = byId.get(id);
      if (object === undefined || !movable(object, byId)) continue;
      const target = frameUnder(scene, object);
      const parent = target?.id ?? null;
      if (parent === object.parent) continue;
      reparent(objects, scene, object, target, actor);
    }
  });
}

/**
 * FRM-01: новый фрейм забирает объекты верхнего уровня, которые лежат в нём целиком.
 */
export function adoptContained(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  frameId: string,
  actor: string,
): void {
  const frame = scene.find((o) => o.id === frameId);
  if (frame === undefined) return;
  const byId = new Map(scene.map((o) => [o.id, o]));
  const inside = scene.filter((o) => {
    if (o.id === frameId || o.parent !== null || !movable(o, byId)) {
      return false;
    }
    const bounds = boundsOf([o]);
    return (
      bounds !== null &&
      rectContains(frame, bounds) &&
      rectContains(frame, {
        x: bounds.x + bounds.width,
        y: bounds.y + bounds.height,
      })
    );
  });
  transact(objects, () => {
    for (const object of inside) {
      reparent(objects, scene, object, frame, actor);
    }
  });
}

/** Объект переходит к новому родителю (или на верхний уровень) без сдвига на доске. */
function reparent(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  object: SceneObject,
  parent: SceneObject | null,
  actor: string,
): void {
  const map = objectMap(objects, object.id);
  if (map === null) return;
  const at = anchor(object);
  const base = parent === null ? { x: 0, y: 0 } : anchor(parent);
  const parentId = parent?.id ?? null;
  const siblings = scene.filter(
    (o) => o.parent === parentId && o.id !== object.id,
  );
  map.set("parent", parentId);
  map.set("x", at.x - base.x);
  map.set("y", at.y - base.y);
  map.set("z", Math.max(0, ...siblings.map((o) => o.z)) + 1);
  touch(map, actor);
}

/** Новый фрейм — под объектами верхнего уровня: он фон для своего содержимого. */
export function sendToBack(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  id: string,
): void {
  const roots = scene.filter((o) => o.parent === null && o.id !== id);
  const lowest = Math.min(1, ...roots.map((o) => o.z));
  objectMap(objects, id)?.set("z", lowest - 1);
}

/** FRM-04: скрыть или показать содержимое фреймов — и у заблокированных. */
export function setContentHidden(
  objects: Y.Map<unknown>,
  frames: readonly SceneObject[],
  hidden: boolean,
  actor: string,
): void {
  const changes = new Map<string, Record<string, unknown>>();
  for (const frame of frames) {
    if (isFrame(frame)) changes.set(frame.id, { contentHidden: hidden });
  }
  writeFields(objects, changes, actor);
}

/** FRM-03: фиксация пропорций фрейма. */
export function setKeepRatio(
  objects: Y.Map<unknown>,
  frame: SceneObject,
  keep: boolean,
  actor: string,
): void {
  writeFields(objects, new Map([[frame.id, { keepRatio: keep }]]), actor);
}

/**
 * FRM-05: блокировка выделенного, где есть фреймы: `withContent` — фрейм вместе
 * с содержимым, иначе только рамка (объекты внутри остаются изменяемыми).
 */
export function lockWithFrames(
  objects: Y.Map<unknown>,
  units: readonly SceneObject[],
  withContent: boolean,
  actor: string,
): void {
  const changes = new Map<string, Record<string, unknown>>();
  for (const unit of units) {
    changes.set(
      unit.id,
      isFrame(unit)
        ? { locked: true, lockContent: withContent }
        : { locked: true },
    );
  }
  writeFields(objects, changes, actor);
}

/**
 * FRM-03: размер за угол с сохранением пропорций — противоположный угол на месте,
 * масштаб — по большей из сторон, которые тянут.
 */
export function resizeKeepingRatio(
  frame: Frame,
  corner: Corner,
  pointer: Point,
): Frame {
  const fixed = cornerPoint(frame, opposite(corner));
  const sign = cornerSign(corner);
  const free = resizeFrame(frame, corner, pointer);
  const smallest = Math.max(1, Math.min(frame.width, frame.height));
  const scale = Math.max(
    MIN_SIZE / smallest,
    free.width / Math.max(frame.width, 1),
    free.height / Math.max(frame.height, 1),
  );
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    x: sign.x > 0 ? fixed.x : fixed.x - width,
    y: sign.y > 0 ? fixed.y : fixed.y - height,
    width,
    height,
    rotation: frame.rotation,
  };
}

/**
 * CVS-14 для одного фрейма: объекты внутри остаются на месте доски, пока тянут угол
 * (их координаты относительно левого верхнего угла фрейма пересчитываются); FRM-03 —
 * с фиксированными пропорциями. `children` — прямые дети фрейма, и скрытые тоже.
 */
export function frameResizeGesture(
  objects: Y.Map<unknown>,
  frame: SceneObject,
  children: readonly SceneObject[],
  corner: Corner,
  actor: string,
): Gesture {
  const start = anchor(frame);
  const placed = children.map((child) => {
    const at = anchor(child);
    return { id: child.id, x: at.x, y: at.y };
  });
  const keepRatio = frame.frameOptions?.keepRatio === true;
  // Дети переписываются, только когда сдвинулся левый верхний угол фрейма.
  let origin = start;
  const apply = ({ board }: { board: Point }) => {
    const next = keepRatio
      ? resizeKeepingRatio(frame, corner, board)
      : resizeFrame(frame, corner, board);
    transact(objects, () => {
      patchObjects(objects, new Map([[frame, next]]), actor);
      if (next.x === origin.x && next.y === origin.y) return;
      origin = { x: next.x, y: next.y };
      const changes = new Map<string, Record<string, unknown>>();
      for (const child of placed) {
        changes.set(child.id, { x: child.x - next.x, y: child.y - next.y });
      }
      writeFields(objects, changes, actor);
    });
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/**
 * Масштаб нескольких объектов (CVS-14): объекты внутри выделенного фрейма не
 * масштабируются отдельно — они в его системе координат и едут вместе с ним.
 */
export function scaledLeaves(
  scene: readonly SceneObject[],
  leaves: readonly SceneObject[],
): SceneObject[] {
  const frames = new Set(leaves.filter(isFrame).map((o) => o.id));
  return leaves.filter(
    (o) =>
      o.type !== GROUP_TYPE &&
      !ancestors(scene, o.id).some((a) => frames.has(a.id)),
  );
}
