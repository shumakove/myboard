import { useEffect, useState } from "react";
import { getSession } from "./adminApi";

export type AdminSessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; email: string };

/** Вошёл ли браузер в панель администратора (cookie сессии скрипту не видна). */
export function useAdminSession(): AdminSessionState {
  const [state, setState] = useState<AdminSessionState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (!active) return;
        setState(
          session.authenticated && session.email
            ? { status: "signedIn", email: session.email }
            : { status: "signedOut" },
        );
      })
      .catch(() => {
        if (active) setState({ status: "signedOut" });
      });
    return () => {
      active = false;
    };
  }, []);

  return state;
}
