import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { boundsOf, type Frame } from "./geometry";
import {
  GROUP_TYPE,
  OBJECT_TYPES,
  type ObjectType,
  type StyleKey,
} from "./objectTypes";

export { GROUP_TYPE };

/** CVS-22: кто и когда создал объект и изменил его последним (ISO 8601). */
export interface ObjectMeta {
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/**
 * Объект сцены в `objects` документа (ARCHITECTURE.md, раздел 6): `Y.Map` с полями
 * `type`, `parent`, `x`, `y` (относительно родителя), `width`, `height`, `rotation`
 * (градусы), `z` (порядок слоёв среди объектов того же родителя, целое), свойствами
 * оформления, текстом `text` — `Y.Text`, чтобы одновременные правки текста сливались
 * по символам (COL-01), признаком `locked` (CVS-19) и полями автора и дат (CVS-22).
 * Каждое поле — свой ключ `Y.Map`: правки разных полей одного объекта не затирают друг друга.
 */
export interface SceneObject extends Frame {
  id: string;
  type: string;
  parent: string | null;
  z: number;
  text: string;
  /** Теги объекта (STK-03, KBN-02) — ищутся вместе с текстом (CVS-08). */
  tags: string[];
  style: Partial<Record<StyleKey, string | number>>;
  /** Начало координат родителя на доске; `x`, `y` рамки — уже в координатах доски. */
  origin: Point;
  /**
   * Сдвиг рамки от записанного положения. У группы рамка вычисляется по её объектам,
   * а `x`, `y` в документе — только начало координат детей; у остальных объектов — 0.
   */
  offset: Point;
  /** CVS-19: заблокирован сам объект или его группа. */
  locked: boolean;
  meta: ObjectMeta;
}

/** Изменение рамки и оформления объекта; рамка — в координатах доски. */
export type ObjectPatch = Partial<Frame & Record<StyleKey, string | number>>;

const META_KEYS = ["createdBy", "createdAt", "updatedBy", "updatedAt"] as const;

/** Id объекта: 16 случайных байт. `crypto.randomUUID` недоступен без HTTPS (LAN по http). */
export function newObjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type RawObject = Omit<SceneObject, "origin" | "offset" | "locked"> & {
  lockedSelf: boolean;
};

/**
 * Все объекты сцены в координатах доски в порядке отрисовки: соседи снизу вверх по `z`,
 * группа — перед своими объектами (CVS-17). Неверные записи и пустые группы пропускаются.
 */
export function readScene(objects: Y.Map<unknown>): SceneObject[] {
  const raw = new Map<string, RawObject>();
  for (const [id, value] of objects.entries()) {
    const object = readObject(id, value);
    if (object !== null) raw.set(id, object);
  }
  const children = new Map<string | null, RawObject[]>();
  for (const object of raw.values()) {
    const key = hasValidParent(object, raw) ? object.parent : null;
    const list = children.get(key) ?? [];
    list.push(object);
    children.set(key, list);
  }

  const scene: SceneObject[] = [];
  const visit = (object: RawObject, origin: Point, locked: boolean): void => {
    const position = { x: object.x + origin.x, y: object.y + origin.y };
    const lockedNow = locked || object.lockedSelf;
    const at = scene.length;
    const kids: SceneObject[] = [];
    for (const child of sorted(children.get(object.id))) {
      const before = scene.length;
      visit(child, position, lockedNow);
      const placed = scene[before];
      if (placed?.id === child.id) kids.push(placed);
    }
    let frame: Frame = {
      ...position,
      width: object.width,
      height: object.height,
      rotation: object.rotation,
    };
    if (object.type === GROUP_TYPE) {
      const bounds = boundsOf(kids);
      if (bounds === null) return; // пустая группа не рисуется
      frame = { ...bounds, rotation: 0 };
    }
    const { id, type, parent, z, text, tags, style, meta } = object;
    scene.splice(at, 0, {
      id,
      type,
      parent,
      z,
      text,
      tags,
      style,
      meta,
      ...frame,
      origin,
      offset: { x: frame.x - position.x, y: frame.y - position.y },
      locked: lockedNow,
    });
  };
  for (const root of sorted(children.get(null))) {
    visit(root, { x: 0, y: 0 }, false);
  }
  return scene;
}

function sorted(list: RawObject[] | undefined): RawObject[] {
  return [...(list ?? [])].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

/** Родитель есть в документе и цепочка родителей не замкнута. */
function hasValidParent(
  object: RawObject,
  all: ReadonlyMap<string, RawObject>,
): boolean {
  const seen = new Set([object.id]);
  let parent = object.parent;
  while (parent !== null) {
    const next = all.get(parent);
    if (next === undefined || seen.has(parent)) return false;
    seen.add(parent);
    parent = next.parent;
  }
  return true;
}

function readObject(id: string, value: unknown): RawObject | null {
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
  const meta: ObjectMeta = {};
  for (const key of META_KEYS) {
    const v = record[key];
    if (typeof v === "string") meta[key] = v;
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
    tags: readTags(record.tags),
    style,
    lockedSelf: record.locked === true,
    meta,
  };
}

/**
 * Теги — `Y.Array` строк (после `toJSON` — массив) под ключом `tags`; одинаковые и
 * пустые отбрасываются (docs/decisions.md, T5.5).
 */
function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  return [...new Set(tags)];
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Следующий `z`: новый объект встаёт поверх остальных. Учитываются и объекты,
 * записанные JSON-значением, а не `Y.Map` (BUG-008).
 */
export function topZ(objects: Y.Map<unknown>): number {
  let top = 0;
  for (const value of objects.values()) {
    const z: unknown =
      value instanceof Y.Map
        ? value.get("z")
        : typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).z
          : undefined;
    if (isNumber(z)) top = Math.max(top, Math.ceil(z));
  }
  return top + 1;
}

/** CVS-22: поля «создал» и «изменил» нового объекта. */
export function creationMeta(
  actor: string,
  now: Date = new Date(),
): Required<ObjectMeta> {
  const at = now.toISOString();
  return { createdBy: actor, createdAt: at, updatedBy: actor, updatedAt: at };
}

/** CVS-22: отметка последнего изменения объекта. */
export function touch(
  map: Y.Map<unknown>,
  actor: string,
  now: Date = new Date(),
): void {
  map.set("updatedBy", actor);
  map.set("updatedAt", now.toISOString());
}

/**
 * CVS-09: новый объект типа `type` с левым верхним углом в точке `at` (верхний уровень).
 * `actor` — имя автора (CVS-22). Возвращает id объекта.
 */
export function createObject(
  objects: Y.Map<unknown>,
  type: ObjectType,
  at: Point,
  text = "",
  actor = "",
): string {
  const spec = OBJECT_TYPES[type];
  const id = newObjectId();
  transact(objects, () => {
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
    for (const [key, value] of Object.entries(creationMeta(actor)))
      object.set(key, value);
    objects.set(id, object);
  });
  return id;
}

/** Правки документа одной транзакцией: у других участников они появляются разом. */
export function transact(objects: Y.Map<unknown>, write: () => void): void {
  if (objects.doc === null) write();
  else objects.doc.transact(write);
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
 * Запись полей объектов как есть (`z`, `parent`, `locked`…) одной транзакцией;
 * каждый изменённый объект получает отметку «изменил» (CVS-22).
 */
export function writeFields(
  objects: Y.Map<unknown>,
  changes: ReadonlyMap<string, Record<string, unknown>>,
  actor: string,
): void {
  if (changes.size === 0) return;
  const now = new Date();
  transact(objects, () => {
    for (const [id, fields] of changes) {
      const map = objectMap(objects, id);
      if (map === null) continue;
      for (const [key, value] of Object.entries(fields)) map.set(key, value);
      touch(map, actor, now);
    }
  });
}

/**
 * Изменения рамки и оформления нескольких объектов одной транзакцией. Рамка переводится
 * в координаты относительно родителя; у группы сдвиг рамки двигает начало координат её
 * объектов. `actor` — кто изменил (CVS-22).
 */
export function patchObjects(
  objects: Y.Map<unknown>,
  patches: ReadonlyMap<SceneObject, ObjectPatch>,
  actor = "",
): void {
  const changes = new Map<string, Record<string, unknown>>();
  for (const [object, patch] of patches) {
    const fields: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (key === "x" && typeof value === "number") {
        fields.x = value - object.origin.x - object.offset.x;
      } else if (key === "y" && typeof value === "number") {
        fields.y = value - object.origin.y - object.offset.y;
      } else if (
        object.type !== GROUP_TYPE ||
        (key !== "width" && key !== "height")
      ) {
        fields[key] = value;
      }
    }
    changes.set(object.id, fields);
  }
  writeFields(objects, changes, actor);
}
