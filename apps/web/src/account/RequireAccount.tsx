import type { ReactNode } from "react";
import { Redirect } from "wouter";
import { AccountSessionContext } from "./accountContext";
import { useAccountSession } from "./useAccountSession";

/**
 * Страница пользователя досок: одна проверка сессии на вкладку.
 * Без сессии или после её отзыва — на `/login` (ACC-03, ACC-05).
 */
export function RequireAccount({ children }: { children: ReactNode }) {
  const session = useAccountSession({ watch: true });

  if (session.status === "signedOut") {
    return <Redirect to="/login" replace />;
  }

  return (
    <AccountSessionContext.Provider value={session}>
      {children}
    </AccountSessionContext.Provider>
  );
}
