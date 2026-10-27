import * as Y from "yjs";
import type { Point } from "../realtime/messages";

/**
 * Интеллект-карта (T6.9, MAP-01…MAP-04) в документе — поля `Y.Map` объекта
 * `type: "mindmap"`:
 * - `root` — id корневого узла;
 * - `nodes` — `Y.Map` id узла → `Y.Map` с полями `parent` (id родителя; у корня `null`),
 *   `order` (порядок среди братьев, дробное число — вставка между соседями не трогает их),
 *   `text` (`Y.Text`: правки названия сливаются по символам), `color`, `collapsed`.
 * Каждый узел — свой `Y.Map`: одновременные правки разных узлов и полей не затирают
 * друг друга. Положение узлов не хранится — раскладка дерева вычисляется (`readMindmap`).
 * `x`, `y` объекта — левый край корня по середине его высоты: корень стоит на месте,
 * когда дерево растёт или сворачивается.
 */

export const MINDMAP_TYPE = "mindmap";

/** Высота узла и корня, единицы доски. */
export const NODE_HEIGHT = 40;
export const ROOT_HEIGHT = 56;
/** Ширина узла: по длине названия в этих пределах (длинное название обрезается). */
export const NODE_MIN_WIDTH = 96;
export const NODE_MAX_WIDTH = 280;
/** Промежуток между уровнями и между соседними ветками. */
export const LEVEL_GAP = 56;
export const SIBLING_GAP = 12;
/** Кнопка сворачивания ветки справа от узла (MAP-03). */
export const TOGGLE_SIZE = 20;

/** Цвет корня и узлов новой карты; дочерний узел берёт цвет родителя. */
export const ROOT_COLOR = "#81d4fa";
/** Названия новой карты (MAP-01). */
export const NEW_ROOT_TEXT = "Main topic";
export const NEW_CHILD_TEXTS: readonly string[] = ["Idea 1", "Idea 2"];

