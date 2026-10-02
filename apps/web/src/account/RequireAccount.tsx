import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { AccountSessionContext } from "./accountContext";
import { useAccountSession } from "./useAccountSession";
import "./account.css";

/**
 * Страница пользователя досок: одна проверка сессии на вкладку.
 * Без сессии или после её отзыва — на `/login` (ACC-03, ACC-05).
 * Страница монтируется только после подтверждения входа: без сессии она не успевает
 * запросить свои данные (BUG-002).
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const session = useAccountSession({ watch: true });

  if (session.status === "signedOut") {
    return <Redirect to="/login" replace />;
  }
  if (session.status === "loading") {
    return (
      <main className="account">
        <p>Loading…</p>
      </main>
    );
  }

  return (
    <AccountSessionContext.Provider value={session}>
      {children}
    </AccountSessionContext.Provider>
  );
}
