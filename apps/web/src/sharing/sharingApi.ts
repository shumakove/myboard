import { api } from "../api/client";
import type { components } from "../api/schema";

export type ShareLink = components["schemas"]["ShareLink"];
export type SharedBoard = components["schemas"]["SharedBoard"];

/** Ошибка запроса модуля sharing с текстом для показа. */
export class SharingApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SharingApiError";
    this.status = status;
  }
}

/** SHR-05: один скупой текст для отозванной и несуществующей ссылки. */
export const LINK_UNAVAILABLE = "This link is not available.";
const NAME_INVALID = "Enter your name up to 200 characters.";

function fail(response: Response, messages: Record<number, string>): never {
  throw new SharingApiError(
    response.status,
    messages[response.status] ?? "Something went wrong. Try again.",
  );
}

const OWNER_MESSAGES = { 404: "Board not found." };
const GUEST_MESSAGES = { 404: LINK_UNAVAILABLE, 422: NAME_INVALID };

/** SHR-01: действующая ссылка своей доски (выдаётся при первом запросе). */
export async function getShareLink(boardId: string): Promise<ShareLink> {
  const { data, response } = await api.GET("/api/boards/{board_id}/share", {
    params: { path: { board_id: boardId } },
  });
  if (!data) fail(response, OWNER_MESSAGES);
  return data;
}

/** SHR-06: новая ссылка; прежняя и сессии по ней перестают действовать. */
export async function resetShareLink(boardId: string): Promise<ShareLink> {
  const { data, response } = await api.POST(
    "/api/boards/{board_id}/share/reset",
    { params: { path: { board_id: boardId } } },
  );
  if (!data) fail(response, OWNER_MESSAGES);
  return data;
}

/** SHR-02, SHR-05: доска по ссылке; `participant` — `null`, пока имя не введено. */
export async function openSharedBoard(token: string): Promise<SharedBoard> {
  const { data, response } = await api.GET("/api/share/{token}", {
    params: { path: { token } },
  });
  if (!data) fail(response, GUEST_MESSAGES);
  return data;
}

/** SHR-03: имя на сессию; сервер ставит cookie этой доски. */
export async function joinSharedBoard(
  token: string,
  name: string,
): Promise<SharedBoard> {
  const { data, response } = await api.POST("/api/share/{token}/join", {
    params: { path: { token } },
    body: { name },
  });
  if (!data) fail(response, GUEST_MESSAGES);
  return data;
}

export function sharingErrorMessage(error: unknown): string {
  return error instanceof SharingApiError
    ? error.message
    : "Network error. Try again.";
}