/** Узел карты на холсте; `x`, `y` — относительно левого верхнего угла карты. */
export interface MindmapNode {
  id: string;
  /** Родитель после восстановления дерева; у корня `null`. */
  parent: string | null;
  text: string;
  color: string;
  collapsed: boolean;
  /** Дети по порядку (и у свёрнутого узла). */
  children: string[];
  /** Сколько всего узлов под этим узлом. */
  descendants: number;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Карта на сцене: видимые узлы сверху вниз в порядке обхода дерева и размер рамки. */
export interface MindmapShape {
  root: string;
  /** Видимые узлы (не под свёрнутым предком), корень первым. */
  nodes: MindmapNode[];
  /** Все узлы по id, и скрытые свёрнутыми ветками. */
  byId: ReadonlyMap<string, MindmapNode>;
  width: number;
  height: number;
  /** Середина корня по высоте от верха карты: здесь записанное `y` объекта. */
  anchorY: number;
}

/** Куда положить перетаскиваемый узел: в конец детей цели, перед ней или после неё. */
export type DropPlace = "child" | "before" | "after";

export interface NodeDrop {
  target: string;
  place: DropPlace;
}

interface NodeRecord {
  parent: string | null;
  order: number;
  text: string;
  color: string;
  collapsed: boolean;
}

/** Id нового узла. */
export function nodeId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Ширина узла по длине названия. */
export function nodeWidth(text: string, root: boolean): number {
  const perChar = root ? 11 : 8.5;
  const width = Math.ceil(Math.max(text.length, 6) * perChar + 32);
  return Math.min(NODE_MAX_WIDTH, Math.max(NODE_MIN_WIDTH, width));
}

/**
 * Карта из полей объекта (JSON `Y.Map`); без корня — `null`. Узел, чья цепочка родителей
 * не доходит до корня (родителя удалили или два участника одновременно вложили узлы друг
 * в друга), показывается дочерним узлом корня — ничего не пропадает.
 */
export function readMindmap(
  record: Record<string, unknown>,
): MindmapShape | null {
  const records = new Map<string, NodeRecord>();
  for (const [id, value] of Object.entries(asRecord(record.nodes))) {
    const node = readNode(value);
    if (node !== null) records.set(id, node);
  }
  const root = typeof record.root === "string" ? record.root : null;
  if (root === null || !records.has(root)) return null;

  const children = new Map<string, string[]>();
  for (const [id, node] of records) {
    if (id === root) continue;
    const parent = reachesRoot(id, records, root) ? node.parent : root;
    const list = children.get(parent ?? root) ?? [];
    list.push(id);
    children.set(parent ?? root, list);
  }
  const order = (a: string, b: string) =>
    (records.get(a)?.order ?? 0) - (records.get(b)?.order ?? 0) ||
    (a < b ? -1 : 1);
  for (const list of children.values()) list.sort(order);

  const byId = new Map<string, MindmapNode>();
  const build = (
    id: string,
    parent: string | null,
    depth: number,
  ): MindmapNode => {
    const data = records.get(id) as NodeRecord;
    const kids = children.get(id) ?? [];
    const node: MindmapNode = {
      id,
      parent,
      text: data.text,
      color: data.color,
      collapsed: data.collapsed,
      children: kids,
      descendants: 0,
      depth,
      x: 0,
      y: 0,
      width: nodeWidth(data.text, depth === 0),
      height: depth === 0 ? ROOT_HEIGHT : NODE_HEIGHT,
    };
    byId.set(id, node);
    for (const kid of kids) {
      node.descendants += build(kid, id, depth + 1).descendants + 1;
    }
    return node;
  };
  const rootNode = build(root, null, 0);

  const visible: MindmapNode[] = [];
  const heights = new Map<string, number>();
  const shown = (node: MindmapNode) => (node.collapsed ? [] : node.children);
  const branchHeight = (node: MindmapNode): number => {
    const kids = shown(node).map((id) => byId.get(id) as MindmapNode);
    const sum =
      kids.reduce((total, kid) => total + branchHeight(kid), 0) +
      Math.max(0, kids.length - 1) * SIBLING_GAP;
    const height = Math.max(node.height, sum);
    heights.set(node.id, height);
    return height;
  };
  const place = (node: MindmapNode, x: number, top: number): void => {
    const height = heights.get(node.id) ?? node.height;
    node.x = x;
    node.y = top + (height - node.height) / 2;
    visible.push(node);
    const kids = shown(node).map((id) => byId.get(id) as MindmapNode);
    const sum =
      kids.reduce((total, kid) => total + (heights.get(kid.id) ?? 0), 0) +
      Math.max(0, kids.length - 1) * SIBLING_GAP;
    let y = top + (height - sum) / 2;
    for (const kid of kids) {
      place(kid, x + node.width + LEVEL_GAP, y);
      y += (heights.get(kid.id) ?? 0) + SIBLING_GAP;
    }
  };
  const height = branchHeight(rootNode);
  place(rootNode, 0, 0);
  const width = Math.max(
    ...visible.map(
      (n) => n.x + n.width + (n.children.length > 0 ? TOGGLE_SIZE + 4 : 0),
    ),
  );
  return {
    root,
    nodes: visible,
    byId,
    width,
    height,
    anchorY: rootNode.y + rootNode.height / 2,
  };
}

/** Узел id и все узлы под ним (и в свёрнутых ветках). */
export function subtree(shape: MindmapShape, id: string): string[] {
  const node = shape.byId.get(id);
  if (node === undefined) return [];
  return [id, ...node.children.flatMap((kid) => subtree(shape, kid))];
}

/**
 * MAP-02: куда упадёт узел `dragged`, отпущенный в точке `point` (относительно карты):
 * верхняя и нижняя четверти узла — перед ним и после него, середина и корень — в конец
 * его детей. Сам узел и его ветка целью не бывают — `null`.
 */
export function dropAt(
  shape: MindmapShape,
  dragged: string,
  point: Point,
): NodeDrop | null {
  const excluded = new Set(subtree(shape, dragged));
  for (const node of shape.nodes) {
    if (excluded.has(node.id)) continue;
    const inside =
      point.x >= node.x &&
      point.x <= node.x + node.width &&
      point.y >= node.y &&
      point.y <= node.y + node.height;
    if (!inside) continue;
    if (node.parent === null) return { target: node.id, place: "child" };
    const quarter = node.height / 4;
    if (point.y < node.y + quarter) return { target: node.id, place: "before" };
    if (point.y > node.y + node.height - quarter) {
      return { target: node.id, place: "after" };
    }
    return { target: node.id, place: "child" };
  }
  return null;
}

/** Узлы карты как `Y.Map`; JSON-запись переводится в него. */
export function nodeMaps(mindmap: Y.Map<unknown>): Y.Map<Y.Map<unknown>> {
  const value = mindmap.get("nodes");
  if (value instanceof Y.Map) return value as Y.Map<Y.Map<unknown>>;
  const nodes = mindmapFieldValue("nodes", value) as Y.Map<Y.Map<unknown>>;
  mindmap.set("nodes", nodes);
  return nodes;
}

/** `Y.Map` узла; узла нет — `null`. JSON-запись узла переводится в `Y.Map`. */
export function nodeMap(
  mindmap: Y.Map<unknown>,
  id: string,
): Y.Map<unknown> | null {
  const nodes = nodeMaps(mindmap);
  const value: unknown = nodes.get(id);
  if (value instanceof Y.Map) return value as Y.Map<unknown>;
  const node = newNode(readNode(value));
  if (node === null) return null;
  nodes.set(id, node);
  return node;
}

/** Название узла для правки (`Y.Text`); поле создаётся, если его не было (MAP-02). */
export function nodeText(mindmap: Y.Map<unknown>, id: string): Y.Text | null {
  const node = nodeMap(mindmap, id);
  if (node === null) return null;
  const text = node.get("text");
  if (text instanceof Y.Text) return text;
  const created = new Y.Text(typeof text === "string" ? text : "");
  node.set("text", created);
  return created;
}

/** Новый `Y.Map` узла из его полей. */
export function createNode(fields: {
  parent: string | null;
  order: number;
  text: string;
  color: string;
}): Y.Map<unknown> {
  return newNode({ ...fields, collapsed: false }) as Y.Map<unknown>;
}

/**
 * Поле карты из JSON (вставка копии, CVS-20): `nodes` — `Y.Map` узлов с `Y.Text`
 * названиями. Другое поле — `undefined`.
 */
export function mindmapFieldValue(key: string, value: unknown): unknown {
  if (key !== "nodes") return undefined;
  const nodes = new Y.Map<Y.Map<unknown>>();
  for (const [id, data] of Object.entries(asRecord(value))) {
    const node = newNode(readNode(data));
    if (node !== null) nodes.set(id, node);
  }
  return nodes;
}

function newNode(record: NodeRecord | null): Y.Map<unknown> | null {
  if (record === null) return null;
  const node = new Y.Map<unknown>();
  node.set("parent", record.parent);
  node.set("order", record.order);
  node.set("text", new Y.Text(record.text));
  node.set("color", record.color);
  node.set("collapsed", record.collapsed);
  return node;
}

function readNode(value: unknown): NodeRecord | null {
  const data: unknown = value instanceof Y.Map ? value.toJSON() : value;
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return null;
  }
  const record = data as Record<string, unknown>;
  return {
    parent: typeof record.parent === "string" ? record.parent : null,
    order:
      typeof record.order === "number" && Number.isFinite(record.order)
        ? record.order
        : 0,
    text: typeof record.text === "string" ? record.text : "",
    color: typeof record.color === "string" ? record.color : ROOT_COLOR,
    collapsed: record.collapsed === true,
  };
}

/** Цепочка родителей узла доходит до корня без петель. */
function reachesRoot(
  id: string,
  records: ReadonlyMap<string, NodeRecord>,
  root: string,
): boolean {
  const seen = new Set([id]);
  let parent = records.get(id)?.parent ?? null;
  while (parent !== null) {
    if (parent === root) return true;
    if (seen.has(parent) || !records.has(parent)) return false;
    seen.add(parent);
    parent = records.get(parent)?.parent ?? null;
  }
  return false;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
