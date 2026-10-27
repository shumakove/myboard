import type { CSSProperties } from "react";
import type { SceneObject } from "../scene/sceneObjects";
import {
  pinPoint,
  type CommentAnchor,
  type CommentThread,
} from "./commentData";

/**
 * Метки комментариев на холсте (слой доски — двигаются с камерой). CMT-01: метка стоит в
 * точке привязки и едет вместе с объектом; CMT-02: число сообщений, отметки «решено» и
 * «непрочитано»; CMT-03: цвет ветки. Нажатие на метку открывает ветку: холст его не
 * обрабатывает (`data-canvas-ignore`).
 */
export function CommentPins({
  threads,
  scene,
  active,
  draft,
  unread,
  onOpen,
}: {
  threads: readonly CommentThread[];
  scene: readonly SceneObject[];
  active: string | null;
  /** Новая ветка, ещё без сообщения: её метка — без числа. */
  draft: { anchor: CommentAnchor; color: string } | null;
  unread: (thread: CommentThread) => number;
  onOpen: (id: string) => void;
}) {
  const draftAt = draft === null ? null : pinPoint(draft.anchor, scene);
  return (
    <div className="comment-pins">
      {threads.map((thread) => {
        const at = pinPoint(thread.anchor, scene);
        if (at === null) return null;
        const fresh = unread(thread);
        const [first] = thread.messages;
        const label = [
          `Comment by ${first?.author ?? "unknown"}`,
          thread.resolved ? "resolved" : null,
          fresh > 0 ? `${String(fresh)} unread` : null,
        ]
          .filter((part) => part !== null)
          .join(", ");
        return (
          <button
            key={thread.id}
            type="button"
            className="comment-pin"
            data-canvas-ignore=""
            data-comment-id={thread.id}
            data-unread={fresh > 0 ? "true" : undefined}
            data-resolved={thread.resolved ? "true" : undefined}
            aria-pressed={thread.id === active}
            aria-label={label}
            title={first?.text}
            style={pinStyle(at, thread.color)}
            onClick={() => {
              onOpen(thread.id);
            }}
          >
            {thread.resolved ? "✓" : thread.messages.length}
          </button>
        );
      })}
      {draft !== null && draftAt !== null && (
        <span
          className="comment-pin"
          data-comment-draft="true"
          aria-hidden="true"
          style={pinStyle(draftAt, draft.color)}
        >
          +
        </span>
      )}
    </div>
  );
}

function pinStyle(at: { x: number; y: number }, color: string): CSSProperties {
  return {
    left: at.x,
    top: at.y,
    "--comment-color": color,
  } as CSSProperties;
}
