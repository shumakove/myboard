import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import {
  errorMessage,
  getBoard,
  LibraryApiError,
  type Board,
} from "../library/libraryApi";
import { useCurrentAccount } from "../account/accountContext";
import { BoardLive } from "../realtime/BoardLive";
import { ShareDialog } from "../sharing/ShareDialog";
import "../account/account.css";

type BoardState =
  | { status: "loading" }
  | { status: "ready"; board: Board }
  | { status: "failed"; message: string };

/**
 * `/boards/{id}` — своя доска (BRD-01 открывает её сразу после создания).
 * Чужая, удалённая и несуществующая доска одинаково «не найдена». Кнопка Share — ссылка
 * для участников (SHR-01, SHR-06). Документ доски синхронизируется по `/api/ws` (COL-01);
 * холст — T5.*.
 */
export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [sharing, setSharing] = useState(false);
  const account = useCurrentAccount();

  useEffect(() => {
    let active = true;
    getBoard(id)
      .then((board) => {
        if (active) setState({ status: "ready", board });
      })
      .catch((err: unknown) => {
        if (active) setState({ status: "failed", message: errorMessage(err) });
      });
    return () => {
      active = false;
    };
  }, [id]);

  const heading =
    state.status === "ready"
      ? state.board.title
      : state.status === "failed"
        ? "Board unavailable"
        : "Board";

  return (
    <main className="account">
      <p>
        <Link href="/">← All boards</Link>
      </p>
      <h1>{heading}</h1>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "failed" && <p role="alert">{state.message}</p>}
      {state.status === "ready" && (
        <>
          <p>
            <button
              type="button"
              onClick={() => {
                setSharing(true);
              }}
            >
              Share
            </button>
          </p>
          <BoardLive
            boardId={state.board.id}
            target={{ kind: "owner", boardId: state.board.id }}
            checkAccess={() => ownerHasAccess(state.board.id)}
            userName={account.status === "signedIn" ? account.name : undefined}
          />
          {sharing && (
            <ShareDialog
              boardId={state.board.id}
              onClose={() => {
                setSharing(false);
              }}
            />
          )}
        </>
      )}
    </main>
  );
}

/** После разрыва канала: доска ещё своя и не удалена? Без сессии клиент уводит на /login. */
async function ownerHasAccess(boardId: string): Promise<boolean> {
  try {
    await getBoard(boardId);
    return true;
  } catch (err: unknown) {
    return !(
      err instanceof LibraryApiError &&
      (err.status === 401 || err.status === 404)
    );
  }
}
