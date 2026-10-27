import { useCallback, useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { objectLabel } from "../scene/objectLabel";
import type { SceneObject } from "../scene/sceneObjects";
import {
  addReply,
  anchorAt,
  createThread,
  DEFAULT_COMMENT_COLOR,
  filterThreads,
  participants,
  pinPoint,
  readThreads,
  setResolved,
  setThreadColor,
  type CommentAnchor,
  type CommentThread,
} from "./commentData";
import { useCommentReads } from "./commentReads";
import { CommentPanel, type CommentView } from "./CommentPanel";
import { CommentPins } from "./CommentPins";
import "./comments.css";

/** Цвет последней своей ветки — для следующей (CMT-03), свой у браузера. */
const COLOR_KEY = "myboard.commentColor";

function loadColor(): string {
  try {
    return localStorage.getItem(COLOR_KEY) ?? DEFAULT_COMMENT_COLOR;
  } catch {
    return DEFAULT_COMMENT_COLOR;
  }
}

function saveColor(color: string): void {
  try {
    localStorage.setItem(COLOR_KEY, color);
  } catch {
    // Хранилище недоступно: цвет живёт до перезагрузки.
  }
}

/** Ветки документа; пересчитываются после любой правки — своей или чужой. */
function useThreads(comments: Y.Map<unknown>): CommentThread[] {
  const [threads, setThreads] = useState(() => readThreads(comments));
  useEffect(() => {
    const update = () => {
      setThreads(readThreads(comments));
    };
    update();
    comments.observeDeep(update);
    return () => {
      comments.unobserveDeep(update);
    };
  }, [comments]);
  return threads;
}

/**
 * Комментарии доски (T6.10, CMT-01…CMT-04): метки на холсте, панель и действия.
 * - `start` — новая ветка у объекта или в точке (инструмент Comment, меню);
 * - `pins` — метки для слоя доски, `panel` — панель поверх холста (или `null`);
 * - `unreadTotal` — непрочитанные сообщения во всех ветках (CMT-02).
 */
export function useBoardComments({
  comments,
  scene,
  boardId,
  self,
  goTo,
}: {
  comments: Y.Map<unknown>;
  /** Объекты на холсте (без скрытого содержимого фреймов). */
  scene: readonly SceneObject[];
  boardId: string;
  /** Имя участника: автор сообщений и владелец отметок прочитанного. */
  self: string;
  /** Вид — к точке доски. */
  goTo: (point: Point) => void;
}) {
  const threads = useThreads(comments);
  const { unread, markRead } = useCommentReads(boardId, self);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [draft, setDraft] = useState<CommentAnchor | null>(null);
  const [color, setColor] = useState(loadColor);
  const [chosen, setChosen] = useState<string[]>([]);
  const [hideResolved, setHideResolved] = useState(false);

  const people = useMemo(() => participants(threads), [threads]);
  // Ушедшие из обсуждений (ветки нет) из фильтра выпадают сами.
  const filterPeople = useMemo(
    () => chosen.filter((name) => people.includes(name)),
    [chosen, people],
  );
  const shown = useMemo(
    () => filterThreads(threads, filterPeople, hideResolved),
    [threads, filterPeople, hideResolved],
  );
  const activeThread = open
    ? (threads.find((t) => t.id === active) ?? null)
    : null;

  // CMT-02: открытая ветка прочитана — и новые сообщения в ней, пока она открыта.
  useEffect(() => {
    if (activeThread !== null) markRead(activeThread.messages.map((m) => m.id));
  }, [activeThread, markRead]);

  const start = useCallback((object: SceneObject | null, at: Point) => {
    setDraft(anchorAt(object, at));
    setActive(null);
    setOpen(true);
  }, []);

  const openThread = useCallback(
    (id: string) => {
      setDraft(null);
      setActive(id);
      setOpen(true);
      const thread = threads.find((t) => t.id === id);
      const at = thread ? pinPoint(thread.anchor, scene) : null;
      if (at !== null) goTo(at);
    },
    [threads, scene, goTo],
  );

  const close = useCallback(() => {
    setOpen(false);
    setDraft(null);
    setActive(null);
  }, []);

  const place = (anchor: CommentAnchor) =>
    anchor.object === null ? null : objectLabel(scene, anchor.object);

  const view: CommentView =
    draft !== null
      ? { kind: "draft", color, place: place(draft) }
      : activeThread !== null
        ? {
            kind: "thread",
            thread: activeThread,
            place: place(activeThread.anchor),
          }
        : { kind: "list" };

  const pins = (
    <CommentPins
      threads={shown}
      scene={scene}
      active={activeThread?.id ?? null}
      draft={draft === null ? null : { anchor: draft, color }}
      unread={unread}
      onOpen={openThread}
    />
  );

  const panel = open ? (
    <CommentPanel
      view={view}
      threads={shown}
      filter={{ people, chosen: filterPeople, hideResolved }}
      unread={unread}
      onOpen={openThread}
      onBack={() => {
        setDraft(null);
        setActive(null);
      }}
      onClose={close}
      onPost={(text) => {
        if (draft === null) return;
        const created = createThread(comments, draft, color, self, text);
        markRead([created.message]);
        setDraft(null);
        setActive(created.thread);
      }}
      onReply={(text) => {
        if (activeThread === null) return;
        const id = addReply(comments, activeThread.id, self, text);
        if (id !== null) markRead([id]);
      }}
      onResolve={(resolved) => {
        if (activeThread !== null)
          setResolved(comments, activeThread.id, resolved);
      }}
      onColor={(next) => {
        setColor(next);
        saveColor(next);
        if (activeThread !== null)
          setThreadColor(comments, activeThread.id, next);
      }}
      onFilter={(next) => {
        setChosen([...next.chosen]);
        setHideResolved(next.hideResolved);
      }}
    />
  ) : null;

  const unreadTotal = threads.reduce((sum, t) => sum + unread(t), 0);

  return {
    open,
    toggle: () => {
      if (open) close();
      else setOpen(true);
    },
    close,
    start,
    pins,
    panel,
    unreadTotal,
  };
}
