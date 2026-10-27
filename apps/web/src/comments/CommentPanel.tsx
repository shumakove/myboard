import { useState, type KeyboardEvent } from "react";
import { Button, FloatingPanel, Switch } from "../ui";
import {
  COMMENT_COLORS,
  type CommentMessage,
  type CommentThread,
} from "./commentData";

/** Что открыто в панели: список, ветка или новая ветка. */
export type CommentView =
  | { kind: "list" }
  | { kind: "thread"; thread: CommentThread; place: string | null }
  | { kind: "draft"; color: string; place: string | null };

export interface CommentFilter {
  /** CMT-04: все участники обсуждений и выбранные из них (пусто — все ветки). */
  people: readonly string[];
  chosen: readonly string[];
  hideResolved: boolean;
}

/**
 * Панель комментариев: список веток с фильтром по участникам (CMT-04) и отметками
 * непрочитанного (CMT-02), ветка с перепиской, «решено» и цветом (CMT-02, CMT-03), форма
 * новой ветки (CMT-01). Escape закрывает панель.
 */
export function CommentPanel({
  view,
  threads,
  filter,
  unread,
  onOpen,
  onBack,
  onClose,
  onPost,
  onReply,
  onResolve,
  onColor,
  onFilter,
}: {
  view: CommentView;
  /** Ветки после фильтра. */
  threads: readonly CommentThread[];
  filter: CommentFilter;
  unread: (thread: CommentThread) => number;
  onOpen: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
  /** Первое сообщение новой ветки. */
  onPost: (text: string) => void;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  /** Цвет открытой ветки или новой ветки. */
  onColor: (color: string) => void;
  onFilter: (filter: Omit<CommentFilter, "people">) => void;
}) {
  return (
    <FloatingPanel
      role="region"
      aria-label="Comments"
      className="comment-panel"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="comment-panel-head">
        {view.kind !== "list" && (
          <Button variant="ghost" onClick={onBack}>
            All comments
          </Button>
        )}
        <h2>
          {view.kind === "draft"
            ? "New comment"
            : view.kind === "thread"
              ? "Comment"
              : "Comments"}
        </h2>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {view.kind === "list" && (
        <ThreadList
          threads={threads}
          filter={filter}
          unread={unread}
          onOpen={onOpen}
          onFilter={onFilter}
        />
      )}
      {view.kind === "thread" && (
        <ThreadView
          key={view.thread.id}
          thread={view.thread}
          place={view.place}
          onReply={onReply}
          onResolve={onResolve}
          onColor={onColor}
        />
      )}
      {view.kind === "draft" && (
        <>
          <p className="comment-place">{placeText(view.place)}</p>
          <ColorChoice color={view.color} onColor={onColor} />
          <MessageForm
            label="Comment"
            submit="Post"
            placeholder="Write a comment"
            onSubmit={onPost}
            onCancel={onBack}
          />
        </>
      )}
    </FloatingPanel>
  );
}

function placeText(place: string | null): string {
  return place === null ? "On the board" : `On ${place}`;
}

