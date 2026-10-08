import * as Y from "yjs";
import { writeFields } from "./sceneObjects";

/**
 * CVS-19: блокировка объектов. Заблокированный объект (и всё в заблокированной группе)
 * не двигается, не меняет размер, оформление и текст и не удаляется; ластик (T6.5)
 * тоже его пропускает — признак `locked` лежит в документе и виден всем участникам.
 */
export function setLocked(
  objects: Y.Map<unknown>,
  ids: Iterable<string>,
  locked: boolean,
  actor: string,
): void {
  const changes = new Map<string, Record<string, unknown>>();
  for (const id of ids) changes.set(id, { locked });
  writeFields(objects, changes, actor);
}

/** CVS-19: «разблокировать всё» — снимает блокировку со всех объектов доски. */
export function unlockAll(objects: Y.Map<unknown>, actor: string): void {
  setLocked(objects, lockedIds(objects), false, actor);
}

/** Объекты с собственной блокировкой (не считая вложенных в заблокированную группу). */
export function lockedIds(objects: Y.Map<unknown>): string[] {
  const ids: string[] = [];
  for (const [id, value] of objects.entries()) {
    const locked: unknown =
      value instanceof Y.Map
        ? value.get("locked")
        : typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).locked
          : undefined;
    if (locked === true) ids.push(id);
  }
  return ids;
}
