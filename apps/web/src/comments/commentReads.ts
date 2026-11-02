import { useCallback, useState } from "react";
import {
  isOwnMessage,
  type CommentAuthor,
  type CommentThread,
} from "./commentData";

/**
 * CMT-02: непрочитанные — свои у каждого участника и в документ не попадают. Прочитанные
 * id сообщений хранит браузер (`localStorage`) по доске и имени участника. Свои сообщения
 * прочитаны всегда.
 */
export const COMMENT_READS_PREFIX = "myboard.commentReads.";

/** Сколько id прочитанных сообщений хранится на доску: старые вытесняются. */
const READ_LIMIT = 2000;

function storageKey(boardId: string, self: string): string {
  return `${COMMENT_READS_PREFIX}${boardId}.${self}`;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadReads(boardId: string, self: string): Set<string> {
  try {
    const raw = safeStorage()?.getItem(storageKey(boardId, self));
    const parsed: unknown = raw == null ? [] : JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function saveReads(boardId: string, self: string, reads: Set<string>): void {
  try {
    safeStorage()?.setItem(
      storageKey(boardId, self),
      JSON.stringify([...reads].slice(-READ_LIMIT)),
    );
  } catch {
    // Хранилище недоступно (приватный режим): отметки живут до перезагрузки.
  }
}

/** Непрочитанные сообщения ветки: чужие и ещё не открытые этим участником. */
export function unreadCount(
  thread: CommentThread,
  reads: ReadonlySet<string>,
  self: CommentAuthor,
): number {
  return thread.messages.filter(
    (m) => !isOwnMessage(m, self) && !reads.has(m.id),
  ).length;
}

/** Отметки прочитанного этого участника на этой доске. */
export function useCommentReads(boardId: string, self: CommentAuthor) {
  const { id, name } = self;
  const [state, setState] = useState(() => ({
    key: storageKey(boardId, name),
    reads: loadReads(boardId, name),
  }));
  // Сменились доска или имя — свои отметки для них.
  const key = storageKey(boardId, name);
  const current =
    state.key === key ? state : { key, reads: loadReads(boardId, name) };
  if (current !== state) setState(current);
  const { reads } = current;

  const markRead = useCallback(
    (ids: readonly string[]) => {
      setState((prev) => {
        const fresh = ids.filter((id) => !prev.reads.has(id));
        if (fresh.length === 0) return prev;
        const next = new Set([...prev.reads, ...fresh]);
        saveReads(boardId, name, next);
        return { ...prev, reads: next };
      });
    },
    [boardId, name],
  );

  const unread = useCallback(
    (thread: CommentThread) => unreadCount(thread, reads, { id, name }),
    [reads, id, name],
  );

  return { unread, markRead };
}