function ThreadList({
  threads,
  filter,
  unread,
  onOpen,
  onFilter,
}: {
  threads: readonly CommentThread[];
  filter: CommentFilter;
  unread: (thread: CommentThread) => number;
  onOpen: (id: string) => void;
  onFilter: (filter: Omit<CommentFilter, "people">) => void;
}) {
  const { people, chosen, hideResolved } = filter;
  return (
    <>
      {people.length > 0 && (
        <div
          role="group"
          aria-label="Filter by people"
          className="comment-people"
        >
          {people.map((name) => {
            const on = chosen.includes(name);
            return (
              <Button
                key={name}
                variant="ghost"
                aria-pressed={on}
                onClick={() => {
                  onFilter({
                    hideResolved,
                    chosen: on
                      ? chosen.filter((n) => n !== name)
                      : [...chosen, name],
                  });
                }}
              >
                {name}
              </Button>
            );
          })}
        </div>
      )}
      <Switch
        label="Hide resolved"
        checked={hideResolved}
        onChange={(event) => {
          onFilter({ chosen, hideResolved: event.target.checked });
        }}
      />
      {threads.length === 0 ? (
        <p className="comment-empty">
          {people.length === 0
            ? "No comments yet. Choose the Comment tool (O) and click an object or the board."
            : "No comments match the filter."}
        </p>
      ) : (
        <ul className="comment-list" aria-label="Comment threads">
          {threads.map((thread) => {
            const [first] = thread.messages;
            const fresh = unread(thread);
            const replies = thread.messages.length - 1;
            return (
              <li key={thread.id}>
                <Button
                  variant="ghost"
                  className="comment-item"
                  data-comment-item={thread.id}
                  data-unread={fresh > 0 ? "true" : undefined}
                  onClick={() => {
                    onOpen(thread.id);
                  }}
                >
                  <span className="comment-item-head">
                    <span
                      className="comment-swatch"
                      style={{ background: thread.color }}
                      aria-hidden="true"
                    />
                    <span className="comment-author">{first?.author}</span>
                    {fresh > 0 && (
                      <span className="comment-badge">{fresh} new</span>
                    )}
                    {thread.resolved && (
                      <span className="comment-resolved">Resolved</span>
                    )}
                  </span>
                  <span className="comment-text">{first?.text}</span>
                  {replies > 0 && (
                    <span className="comment-meta">
                      {replies} {replies === 1 ? "reply" : "replies"}
                    </span>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function ThreadView({
  thread,
  place,
  onReply,
  onResolve,
  onColor,
}: {
  thread: CommentThread;
  place: string | null;
  onReply: (text: string) => void;
  onResolve: (resolved: boolean) => void;
  onColor: (color: string) => void;
}) {
  return (
    <>
      <p className="comment-place">
        {thread.anchor.object !== null && place === null
          ? "The commented object is no longer on the board."
          : placeText(place)}
      </p>
      <div className="comment-actions">
        <Button
          variant={thread.resolved ? "ghost" : "secondary"}
          onClick={() => {
            onResolve(!thread.resolved);
          }}
        >
          {thread.resolved ? "Reopen" : "Resolve"}
        </Button>
        {thread.resolved && <span className="comment-resolved">Resolved</span>}
      </div>
      <ColorChoice color={thread.color} onColor={onColor} />
      <ol className="comment-messages" aria-label="Messages">
        {thread.messages.map((m) => (
          <Message key={m.id} message={m} />
        ))}
      </ol>
      <MessageForm
        label="Reply"
        submit="Send"
        placeholder="Reply"
        onSubmit={onReply}
      />
    </>
  );
}

function Message({ message }: { message: CommentMessage }) {
  return (
    <li className="comment-message">
      <span className="comment-item-head">
        <span className="comment-author">{message.author}</span>
        <time className="comment-meta" dateTime={message.at}>
          {formatTime(message.at)}
        </time>
      </span>
      <span className="comment-text">{message.text}</span>
    </li>
  );
}

function formatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

/** CMT-03: цвет ветки — набор образцов. */
function ColorChoice({
  color,
  onColor,
}: {
  color: string;
  onColor: (color: string) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Comment color"
      className="comment-colors"
    >
      {COMMENT_COLORS.map(({ name, value }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={name}
          title={name}
          className="comment-color"
          style={{ background: value }}
          onClick={() => {
            onColor(value);
          }}
        />
      ))}
    </div>
  );
}

/** Поле сообщения: Enter — отправить, Shift+Enter — новая строка. */
function MessageForm({
  label,
  submit,
  placeholder,
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  placeholder: string;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const ready = text.trim() !== "";

  function send() {
    if (!ready) return;
    onSubmit(text.trim());
    setText("");
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  return (
    <form
      className="comment-form"
      onSubmit={(event) => {
        event.preventDefault();
        send();
      }}
    >
      <textarea
        className="ui-input comment-input"
        aria-label={label}
        placeholder={placeholder}
        rows={3}
        autoFocus
        value={text}
        onChange={(event) => {
          setText(event.target.value);
        }}
        onKeyDown={keyDown}
      />
      <div className="comment-actions">
        <Button type="submit" variant="primary" disabled={!ready}>
          {submit}
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
