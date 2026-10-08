import { useEffect, useState } from "react";
import { Link } from "wouter";
import { formatDate } from "./formatDate";
import { errorMessage, recentBoards, type Board } from "./libraryApi";

/** BRD-04: недавние доски — последние изменённые. `version` меняется после правок списка. */
export function RecentBoards({ version }: { version: number }) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    recentBoards()
      .then((list) => {
        if (!active) return;
        setBoards(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [version]);

  // Пустой список показывает раздел «All boards».
  if (boards?.length === 0 && !error) return null;

  return (
    <section aria-labelledby="recent-title">
      <h2 id="recent-title">Recent</h2>
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {boards === null && !error && <p>Loading…</p>}
      {boards && boards.length > 0 && (
        <ul className="library-recent" aria-label="Recent boards">
          {boards.map((board) => (
            <li key={board.id} aria-label={board.title}>
              <Link href={`/boards/${board.id}`} className="library-card">
                <span className="library-card-title">{board.title}</span>
                <span className="library-meta">
                  Modified {formatDate(board.updated_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
