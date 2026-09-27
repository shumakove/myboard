import { Redirect, useLocation } from "wouter";
import { signOut } from "../account/accountApi";
import { useAccountSession } from "../account/useAccountSession";
import "../account/account.css";

/**
 * `/` — список досок, папки, избранное, поиск (ACC-04, BRD-*, T2.1).
 * В T1.2 — только проверка входа и выход (ACC-03); без сессии — на `/login`.
 */
export function BoardsPage() {
  const session = useAccountSession();
  const [, navigate] = useLocation();

  if (session.status === "signedOut") {
    return <Redirect to="/login" replace />;
  }

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
