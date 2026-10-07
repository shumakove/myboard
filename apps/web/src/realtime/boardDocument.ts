import * as Y from "yjs";

/**
 * Документ доски Yjs (ARCHITECTURE.md, раздел 6). Метаданные списка (название, папка,
 * ссылка) в документ не входят, присутствие и курсоры — тоже (T4.2).
 */
export interface BoardDocument {
  doc: Y.Doc;
  /** id → объект сцены: JSON с дискриминатором `type`, полем `z` (T5.*). */
  objects: Y.Map<unknown>;
  /** id → { object, deletedAt, deletedBy } (T4.3). */
  trash: Y.Map<unknown>;
  /** id → ветка комментария (T6.10). */
  comments: Y.Map<unknown>;
  /** Общее состояние таймера (T8.1). */
  timer: Y.Map<unknown>;
  /** id сессии голосования → голоса (T8.1). */
  votes: Y.Map<unknown>;
  /** Заметка доски (T6.12). */
  notes: Y.XmlFragment;
  /** Фон и шаг сетки доски (CVS-06, T5.2). */
  settings: Y.Map<unknown>;
}

export function createBoardDocument(doc: Y.Doc = new Y.Doc()): BoardDocument {
  return {
    doc,
    objects: doc.getMap("objects"),
    trash: doc.getMap("trash"),
    comments: doc.getMap("comments"),
    timer: doc.getMap("timer"),
    votes: doc.getMap("votes"),
    notes: doc.getXmlFragment("notes"),
    settings: doc.getMap("settings"),
  };
}

/** Запись корзины: удалённый объект, когда и кем удалён (ARCHITECTURE.md, раздел 6). */
export interface TrashEntry {
  object: unknown;
  /** Момент удаления, ISO 8601. */
  deletedAt: string;
  /** Имя удалившего, как его видит клиент; лента действий берёт имя из сессии. */
  deletedBy: string;
}

/**
 * Удаление объектов (основа COL-08): каждый объект переносится из `objects` в `trash`
 * одной транзакцией — у других участников объект не пропадёт, не попав в корзину.
 * Сервер по новым ключам `trash` пишет запись в ленту действий. Неизвестные id
 * пропускаются. Возвращает id перенесённых объектов.
 */
export function moveToTrash(
  board: BoardDocument,
  ids: Iterable<string>,
  deletedBy: string,
  now: Date = new Date(),
): string[] {
  const moved: string[] = [];
  board.doc.transact(() => {
    for (const id of ids) {
      if (!board.objects.has(id)) continue;
      const entry = new Y.Map<unknown>();
      // Общий тип Yjs нельзя перенести в другое место документа — только копию.
      entry.set("object", copyValue(board.objects.get(id)));
      entry.set("deletedAt", now.toISOString());
      entry.set("deletedBy", deletedBy);
      board.trash.set(id, entry);
      board.objects.delete(id);
      moved.push(id);
    }
  });
  return moved;
}

function copyValue(value: unknown): unknown {
  return value instanceof Y.AbstractType ? value.clone() : value;
}
