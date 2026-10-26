import type { CSSProperties } from "react";
import * as Y from "yjs";
import { moveToTrash, type BoardDocument } from "../realtime/boardDocument";
import type { Point } from "../realtime/messages";
import {
  CARD_GAP,
  CARD_PADDING,
  CARD_TYPE,
  COLUMN_WIDTH,
  columnId,
  columnList,
  columnTitle,
  DEFAULT_COLUMNS,
  HEADER_HEIGHT,
  KANBAN_HEIGHT,
  KANBAN_TYPE,
  titleMap,
} from "./kanbanData";
import { detachFrom } from "./lineEdits";
import {
  createObject,
  objectMap,
  readScene,
  touch,
  transact,
  writeFields,
  type SceneObject,
} from "./sceneObjects";

export { CARD_TYPE, KANBAN_TYPE };

/**
 * Канбан (T6.8) на доске: создание со столбцами (KBN-01), карточки в столбцах (KBN-02),
 * добавление, переименование и удаление столбцов (KBN-03). Карточки в столбце стоят
 * друг под другом по порядку: порядок задаёт положение карточки по вертикали, поэтому
 * перетаскивание карточки в другой столбец или на другое место столбца переставляет её.
 */

/** Ширина карточки в столбце. */
export const CARD_WIDTH = COLUMN_WIDTH - 2 * CARD_PADDING;

/** Название нового столбца. */
export const NEW_COLUMN_TITLE = "New column";

/** KBN-03: что делать с карточками удаляемого столбца. */
export type ColumnFate = { kind: "move"; to: string } | { kind: "delete" };

/** KBN-01: новый канбан с левым верхним углом в `at` и столбцами по умолчанию. */
export function createKanban(
  objects: Y.Map<unknown>,
  at: Point,
  actor: string,
): string {
  const size = {
    width: DEFAULT_COLUMNS.length * COLUMN_WIDTH,
    height: KANBAN_HEIGHT,
  };
  let id = "";
  transact(objects, () => {
    id = createObject(objects, KANBAN_TYPE, at, "", actor, {}, size);
    const map = objectMap(objects, id);
    if (map === null) return;
    map.delete("text"); // своего текста нет — только названия столбцов
    const ids = DEFAULT_COLUMNS.map(() => columnId());
    const list = new Y.Array<string>();
    list.push(ids);
    map.set("columns", list);
    const titles = new Y.Map<unknown>();
    ids.forEach((column, index) => {
      titles.set(column, new Y.Text(DEFAULT_COLUMNS[index]));
    });
    map.set("titles", titles);
  });
  return id;
}

/**
 * Порядок карточек в столбце — по середине карточки по вертикали (при равенстве — по слою):
 * карточка, отпущенная выше середины соседа, встаёт перед ним.
 */
function byMiddle(a: SceneObject, b: SceneObject): number {
  return a.y + a.height / 2 - (b.y + b.height / 2) || a.z - b.z;
}

/** Карточки столбца сверху вниз. */
export function columnCards(
  scene: readonly SceneObject[],
  kanban: string,
  column: string,
): SceneObject[] {
  return scene
    .filter((o) => o.parent === kanban && o.cell === column)
    .sort(byMiddle);
}

/**
 * Карточки встают в столбец друг под другом в заданном порядке, во всю ширину столбца.
 * Возвращает высоту, которая нужна канбану под них.
 */
function layColumn(
  objects: Y.Map<unknown>,
  column: string,
  cards: readonly SceneObject[],
  actor: string,
): number {
  const changes = new Map<string, Record<string, unknown>>();
  let y = HEADER_HEIGHT;
  for (const card of cards) {
    const placed =
      card.cell === column &&
      card.x - card.origin.x === CARD_PADDING &&
      card.y - card.origin.y === y &&
      card.width === CARD_WIDTH;
    if (!placed) {
      changes.set(card.id, {
        cell: column,
        x: CARD_PADDING,
        y,
        width: CARD_WIDTH,
      });
    }
    y += card.height + CARD_GAP;
  }
  writeFields(objects, changes, actor);
  return cards.length === 0 ? HEADER_HEIGHT : y - CARD_GAP + CARD_PADDING;
}

/** Высота канбана растёт, если карточки в неё не помещаются. */
function fitHeight(
  objects: Y.Map<unknown>,
  kanban: SceneObject,
  needed: number,
  actor: string,
): void {
  if (needed <= kanban.height) return;
  writeFields(objects, new Map([[kanban.id, { height: needed }]]), actor);
}

/**
 * KBN-02: карточки каждого столбца канбана встают по порядку сверху вниз. Объекты,
 * чей столбец удалили одновременно с их переносом, уходят в первый столбец.
 */
