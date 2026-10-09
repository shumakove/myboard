import * as Y from "yjs";
import { objectMap, touch, transact, writeTags } from "./sceneObjects";

/** Длина тега, символов: длиннее обрезается. */
const MAX_TAG_LENGTH = 40;

/**
 * STK-03: тег из введённого текста — без «#» в начале (формат T5.5), пробелы по краям
 * и подряд схлопываются; пустой — `null`.
 */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH);
  return tag === "" ? null : tag;
}

/** Теги объекта как `Y.Array`; JSON-массив (вставка, старые записи) переводится в него. */
function tagArray(map: Y.Map<unknown>): Y.Array<string> {
  const value = map.get("tags");
  if (value instanceof Y.Array) return value as Y.Array<string>;
  writeTags(
    map,
    Array.isArray(value)
      ? value.filter((tag): tag is string => typeof tag === "string")
      : [],
  );
  return map.get("tags") as Y.Array<string>;
}

/** STK-03: добавить тег объекту; повтор не добавляется. `false` — тег пустой. */
export function addTag(
  objects: Y.Map<unknown>,
  id: string,
  raw: string,
  actor: string,
): boolean {
  const tag = normalizeTag(raw);
  const map = objectMap(objects, id);
  if (tag === null || map === null) return false;
  transact(objects, () => {
    const tags = tagArray(map);
    if (tags.toArray().includes(tag)) return;
    tags.push([tag]);
    touch(map, actor);
  });
  return true;
}

/** STK-03: убрать тег у объекта (все его повторы). */
export function removeTag(
  objects: Y.Map<unknown>,
  id: string,
  tag: string,
  actor: string,
): void {
  const map = objectMap(objects, id);
  if (map === null) return;
  transact(objects, () => {
    const tags = tagArray(map);
    const values = tags.toArray();
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (values[i]?.trim() === tag) tags.delete(i, 1);
    }
    touch(map, actor);
  });
}
