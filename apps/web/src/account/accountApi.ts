import { api } from "../api/client";
import type { components } from "../api/schema";

export type AccountSession = components["schemas"]["AccountSession"];

/** Ошибка запроса входа с текстом для показа пользователю. */
export class AccountApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AccountApiError";
    this.status = status;
  }
}

// ACC-02: одно скупое сообщение для неверной почты, пароля и отключённой учётки.
const MESSAGES: Record<number, string> = {
  401: "Invalid email or password.",
  422: "Invalid email or password.",
  429: "Too many sign-in attempts. Try again later.",
};

function fail(response: Response): never {
  throw new AccountApiError(
    response.status,
    MESSAGES[response.status] ?? "Something went wrong. Try again.",
  );
}

/** ACC-01: вход пользователя досок; cookie сессии ставит сервер. */
export async function signIn(email: string, password: string): Promise<void> {
  const { response } = await api.POST("/api/login", {
    body: { email, password },
  });
  if (!response.ok) fail(response);
}

/** ACC-03: выход завершает сессию. */
export async function signOut(): Promise<void> {
  const { response } = await api.POST("/api/logout");
  if (!response.ok) fail(response);
}

/** Состояние входа; сервер заодно продлевает cookie живой сессии (ACC-03). */
export async function getSession(): Promise<AccountSession> {
  const { data, response } = await api.GET("/api/session");
  if (!data) fail(response);
  return data;
}

export function errorMessage(error: unknown): string {
  return error instanceof AccountApiError
    ? error.message
    : "Network error. Try again.";
}
