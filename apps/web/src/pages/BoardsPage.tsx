import { useState } from "react";
import { useLocation } from "wouter";
import { signOut } from "../account/accountApi";
import { useCurrentAccount } from "../account/accountContext";
import { BoardList } from "../library/BoardList";
import { NewBoardButton } from "../library/NewBoardButton";
import { RecentBoards } from "../library/RecentBoards";
import "../account/account.css";
import "../library/library.css";

/**
 * `/` — доски вошедшего пользователя (ACC-04): создание (BRD-01), недавние и полный
 * список (BRD-04) с поиском, сортировкой и фильтром (BRD-05, BRD-06). Вход проверяет
 * RequireAccount; папки и избранное добавит T2.2.
 */
export function BoardsPage() {
  const session = useCurrentAccount();
  const [, navigate] = useLocation();
  // Растёт после переименования и удаления: оба списка загружаются заново.
  const [version, setVersion] = useState(0);

  async function leave() {
    try {
      await signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <main className="account">
      <header className="account-header">
        <h1>Boards</h1>
        {session.status === "signedIn" && (
          <div className="account-user">
            <span>{session.name}</span>
            <button type="button" onClick={() => void leave()}>
              Sign out
            </button>
          </div>
        )}
      </header>
      {session.status === "loading" && <p>Loading…</p>}
      {session.status === "signedIn" && (
        <>
          <NewBoardButton />
          <RecentBoards version={version} />
          <BoardList
            version={version}
            onChange={() => {
              setVersion((v) => v + 1);
            }}
          />
        </>
      )}
    </main>
  );
}
