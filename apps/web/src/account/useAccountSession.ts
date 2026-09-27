import { useEffect, useState } from "react";
import { getSession } from "./accountApi";

export type AccountSessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; name: string; email: string };

/** Вошёл ли пользователь досок (cookie сессии скрипту не видна). */
export function useAccountSession(): AccountSessionState {
  const [state, setState] = useState<AccountSessionState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    getSession()
      .then((session) => {
        if (!active) return;
        setState(
          session.authenticated && session.name && session.email
            ? { status: "signedIn", name: session.name, email: session.email }
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
