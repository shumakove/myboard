import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type * as Y from "yjs";
import { contentHeight } from "../richtext/measure";
import { objectMap, writeFields } from "./sceneObjects";
import { fittedHeight } from "./textHeight";
import type { UndoHistory } from "./undoHistory";

/**
 * TXT-01, TXT-08 (BUG-011): рамка текста и документа следует за содержимым после команд,
 * меняющих его вид без редактора, — смены шрифта, размера, интервала и вставки HTML.
 * Высоту подгоняет тот клиент, что выполнил команду: после отрисовки нового вида
 * содержимое измеряется на холсте, правка высоты входит в тот же шаг отмены (CVS-07).
 * Возвращает «подогнать эти объекты после ближайшей отрисовки».
 */
export function useTextFit(
  objects: Y.Map<unknown>,
  layer: RefObject<HTMLElement | null>,
  history: UndoHistory,
  actor: string,
): (ids: readonly string[]) => void {
  const pending = useRef(new Set<string>());
  const [requests, setRequests] = useState(0);

  useLayoutEffect(() => {
    const root = layer.current;
    if (pending.current.size === 0 || root === null) return;
    const changes = new Map<string, Record<string, unknown>>();
    for (const id of pending.current) {
      const box = root.querySelector<HTMLElement>(
        `[data-object-id="${CSS.escape(id)}"]`,
      );
      const content = box?.querySelector<HTMLElement>(":scope > .rich-text");
      const current = objectMap(objects, id)?.get("height");
      // Не отрисованный (скрытый) объект не измерить — высота остаётся.
      if (!box || !content || content.offsetHeight === 0) continue;
      if (typeof current !== "number") continue;
      const type = box.dataset.type ?? "";
      const height = fittedHeight(type, current, contentHeight(box, content));
      if (height !== null) changes.set(id, { height });
    }
    pending.current.clear();
    if (changes.size > 0) {
      history.amend(() => {
        writeFields(objects, changes, actor);
      });
    }
  }, [requests, objects, layer, history, actor]);

  return useCallback((ids) => {
    for (const id of ids) pending.current.add(id);
    setRequests((n) => n + 1);
  }, []);
}
