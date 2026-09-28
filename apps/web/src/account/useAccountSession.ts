import { useEffect, useState } from "react";
import { onUnauthorized } from "../api/client";
import { getSession, type AccountSession } from "./accountApi";

export type AccountSessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; name: string; email: string };

/**
 * ACC-05: как часто видимая вкладка сверяет сессию с сервером.
 * С запасом на медленную сеть телефона: отзыв замечается за ~2 с, требование — 5 с.
 */
export const SESSION_CHECK_INTERVAL_MS = 2000;

const SIGNED_OUT: AccountSessionState = { status: "signedOut" };

function toState(session: AccountSession): AccountSessionState {
  return session.authenticated && session.name && session.email
    ? { status: "signedIn", name: session.name, email: session.email }
    : SIGNED_OUT;
}

/** 401 входа — неверный пароль, 401 панели — сессия администратора, а не пользователя. */
function meansAccountSignedOut(request: Request): boolean {
  const { pathname } = new URL(request.url);
  return pathname !== "/api/login" && !pathname.startsWith("/api/admin/");
}

/**
 * Вошёл ли пользователь досок (cookie сессии скрипту не видна).
 * С `watch` (ACC-05): пока вкладка видима, сессия проверяется каждые
 * SESSION_CHECK_INTERVAL_MS, при возврате на вкладку — сразу; ответ 401 любого
 * запроса пользователя — выход. Без `watch` — одна проверка при открытии.
 */
export function useAccountSession({
  watch = false,
}: { watch?: boolean } = {}): AccountSessionState {
  const [state, setState] = useState<AccountSessionState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    let checking = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    // Выход окончательный: запоздавший ответ не возвращает вкладку во «вошёл».
    function update(next: AccountSessionState) {
      if (!active) return;
      setState((prev) => (prev.status === "signedOut" ? prev : next));
    }

    async function check() {
      if (checking) return;
      checking = true;
      try {
        update(toState(await getSession()));
      } catch {
        // Сбой сети при повторной проверке не выбивает; без первого ответа — на вход.
        if (active) {
          setState((prev) => (prev.status === "loading" ? SIGNED_OUT : prev));
        }
      } finally {
        checking = false;
      }
    }

    function syncPolling() {
      const visible = document.visibilityState === "visible";
      if (visible && timer === undefined) {
        timer = setInterval(() => void check(), SESSION_CHECK_INTERVAL_MS);
      } else if (!visible && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    }

    function onVisibilityChange() {
      syncPolling();
      if (document.visibilityState === "visible") void check();
    }

    function onFocus() {
      void check();
    }

    void check();
    if (!watch) {
      return () => {
        active = false;
      };
    }

    const unsubscribe = onUnauthorized((request) => {
      if (meansAccountSignedOut(request)) update(SIGNED_OUT);
    });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", onFocus);
    syncPolling();

    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [watch]);

  return state;
}
