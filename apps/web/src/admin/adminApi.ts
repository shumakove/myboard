import { api } from "../api/client";
import type { components } from "../api/schema";

export type User = components["schemas"]["UserOut"];
export type UserCreate = components["schemas"]["UserCreate"];
export type UserUpdate = components["schemas"]["UserUpdate"];
export type AdminSession = components["schemas"]["AdminSession"];

/** Ошибка запроса к панели с текстом для показа администратору. */
export class AdminApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

const MESSAGES: Record<number, string> = {
  401: "Invalid email or password.",
  404: "User not found.",
  409: "Email is already in use.",
  422: "Enter a name, a valid email and a password.",
  429: "Too many sign-in attempts. Try again later.",
};

function fail(response: Response): never {
  throw new AdminApiError(
    response.status,
    MESSAGES[response.status] ?? "Something went wrong. Try again.",
  );
}

/** ADM-01: вход администратора; cookie сессии ставит сервер. */
export async function signIn(email: string, password: string): Promise<void> {
  const { response } = await api.POST("/api/admin/login", {
    body: { email, password },
  });
  if (!response.ok) fail(response);
}

export async function signOut(): Promise<void> {
  const { response } = await api.POST("/api/admin/logout");
  if (!response.ok) fail(response);
}

export async function getSession(): Promise<AdminSession> {
  const { data, response } = await api.GET("/api/admin/session");
  if (!data) fail(response);
  return data;
}

/** ADM-02 */
export async function listUsers(): Promise<User[]> {
  const { data, response } = await api.GET("/api/admin/users");
  if (!data) fail(response);
  return data;
}

/** ADM-03, ADM-07 */
export async function createUser(body: UserCreate): Promise<User> {
  const { data, response } = await api.POST("/api/admin/users", { body });
  if (!data) fail(response);
  return data;
}

/** ADM-04…ADM-07: изменение полей, отключение и включение. */
export async function updateUser(id: string, body: UserUpdate): Promise<User> {
  const { data, response } = await api.PATCH("/api/admin/users/{user_id}", {
    params: { path: { user_id: id } },
    body,
  });
  if (!data) fail(response);
  return data;
}

export function errorMessage(error: unknown): string {
  return error instanceof AdminApiError
    ? error.message
    : "Network error. Try again.";
}
