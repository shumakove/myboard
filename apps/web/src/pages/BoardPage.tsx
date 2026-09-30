import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { errorMessage, getBoard, type Board } from "../library/libraryApi";
import { ShareDialog } from "../sharing/ShareDialog";
import "../account/account.css";

type BoardState =
  | { status: "loading" }
  | { status: "ready"; board: Board }
  | { status: "failed"; message: string };

/**
 * `/boards/{id}` — своя доска (BRD-01 открывает её сразу после создания).
 * Чужая, удалённая и несуществующая доска одинаково «не найдена». Кнопка Share — ссылка
 * для участников (SHR-01, SHR-06). Холст — T4.1, T5.*.
 */
export function BoardPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [sharing, setSharing] = useState(false);

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
          <p>The canvas is not available yet.</p>
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