export function arrangeKanban(
  objects: Y.Map<unknown>,
  kanbanId: string,
  actor: string,
): void {
  const scene = readScene(objects);
  const kanban = scene.find((o) => o.id === kanbanId);
  const shape = kanban?.kanban ?? null;
  if (kanban === undefined || shape === null) return;
  const ids = new Set(shape.columns.map((c) => c.id));
  const first = shape.columns[0]?.id;
  transact(objects, () => {
    let needed = 0;
    for (const column of shape.columns) {
      const cards = scene
        .filter(
          (o) =>
            o.parent === kanbanId &&
            (o.cell === column.id ||
              (column.id === first && (o.cell === null || !ids.has(o.cell)))),
        )
        .sort(byMiddle);
      needed = Math.max(needed, layColumn(objects, column.id, cards, actor));
    }
    fitHeight(objects, kanban, needed, actor);
  });
}

/** Канбаны, в столбцах которых лежат объекты `ids`. */
export function kanbansOf(
  scene: readonly SceneObject[],
  ids: Iterable<string>,
): Set<string> {
  const byId = new Map(scene.map((o) => [o.id, o]));
  const kanbans = new Set<string>();
  for (const id of ids) {
    const parent = byId.get(byId.get(id)?.parent ?? "");
    if (parent?.kanban != null) kanbans.add(parent.id);
  }
  return kanbans;
}

/** KBN-02: перестроить столбцы канбанов `kanbans`. */
export function arrangeKanbans(
  objects: Y.Map<unknown>,
  kanbans: Iterable<string>,
  actor: string,
): void {
  transact(objects, () => {
    for (const id of new Set(kanbans)) arrangeKanban(objects, id, actor);
  });
}

/** KBN-02: новая карточка внизу столбца. Возвращает её id. */
export function addCard(
  objects: Y.Map<unknown>,
  kanban: SceneObject,
  column: string,
  actor: string,
): string {
  const last = columnCards(readScene(objects), kanban.id, column).at(-1);
  const y =
    last === undefined
      ? HEADER_HEIGHT
      : last.y - last.origin.y + last.height + CARD_GAP;
  let id = "";
  transact(objects, () => {
    id = createObject(objects, CARD_TYPE, { x: CARD_PADDING, y }, "", actor);
    writeFields(
      objects,
      new Map([[id, { parent: kanban.id, cell: column }]]),
      actor,
    );
    arrangeKanban(objects, kanban.id, actor);
  });
  return id;
}

/**
 * KBN-03: новый столбец справа от `after` (`null` — последним). Карточки столбцов правее
 * сдвигаются вместе со своими столбцами. Возвращает id столбца.
 */
export function addColumn(
  objects: Y.Map<unknown>,
  kanban: SceneObject,
  after: string | null,
  actor: string,
): string | null {
  const map = objectMap(objects, kanban.id);
  if (map === null) return null;
  const id = columnId();
  transact(objects, () => {
    const list = columnList(map);
    const index = after === null ? -1 : list.toArray().indexOf(after);
    list.insert(index === -1 ? list.length : index + 1, [id]);
    columnTitle(map, id).insert(0, NEW_COLUMN_TITLE);
    map.set("width", list.length * COLUMN_WIDTH);
    touch(map, actor);
  });
  return id;
}

/**
 * KBN-03: удалить столбец; его карточки переходят в конец столбца `fate.to` или удаляются
 * в корзину (привязанные к ним линии остаются на месте, CVS-26). Последний столбец
 * не удаляется.
 */
export function deleteColumn(
  board: BoardDocument,
  kanban: SceneObject,
  column: string,
  fate: ColumnFate,
  actor: string,
): void {
  const { objects } = board;
  const map = objectMap(objects, kanban.id);
  if (map === null) return;
  const list = columnList(map);
  const index = list.toArray().indexOf(column);
  if (index === -1 || list.length <= 1) return;
  if (fate.kind === "move" && !list.toArray().includes(fate.to)) return;
  const scene = readScene(objects);
  const cards = columnCards(scene, kanban.id, column);
  board.doc.transact(() => {
    if (fate.kind === "delete") {
      const ids = new Set(cards.map((o) => o.id));
      detachFrom(objects, scene, ids, actor);
      moveToTrash(board, ids, actor);
    } else {
      const target = columnCards(scene, kanban.id, fate.to);
      const needed = layColumn(objects, fate.to, [...target, ...cards], actor);
      fitHeight(objects, kanban, needed, actor);
    }
    list.delete(index, 1);
    titleMap(map).delete(column);
    map.set("width", list.length * COLUMN_WIDTH);
    touch(map, actor);
  });
}

/** Поле правки названия столбца (KBN-03) — поверх его заголовка. */
export function columnEditorStyle(
  object: SceneObject,
  column: string,
): CSSProperties | null {
  const found = object.kanban?.columns.find((c) => c.id === column);
  if (found === undefined) return null;
  return {
    left: object.x + found.start,
    top: object.y,
    width: COLUMN_WIDTH,
    height: HEADER_HEIGHT,
  };
}
