import type { CSSProperties } from "react";
import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import {
  createNode,
  MINDMAP_TYPE,
  NEW_CHILD_TEXTS,
  NEW_ROOT_TEXT,
  nodeId,
  nodeMap,
  nodeMaps,
  readMindmap,
  ROOT_COLOR,
  subtree,
  type MindmapShape,
  type NodeDrop,
} from "./mindmapData";
import {
  createObject,
  objectMap,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

export { MINDMAP_TYPE };

/**
 * Интеллект-карта (T6.9) на доске: создание с корнем и дочерними узлами (MAP-01),
 * добавление, перекраска, удаление и перестановка узлов (MAP-02), сворачивание веток
 * (MAP-03), перекраска с потомками или без (MAP-04). Каждая операция — одна транзакция
 * документа с отметкой «изменил» у карты (CVS-22).
 */

/**
 * MAP-01: новая карта с левым верхним углом в `at`: корень и два дочерних узла.
 * Возвращает id карты.
 */
export function createMindmap(
  objects: Y.Map<unknown>,
  at: Point,
  actor: string,
): string {
  let id = "";
  transact(objects, () => {
    // Записанное положение — середина левого края корня (mindmapData.ts).
    id = createObject(objects, MINDMAP_TYPE, at, "", actor);
    const map = objectMap(objects, id);
    if (map === null) return;
    map.delete("text"); // своего текста нет — только названия узлов
    const root = nodeId();
    const nodes = new Y.Map<Y.Map<unknown>>();
    nodes.set(
      root,
      createNode({
        parent: null,
        order: 0,
        text: NEW_ROOT_TEXT,
        color: ROOT_COLOR,
      }),
    );
    NEW_CHILD_TEXTS.forEach((text, order) => {
      nodes.set(
        nodeId(),
        createNode({ parent: root, order, text, color: ROOT_COLOR }),
      );
    });
    map.set("root", root);
    map.set("nodes", nodes);
    // Корень — по центру своих детей: верх рамки в `at`, корень ниже на `anchorY`.
    const shape = readMindmap(map.toJSON());
    if (shape !== null) map.set("y", at.y + shape.anchorY);
  });
  return id;
}

/** Карта как `Y.Map` и её раскладка; карты нет — `null`. */
function mindmapOf(
  objects: Y.Map<unknown>,
  id: string,
): { map: Y.Map<unknown>; shape: MindmapShape } | null {
  const map = objectMap(objects, id);
  if (map === null) return null;
  const shape = readMindmap(map.toJSON());
  return shape === null ? null : { map, shape };
}

function readShape(objects: Y.Map<unknown>, id: string): MindmapShape | null {
  return mindmapOf(objects, id)?.shape ?? null;
}

/** Правка карты одной транзакцией с отметкой «изменил». */
function edit<T>(
  objects: Y.Map<unknown>,
  id: string,
  actor: string,
  write: (map: Y.Map<unknown>, shape: MindmapShape) => T | null,
): T | null {
  const found = mindmapOf(objects, id);
  if (found === null) return null;
  let result: T | null = null;
  transact(objects, () => {
    result = write(found.map, found.shape);
    if (result !== null) touch(found.map, actor);
  });
  return result;
}

/** Порядок между соседями `before` и `after` (любой из них может отсутствовать). */
function orderBetween(before?: number, after?: number): number {
  if (before === undefined) return after === undefined ? 0 : after - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}

function orderOf(map: Y.Map<unknown>, id: string): number | undefined {
  const value = nodeMap(map, id)?.get("order");
  return typeof value === "number" ? value : undefined;
}

/**
 * MAP-01, MAP-02: новый дочерний узел в конце детей `parent` с цветом родителя;
 * свёрнутая ветка родителя раскрывается, чтобы узел был виден. Возвращает id узла.
 */
export function addChild(
  objects: Y.Map<unknown>,
  mindmap: string,
  parent: string,
  actor: string,
): string | null {
  return edit(objects, mindmap, actor, (map, shape) => {
    const node = shape.byId.get(parent);
    const parentMap = nodeMap(map, parent);
    if (node === undefined || parentMap === null) return null;
    const last = node.children.at(-1);
    const id = nodeId();
    nodeMaps(map).set(
      id,
      createNode({
        parent,
        order: orderBetween(
          last === undefined ? undefined : orderOf(map, last),
        ),
        text: "",
        color: node.color,
      }),
    );
    if (node.collapsed) parentMap.set("collapsed", false);
    return id;
  });
}

/** MAP-02: новый узел сразу после `sibling` с его цветом; у корня — дочерний узел. */
export function addSibling(
  objects: Y.Map<unknown>,
  mindmap: string,
  sibling: string,
  actor: string,
): string | null {
  const shape = readShape(objects, mindmap);
  const node = shape?.byId.get(sibling);
  if (shape == null || node === undefined) return null;
  if (node.parent === null) return addChild(objects, mindmap, sibling, actor);
  const parent = node.parent;
  return edit(objects, mindmap, actor, (map) => {
    const id = nodeId();
    nodeMaps(map).set(
      id,
      createNode({
        parent,
        order: orderAfter(map, shape, sibling),
        text: "",
        color: node.color,
      }),
    );
    return id;
  });
}

/** Порядок сразу после узла `id` среди его братьев. */
function orderAfter(
  map: Y.Map<unknown>,
  shape: MindmapShape,
  id: string,
  skip?: string,
): number {
  const parent = shape.byId.get(shape.byId.get(id)?.parent ?? "");
  const siblings = (parent?.children ?? []).filter((s) => s !== skip);
  const next = siblings[siblings.indexOf(id) + 1];
  return orderBetween(
    orderOf(map, id),
    next === undefined ? undefined : orderOf(map, next),
  );
}

/** Порядок сразу перед узлом `id` среди его братьев. */
function orderBefore(
  map: Y.Map<unknown>,
  shape: MindmapShape,
  id: string,
  skip?: string,
): number {
  const parent = shape.byId.get(shape.byId.get(id)?.parent ?? "");
  const siblings = (parent?.children ?? []).filter((s) => s !== skip);
  const previous = siblings[siblings.indexOf(id) - 1];
  return orderBetween(
    previous === undefined ? undefined : orderOf(map, previous),
    orderOf(map, id),
  );
}

/**
 * MAP-02, MAP-04: перекрасить узел; `withChildren` — и все узлы под ним (в том числе
 * в свёрнутых ветках).
 */
export function recolorNode(
  objects: Y.Map<unknown>,
  mindmap: string,
  id: string,
  color: string,
  withChildren: boolean,
  actor: string,
): void {
  edit(objects, mindmap, actor, (map, shape) => {
    const ids = withChildren ? subtree(shape, id) : [id];
    for (const target of ids) nodeMap(map, target)?.set("color", color);
    return ids.length > 0 ? true : null;
  });
}

/** MAP-02: удалить узел вместе с его веткой; корень не удаляется (удаляют саму карту). */
export function deleteNode(
  objects: Y.Map<unknown>,
  mindmap: string,
  id: string,
  actor: string,
): void {
  edit(objects, mindmap, actor, (map, shape) => {
    if (id === shape.root || !shape.byId.has(id)) return null;
    const nodes = nodeMaps(map);
    for (const target of subtree(shape, id)) nodes.delete(target);
    return true;
  });
}

/** MAP-03: свернуть или развернуть ветку узла (и корня). */
export function toggleNode(
  objects: Y.Map<unknown>,
  mindmap: string,
  id: string,
  actor: string,
): void {
  edit(objects, mindmap, actor, (map, shape) => {
    const node = shape.byId.get(id);
    if (node === undefined || node.children.length === 0) return null;
    nodeMap(map, id)?.set("collapsed", !node.collapsed);
    return true;
  });
}

/**
 * MAP-02: перестановка перетаскиванием — узел (с веткой) встаёт в конец детей цели
 * (свёрнутая цель раскрывается) или перед ней и после неё среди её братьев. Корень
 * не переносится; узел не кладётся в свою же ветку.
 */
export function moveNode(
  objects: Y.Map<unknown>,
  mindmap: string,
  id: string,
  drop: NodeDrop,
  actor: string,
): void {
  edit(objects, mindmap, actor, (map, shape) => {
    const node = nodeMap(map, id);
    const target = shape.byId.get(drop.target);
    if (id === shape.root || node === null || target === undefined) return null;
    if (subtree(shape, id).includes(drop.target)) return null;
    if (drop.place === "child" || target.parent === null) {
      const last = target.children.filter((kid) => kid !== id).at(-1);
      node.set("parent", target.id);
      node.set(
        "order",
        orderBetween(last === undefined ? undefined : orderOf(map, last)),
      );
      if (target.collapsed) nodeMap(map, target.id)?.set("collapsed", false);
      return true;
    }
    const order =
      drop.place === "before"
        ? orderBefore(map, shape, target.id, id)
        : orderAfter(map, shape, target.id, id);
    node.set("parent", target.parent);
    node.set("order", order);
    return true;
  });
}

/** Поле правки названия узла (MAP-02) — поверх узла. */
export function nodeEditorStyle(
  object: SceneObject,
  node: string,
): CSSProperties | null {
  const found = object.mindmap?.byId.get(node);
  if (found === undefined || !object.mindmap?.nodes.includes(found)) {
    return null;
  }
  return {
    left: object.x + found.x,
    top: object.y + found.y,
    width: found.width,
    height: found.height,
  };
}
