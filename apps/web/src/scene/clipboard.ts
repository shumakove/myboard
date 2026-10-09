import * as Y from "yjs";
import type { Rect } from "../canvas/camera";
import type { Point } from "../realtime/messages";
import { isRich, parseDelta, plainText, type DeltaOp } from "../richtext/delta";
import { deltaToHtml } from "../richtext/html";
import { boundsOf, snap } from "./geometry";
import { topmost, withDescendants } from "./groups";
import { isRichText } from "./objectTypes";
import {
  creationMeta,
  isNumber,
  newObjectId,
  topZ,
  transact,
  type SceneObject,
} from "./sceneObjects";

/**
 * CVS-20: копирование, вырезание, дублирование и вставка объектов — на этой доске
 * и между досками. Копия — JSON полей объектов: корни с координатами доски, вложенные
 * объекты групп — относительно своего родителя. Текст с форматированием (текст
 * и документ, TXT-01…TXT-06) копируется дельтой, остальной текст — строкой.
 * TXT-07: для внешних редакторов копия — ещё и HTML с форматированием и простой текст.
 */

/** Тип данных копии в системном буфере обмена (событие copy/paste). */
export const CLIPBOARD_MIME = "application/x-myboard-objects";
/** Последняя копия в браузере — для пункта Paste и для вставки на другой доске. */
const STORAGE_KEY = "myboard.clipboard";
const FORMAT = "myboard/objects";
/** Больше объектов из чужих данных вставка не берёт. */
const MAX_OBJECTS = 5000;
/** Сдвиг дубликата от оригинала, единицы доски. */
export const DUPLICATE_OFFSET = 20;

/** Поля, которые копия не переносит: у копии свой автор, даты и нет блокировки. */
const SKIPPED = new Set([
  "parent",
  "locked",
  "createdBy",
  "createdAt",
  "updatedBy",
  "updatedAt",
]);

interface ClipObject {
  id: string;
  parent: string | null;
  fields: Record<string, unknown>;
}

export interface Clip {
  format: typeof FORMAT;
  objects: ClipObject[];
  /** Общая рамка корней на доске-источнике. */
  bounds: Rect;
}

/** Копия выделенных объектов вместе с вложенными; `null` — копировать нечего. */
export function copyObjects(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  ids: readonly string[],
): Clip | null {
  const roots = topmost(scene, ids);
  const bounds = boundsOf(roots);
  if (bounds === null) return null;
  const rootIds = new Set(roots.map((o) => o.id));
  const copied = withDescendants(
    scene,
    roots.map((o) => o.id),
  ).flatMap((object) => {
    const value = objects.get(object.id);
    const data: unknown = value instanceof Y.Map ? value.toJSON() : value;
    if (typeof data !== "object" || data === null) return [];
    const fields: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(data)) {
      if (!SKIPPED.has(key)) fields[key] = field;
    }
    const rich = richField(value, object.type);
    if (rich !== null) fields.text = rich;
    const root = rootIds.has(object.id);
    if (root) {
      // Корень — в координатах доски: у группы это начало координат её объектов.
      fields.x = object.x - object.offset.x;
      fields.y = object.y - object.offset.y;
    }
    return [{ id: object.id, parent: root ? null : object.parent, fields }];
  });
  return { format: FORMAT, objects: copied, bounds };
}

/** Дельта текста с форматированием; простой текст и прочие типы — `null`. */
function richField(value: unknown, type: string): DeltaOp[] | null {
  if (!(value instanceof Y.Map) || !isRichText(type)) return null;
  const text: unknown = value.get("text");
  if (!(text instanceof Y.Text)) return null;
  const delta = text.toDelta() as DeltaOp[];
  return isRich(delta) ? delta : null;
}

/** Текст объекта копии как дельта; без текста — `null`. */
function textOf(object: ClipObject): DeltaOp[] | null {
  const { text } = object.fields;
  if (typeof text === "string") return text === "" ? null : [{ insert: text }];
  return parseDelta(text);
}

/** Простой текст копии — для вставки в другие программы (CVS-20, TXT-07). */
export function clipText(
  clip: Clip,
  label: (id: string) => string = () => "",
): string {
  return clip.objects
    .map(textOf)
    .filter((delta) => delta !== null)
    .map((delta) => plainText(delta, label).replace(/\n+$/, ""))
    .filter((text) => text !== "")
    .join("\n");
}

/**
 * TXT-07: копия как HTML — заголовки, списки, ссылки и начертание сохраняются при
 * вставке во внешний редактор; текст каждого объекта — своими абзацами.
 */
