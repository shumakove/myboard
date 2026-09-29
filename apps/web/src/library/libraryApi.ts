import { api } from "../api/client";
import type { components } from "../api/schema";

export type Board = components["schemas"]["BoardOut"];
export type BoardSort = components["schemas"]["BoardSort"];

/** Параметры полного списка: поиск (BRD-06), порядок и фильтр (BRD-05). */
export interface BoardQuery {
  search: string;
  sort: BoardSort;
  /** ISO-время: только доски, изменённые с этого момента; `null` — без фильтра. */
  modifiedSince: string | null;
}

/** Ошибка запроса к списку досок с текстом для показа пользователю. */
export class LibraryApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "LibraryApiError";
    this.status = status;
  }
}

const NOT_FOUND = "Board not found.";

const MESSAGES: Record<number, string> = {
  404: NOT_FOUND,
  422: "Enter a board name up to 200 characters.",
};

function fail(response: Response): never {
  throw new LibraryApiError(
    response.status,
    MESSAGES[response.status] ?? "Something went wrong. Try again.",
  );
}

/** ACC-04, BRD-04…BRD-06: поиск, сортировка и фильтр выполняет сервер. */
export async function listBoards(query: BoardQuery): Promise<Board[]> {
  const search = query.search.trim();
  const { data, response } = await api.GET("/api/boards", {
    params: {
      query: {
        sort: query.sort,
        ...(search ? { q: search } : {}),
        ...(query.modifiedSince ? { modified_since: query.modifiedSince } : {}),
      },
    },
  });
  if (!data) fail(response);
  return data;
}

/** BRD-04: последние изменённые доски. */
export async function recentBoards(): Promise<Board[]> {
  const { data, response } = await api.GET("/api/boards/recent");
  if (!data) fail(response);
  return data;
}

/** BRD-01: без названия сервер даёт «Untitled board». */
export async function createBoard(title?: string): Promise<Board> {
  const { data, response } = await api.POST("/api/boards", {
    body: title === undefined ? {} : { title },
  });
  if (!data) fail(response);
  return data;
}

export async function getBoard(id: string): Promise<Board> {
  const { data, response } = await api.GET("/api/boards/{board_id}", {
    params: { path: { board_id: id } },
  });
  // Неверный формат id — та же «не найдена», что и чужая доска.
  if (response.status === 422) throw new LibraryApiError(404, NOT_FOUND);
  if (!data) fail(response);
  return data;
}

/** BRD-02 */
export async function renameBoard(id: string, title: string): Promise<Board> {
  const { data, response } = await api.PATCH("/api/boards/{board_id}", {
    params: { path: { board_id: id } },
    body: { title },
  });
  if (!data) fail(response);
  return data;
}

/** BRD-03 */
export async function deleteBoard(id: string): Promise<void> {
  const { response } = await api.DELETE("/api/boards/{board_id}", {
    params: { path: { board_id: id } },
  });
  if (!response.ok) fail(response);
}

export function errorMessage(error: unknown): string {
  return error instanceof LibraryApiError
    ? error.message
    : "Network error. Try again.";
}
