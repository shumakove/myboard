import { useState, type SubmitEvent } from "react";
import { Link } from "wouter";
import { formatDate } from "./formatDate";
import {
  deleteBoard,
  errorMessage,
  renameBoard,
  type Board,
} from "./libraryApi";

type Mode = "view" | "rename" | "confirmDelete";

/** Строка полного списка: открыть, переименовать (BRD-02), удалить (BRD-03). */
export function BoardRow({
  board,
  onChange,
}: {
  board: Board;
  onChange: () => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState(board.title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
      setMode("view");
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  function rename(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() => renameBoard(board.id, title));
  }

  function cancel() {
    setMode("view");
    setTitle(board.title);
    setError(null);
  }

  return (
    <li className="library-row" aria-label={board.title}>
      {mode === "rename" ? (
        <form className="library-rename" onSubmit={rename}>
          <input
            aria-label="Board name"
            value={title}
            maxLength={200}
            required
            autoFocus
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <button type="submit" disabled={pending}>
            Save
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="library-row-main">
          <Link href={`/boards/${board.id}`}>{board.title}</Link>
          <span className="library-meta">
            Modified {formatDate(board.updated_at)}
          </span>
        </div>
      )}
      {mode === "view" && (
        <div className="library-actions">
          <button
            type="button"
            onClick={() => {
              setMode("rename");
            }}
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("confirmDelete");
            }}
          >
            Delete
          </button>
        </div>
      )}
      {mode === "confirmDelete" && (
        <div className="library-actions" role="group" aria-label="Delete board">
          <span>Delete this board?</span>
          <button
            type="button"
            disabled={pending}
            onClick={() => void run(() => deleteBoard(board.id))}
          >
            Yes, delete
          </button>
          <button type="button" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