export function clipHtml(
  clip: Clip,
  label: (id: string) => string = () => "",
): string {
  return clip.objects
    .map(textOf)
    .filter((delta) => delta !== null)
    .map((delta) => deltaToHtml(delta, label))
    .join("");
}

/** Разбор копии из буфера или хранилища; чужие и испорченные данные — `null`. */
export function parseClip(text: string | null | undefined): Clip | null {
  if (!text) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const { format, objects, bounds } = data as Record<string, unknown>;
  if (format !== FORMAT || !Array.isArray(objects) || !isRect(bounds)) {
    return null;
  }
  const valid = objects
    .slice(0, MAX_OBJECTS)
    .filter((o): o is ClipObject => isClipObject(o));
  return valid.length > 0 ? { format: FORMAT, objects: valid, bounds } : null;
}

function isClipObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { id, parent, fields } = value as Record<string, unknown>;
  if (typeof id !== "string") return false;
  if (parent !== null && typeof parent !== "string") return false;
  if (typeof fields !== "object" || fields === null) return false;
  const { type, x, y, width, height } = fields as Record<string, unknown>;
  return (
    typeof type === "string" &&
    isNumber(x) &&
    isNumber(y) &&
    isNumber(width) &&
    isNumber(height)
  );
}

function isRect(value: unknown): value is Rect {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, width, height } = value as Record<string, unknown>;
  return isNumber(x) && isNumber(y) && isNumber(width) && isNumber(height);
}

/** Куда вставить копию. */
export type PastePlace =
  /** Центр копии — в точку доски, угол прилипает к сетке. */
  | { kind: "at"; point: Point; gridStep: number }
  /** Рядом с оригиналом (дублирование) — в том же родителе. */
  | { kind: "offset"; offset: Point; parent: SceneObject | null };

/**
 * CVS-20: вставка копии новыми объектами поверх остальных. Автор и даты — у вставившего
 * (CVS-22), блокировка не переносится. Возвращает id вставленных корней.
 */
export function pasteObjects(
  objects: Y.Map<unknown>,
  clip: Clip,
  place: PastePlace,
  actor: string,
): string[] {
  const ids = new Map(clip.objects.map((o) => [o.id, newObjectId()]));
  let shift: Point;
  let parent: string | null = null;
  let parentAnchor: Point = { x: 0, y: 0 };
  if (place.kind === "at") {
    const { bounds } = clip;
    shift = {
      x: snap(place.point.x - bounds.width / 2, place.gridStep) - bounds.x,
      y: snap(place.point.y - bounds.height / 2, place.gridStep) - bounds.y,
    };
  } else {
    shift = place.offset;
    if (place.parent !== null) {
      parent = place.parent.id;
      parentAnchor = {
        x: place.parent.x - place.parent.offset.x,
        y: place.parent.y - place.parent.offset.y,
      };
    }
  }
  const roots: string[] = [];
  const meta = creationMeta(actor);
  transact(objects, () => {
    let z = topZ(objects);
    const ordered = [...clip.objects].sort((a, b) => zOf(a) - zOf(b));
    for (const source of ordered) {
      const id = ids.get(source.id) as string;
      const sourceParent =
        source.parent === null ? undefined : ids.get(source.parent);
      const root = sourceParent === undefined;
      const map = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(source.fields)) {
        if (SKIPPED.has(key)) continue;
        map.set(key, key === "text" ? textField(value) : value);
      }
      if (root) {
        map.set("x", Number(source.fields.x) + shift.x - parentAnchor.x);
        map.set("y", Number(source.fields.y) + shift.y - parentAnchor.y);
        map.set("z", z++);
        roots.push(id);
      }
      map.set("parent", root ? parent : sourceParent);
      for (const [key, value] of Object.entries(meta)) map.set(key, value);
      objects.set(id, map);
    }
  });
  return roots;
}

/** Текст вставленного объекта — `Y.Text` (с форматированием, если копия — дельта). */
function textField(value: unknown): unknown {
  if (typeof value === "string") return new Y.Text(value);
  const delta = parseDelta(value);
  if (delta === null) return value;
  const text = new Y.Text();
  text.applyDelta(delta);
  return text;
}

function zOf(object: ClipObject): number {
  return isNumber(object.fields.z) ? object.fields.z : 0;
}

/** Последняя копия этого браузера; хранилище может быть недоступно. */
export function loadClip(): Clip | null {
  try {
    return parseClip(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveClip(clip: Clip): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clip));
  } catch {
    // Без хранилища копия остаётся только в системном буфере.
  }
}
