import { useState, type SubmitEvent } from "react";
import { Link } from "wouter";
import { DragHandle } from "./DragHandle";
import { FavoriteButton } from "./FavoriteButton";
import { formatDate } from "./formatDate";
import {
  deleteBoard,
  errorMessage,
  renameBoard,
  type Board,
} from "./libraryApi";
import { Button, Input } from "../ui";

type Mode = "view" | "rename" | "confirmDelete";

/**
 * Строка полного списка: открыть, переименовать (BRD-02), удалить (BRD-03),
 * избранное (BRD-07), перетащить в папку бокового списка (BRD-10).
 */
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
          <Input
            aria-label="Board name"
            value={title}
            maxLength={200}
            required
            autoFocus
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
          <Button type="submit" variant="primary" disabled={pending}>
            Save
          </Button>
          <Button onClick={cancel}>Cancel</Button>
        </form>
      ) : (
        <div className="library-row-head">
          <DragHandle
            dragId={`list-board:${board.id}`}
            item={{ kind: "board", id: board.id, folderId: board.folder_id }}
            title={board.title}
          />
          <div className="library-row-main">
            <Link href={`/boards/${board.id}`}>{board.title}</Link>
            <span className="library-meta">
              Modified {formatDate(board.updated_at)}
            </span>
          </div>
        </div>
      )}
      {mode === "view" && (
        <div className="library-actions">
          <FavoriteButton
            kind="board"
            id={board.id}
            favorite={board.favorite}
            onChange={onChange}
            onError={setError}
          />
          <Button
            variant="ghost"
            onClick={() => {
              setMode("rename");
            }}
          >
            Rename
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMode("confirmDelete");
            }}
          >
            Delete
          </Button>
        </div>
      )}
      {mode === "confirmDelete" && (
        <div className="library-actions" role="group" aria-label="Delete board">
          <span>Delete this board?</span>
          <Button
            variant="danger"
            disabled={pending}
            onClick={() => void run(() => deleteBoard(board.id))}
          >
            Yes, delete
          </Button>
          <Button onClick={cancel}>Cancel</Button>
        </div>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}
