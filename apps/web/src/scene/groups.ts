import * as Y from "yjs";
import { boundsOf } from "./geometry";
import { renumber } from "./layers";
import {
  creationMeta,
  GROUP_TYPE,
  newObjectId,
  objectMap,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

/**
 * Иерархия объектов сцены (CVS-17): группы и их объекты. Объект группы хранит `parent`
 * и координаты относительно группы; группа — начало координат и `z` среди соседей.
 */

/** Предки объекта от родителя к верхнему уровню (только объекты сцены). */
export function ancestors(
  scene: readonly SceneObject[],
  id: string,
): SceneObject[] {
  const byId = new Map(scene.map((o) => [o.id, o]));
  const chain: SceneObject[] = [];
  let parent = byId.get(id)?.parent ?? null;
  while (parent !== null) {
    const next = byId.get(parent);
    if (next === undefined || chain.includes(next)) break;
    chain.push(next);
    parent = next.parent;
  }
  return chain;
}

/** Объекты вместе со всеми вложенными (в порядке отрисовки). */
export function withDescendants(
  scene: readonly SceneObject[],
  ids: Iterable<string>,
): SceneObject[] {
  const wanted = new Set(ids);
  return scene.filter(
    (o) =>
      wanted.has(o.id) || ancestors(scene, o.id).some((a) => wanted.has(a.id)),
  );
}

/** Выделенные без тех, чья группа тоже выделена: действие над группой их уже задевает. */
export function topmost(
  scene: readonly SceneObject[],
  ids: readonly string[],
): SceneObject[] {
  const wanted = new Set(ids);
  return scene.filter(
    (o) =>
      wanted.has(o.id) && !ancestors(scene, o.id).some((a) => wanted.has(a.id)),
  );
}

/**
 * CVS-17: что выделяет щелчок по объекту `leafId`. Объект в группе выделяется вместе
 * с группой, пока в неё не «вошли»: выделен сам объект группы или его сосед.
 */
export function selectionTarget(
  scene: readonly SceneObject[],
  leafId: string,
  selection: readonly string[],
): string {
  const chain = [leafId, ...ancestors(scene, leafId).map((o) => o.id)];
  const selected = new Set(selection);
  const inside = (groupId: string) =>
    selection.some((id) =>
      ancestors(scene, id).some((ancestor) => ancestor.id === groupId),
    );
  for (let i = chain.length - 1; i > 0; i--) {
    const node = chain[i] as string;
    if (selected.has(node) || !inside(node)) return node;
  }
  return leafId;
}

/** Двойной щелчок по объекту выделенной группы «входит» в неё на уровень ниже. */
export function enterGroup(
  scene: readonly SceneObject[],
  leafId: string,
  selection: readonly string[],
): string | null {
  const target = selectionTarget(scene, leafId, selection);
  if (target === leafId) return null;
  const chain = [leafId, ...ancestors(scene, leafId).map((o) => o.id)];
  return chain[chain.indexOf(target) - 1] ?? null;
}

/** Группировать можно два и больше незаблокированных объекта одного родителя. */
export function canGroup(units: readonly SceneObject[]): boolean {
  const [first] = units;
  return (
    first !== undefined &&
    units.length > 1 &&
    units.every((o) => o.parent === first.parent && !o.locked)
  );
}

/** Записанное положение объекта на доске (у группы — начало координат её объектов). */
function anchor(object: SceneObject) {
  return { x: object.x - object.offset.x, y: object.y - object.offset.y };
}

/**
 * CVS-17: объединяет объекты в группу. Группа встаёт на место верхнего из них, порядок
 * слоёв внутри сохраняется. Возвращает id группы или `null`, если группировать нельзя.
 */
export function groupObjects(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  units: readonly SceneObject[],
  actor: string,
): string | null {
  const [first] = units;
  const bounds = boundsOf(units);
  if (first === undefined || bounds === null || !canGroup(units)) return null;
  const parent = scene.find((o) => o.id === first.parent);
  const parentAnchor = parent ? anchor(parent) : { x: 0, y: 0 };
  const members = [...units].sort((a, b) => a.z - b.z);
  const id = newObjectId();
  transact(objects, () => {
    const group = new Y.Map<unknown>();
    group.set("type", GROUP_TYPE);
    group.set("parent", first.parent);
    group.set("x", bounds.x - parentAnchor.x);
    group.set("y", bounds.y - parentAnchor.y);
    group.set("width", bounds.width);
    group.set("height", bounds.height);
    group.set("rotation", 0);
    group.set("z", Math.max(...members.map((o) => o.z)));
    for (const [key, value] of Object.entries(creationMeta(actor)))
      group.set(key, value);
    objects.set(id, group);
    members.forEach((member, index) => {
      const map = objectMap(objects, member.id);
      if (map === null) return;
      const at = anchor(member);
      map.set("parent", id);
      map.set("x", at.x - bounds.x);
      map.set("y", at.y - bounds.y);
      map.set("z", index + 1);
      touch(map, actor);
    });
  });
  return id;
}

/**
 * CVS-17: разгруппировка. Объекты групп переходят к их родителю на место группы
 * с прежним порядком слоёв, сами группы удаляются. Возвращает id освобождённых объектов.
 */
export function ungroupObjects(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  groups: readonly SceneObject[],
  actor: string,
): string[] {
  const freed: string[] = [];
  transact(objects, () => {
    for (const group of groups) {
      if (group.type !== GROUP_TYPE || group.locked) continue;
      const members = scene.filter((o) => o.parent === group.id);
      const siblings = scene.filter((o) => o.parent === group.parent);
      const order = siblings.flatMap((o) =>
        o.id === group.id ? members : [o],
      );
      for (const member of members) {
        const map = objectMap(objects, member.id);
        if (map === null) continue;
        const at = anchor(member);
        map.set("parent", group.parent);
        map.set("x", at.x - group.origin.x);
        map.set("y", at.y - group.origin.y);
        touch(map, actor);
        freed.push(member.id);
      }
      for (const [id, z] of renumber(order))
        objectMap(objects, id)?.set("z", z);
      objects.delete(group.id);
    }
  });
  return freed;
}

/**
 * Что удалить вместе с выбранным: вложенные объекты групп и группы, у которых не остаётся
 * ни одного объекта. Заблокированные (CVS-19) не удаляются.
 */
export function removalSet(
  scene: readonly SceneObject[],
  ids: readonly string[],
): string[] {
  const removed = new Set<string>();
  for (const unit of topmost(scene, ids)) {
    const all = withDescendants(scene, [unit.id]);
    // Группа с заблокированным объектом остаётся целиком, иначе он потерял бы родителя.
    if (all.some((o) => o.locked)) continue;
    for (const o of all) removed.add(o.id);
  }
  // Опустевшие группы уходят вместе с последним объектом (снизу вверх).
  for (const object of [...scene].reverse()) {
    if (object.type !== GROUP_TYPE || removed.has(object.id)) continue;
    const members = scene.filter((o) => o.parent === object.id);
    if (members.length > 0 && members.every((o) => removed.has(o.id))) {
      removed.add(object.id);
    }
  }
  return scene.filter((o) => removed.has(o.id)).map((o) => o.id);
}
