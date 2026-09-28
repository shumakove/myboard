import { useLocation } from "wouter";
import { signOut } from "../account/accountApi";
import { useCurrentAccount } from "../account/accountContext";
import "../account/account.css";

/**
 * `/` — список досок, папки, избранное, поиск (ACC-04, BRD-*, T2.1).
 * Пока — только имя пользователя и выход (ACC-03); вход проверяет RequireAccount.
 */
export function BoardsPage() {
  const session = useCurrentAccount();
  const [, navigate] = useLocation();

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
      {session.status === "signedIn" && <p>Boards will appear here.</p>}
    </main>
  );
}
