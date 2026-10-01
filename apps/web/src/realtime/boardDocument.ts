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
  };
}
