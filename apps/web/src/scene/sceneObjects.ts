import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { Frame } from "./geometry";
import { OBJECT_TYPES, type ObjectType, type StyleKey } from "./objectTypes";

/**
 * Объект сцены в `objects` документа (ARCHITECTURE.md, раздел 6): `Y.Map` с полями
 * `type`, `parent`, `x`, `y` (относительно родителя), `width`, `height`, `rotation`
 * (градусы), `z` (порядок слоёв, целое), свойствами оформления и текстом `text` — `Y.Text`,
 * чтобы одновременные правки текста сливались по символам (COL-01). Каждое поле — свой
 * ключ `Y.Map`: правки разных полей одного объекта не затирают друг друга.
 */
export interface SceneObject extends Frame {
  id: string;
  type: string;
  parent: string | null;
  z: number;
  text: string;
  style: Partial<Record<StyleKey, string | number>>;
  /** Начало координат родителя на доске; `x`, `y` рамки — уже в координатах доски. */
  origin: Point;
}

/** Изменение рамки и оформления объекта; рамка — в координатах доски. */
export type ObjectPatch = Partial<Frame & Record<StyleKey, string | number>>;

/** Id объекта: 16 случайных байт. `crypto.randomUUID` недоступен без HTTPS (LAN по http). */
export function newObjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Все объекты сцены в координатах доски, снизу вверх по `z`. Неверные записи пропускаются. */
export function readScene(objects: Y.Map<unknown>): SceneObject[] {
  const raw = new Map<string, Omit<SceneObject, "origin">>();
  for (const [id, value] of objects.entries()) {
    const object = readObject(id, value);
    if (object !== null) raw.set(id, object);
  }
  const scene = [...raw.values()].map((object) => {
    const origin = originOf(object, raw);
    return {
      ...object,
      x: object.x + origin.x,
      y: object.y + origin.y,
      origin,
    };
  });
  return scene.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

/** Начало координат родителя: сумма позиций предков (цикл и потерянный родитель — 0). */
function originOf(
  object: Omit<SceneObject, "origin">,
  all: Map<string, Omit<SceneObject, "origin">>,
): Point {
  const origin = { x: 0, y: 0 };
  const seen = new Set([object.id]);
  let parent = object.parent === null ? undefined : all.get(object.parent);
  while (parent !== undefined && !seen.has(parent.id)) {
    seen.add(parent.id);
    origin.x += parent.x;
    origin.y += parent.y;
    parent = parent.parent === null ? undefined : all.get(parent.parent);
  }
  return origin;
}

function readObject(
  id: string,
  value: unknown,
): Omit<SceneObject, "origin"> | null {
  const data: unknown = value instanceof Y.Map ? value.toJSON() : value;
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const { type, x, y, width, height } = record;
  if (
    typeof type !== "string" ||
    !isNumber(x) ||
    !isNumber(y) ||
    !isNumber(width) ||
    !isNumber(height)
  ) {
    return null;
  }
  const style: SceneObject["style"] = {};
  for (const key of ["fill", "stroke", "color", "fontSize"] as const) {
    const v = record[key];
    if (typeof v === "string" || isNumber(v)) style[key] = v;
  }
  return {
    id,
    type,
    parent: typeof record.parent === "string" ? record.parent : null,
    x,
    y,
    width,
    height,
    rotation: isNumber(record.rotation) ? record.rotation : 0,
    z: isNumber(record.z) ? record.z : 0,
    text: typeof record.text === "string" ? record.text : "",
    style,
  };
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Следующий `z`: новый объект встаёт поверх остальных. */
function topZ(objects: Y.Map<unknown>): number {
  let top = 0;
  for (const value of objects.values()) {
    const z: unknown = value instanceof Y.Map ? value.get("z") : undefined;
    if (isNumber(z)) top = Math.max(top, Math.ceil(z));
  }
  return top + 1;
}

/**
 * CVS-09: новый объект типа `type` с левым верхним углом в точке `at` (верхний уровень).
 * Возвращает id объекта.
 */
export function createObject(
  objects: Y.Map<unknown>,
  type: ObjectType,
  at: Point,
  text = "",
): string {
  const spec = OBJECT_TYPES[type];
  const id = newObjectId();
  const doc = objects.doc;
  const write = () => {
    const object = new Y.Map<unknown>();
    object.set("type", type);
    object.set("parent", null);
    object.set("x", at.x);
    object.set("y", at.y);
    object.set("width", spec.width);
    object.set("height", spec.height);
    object.set("rotation", 0);
    object.set("z", topZ(objects));
    for (const [key, value] of Object.entries(spec.style))
      object.set(key, value);
    object.set("text", new Y.Text(text));
    objects.set(id, object);
  };
  if (doc === null) write();
  else doc.transact(write);
  return id;
}

/**
 * Объект как `Y.Map`: запись JSON (например, записанная до T5.2) переводится в `Y.Map`,
 * текст — в `Y.Text`. `null` — объекта нет.
 */
export function objectMap(
  objects: Y.Map<unknown>,
  id: string,
): Y.Map<unknown> | null {
  const value = objects.get(id);
  if (value instanceof Y.Map) return value as Y.Map<unknown>;
  if (typeof value !== "object" || value === null) return null;
  const map = new Y.Map<unknown>();
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    map.set(
      key,
      key === "text" && typeof field === "string" ? new Y.Text(field) : field,
    );
  }
  objects.set(id, map);
  return map;
}

/** Текст объекта для редактирования; поле создаётся, если его не было. */
export function objectText(objects: Y.Map<unknown>, id: string): Y.Text | null {
  const map = objectMap(objects, id);
  if (map === null) return null;
  const text = map.get("text");
  if (text instanceof Y.Text) return text;
  const created = new Y.Text(typeof text === "string" ? text : "");
  map.set("text", created);
  return created;
}

/**
 * Изменения рамки и оформления нескольких объектов одной транзакцией: у других участников
 * они появляются разом. Рамка переводится в координаты относительно родителя.
 */
export function patchObjects(
  objects: Y.Map<unknown>,
  patches: ReadonlyMap<SceneObject, ObjectPatch>,
): void {
  const write = () => {
    for (const [object, patch] of patches) {
      const map = objectMap(objects, object.id);
      if (map === null) continue;
      for (const [key, value] of Object.entries(patch)) {
        if (key === "x" && typeof value === "number") {
          map.set(key, value - object.origin.x);
        } else if (key === "y" && typeof value === "number") {
          map.set(key, value - object.origin.y);
        } else {
          map.set(key, value);
        }
      }
    }
  };
  if (objects.doc === null) write();
  else objects.doc.transact(write);
}
