import { api } from "../api/client";
import type { components } from "../api/schema";

export type Board = components["schemas"]["BoardOut"];
export type BoardSort = components["schemas"]["BoardSort"];
export type Folder = components["schemas"]["FolderOut"];

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
const FOLDER_NOT_FOUND = "Folder not found.";
const BOARD_TITLE_INVALID = "Enter a board name up to 200 characters.";
const FOLDER_TITLE_INVALID = "Enter a folder name up to 200 characters.";
export const FOLDER_CYCLE =
  "A folder cannot be moved into itself or its subfolder.";

const BOARD_MESSAGES = { 404: NOT_FOUND, 422: BOARD_TITLE_INVALID };

function fail(
  response: Response,
  messages: Record<number, string> = BOARD_MESSAGES,
): never {
  throw new LibraryApiError(
    response.status,
    messages[response.status] ?? "Something went wrong. Try again.",
  );
}

const FOLDER_MESSAGES = {
  404: FOLDER_NOT_FOUND,
  409: FOLDER_CYCLE,
  422: FOLDER_TITLE_INVALID,
};

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

/** BRD-10: перенести доску в папку; `null` — на верхний уровень. */
export async function moveBoard(
  id: string,
  folderId: string | null,
): Promise<Board> {
  const { data, response } = await api.PUT("/api/boards/{board_id}/folder", {
    params: { path: { board_id: id } },
    body: { folder_id: folderId },
  });
  if (!data) fail(response, FOLDER_MESSAGES);
  return data;
}

/** BRD-09: все папки пользователя; BRD-06: с `search` — только совпавшие по названию. */
export async function listFolders(search = ""): Promise<Folder[]> {
  const q = search.trim();
  const { data, response } = await api.GET("/api/folders", {
    params: { query: q ? { q } : {} },
  });
  if (!data) fail(response, FOLDER_MESSAGES);
  return data;
}

/** BRD-09: папка на верхнем уровне или внутри `parentId`. */
export async function createFolder(
  title: string,
  parentId: string | null,
): Promise<Folder> {
  const { data, response } = await api.POST("/api/folders", {
    body: { title, parent_id: parentId },
  });
  if (!data) fail(response, FOLDER_MESSAGES);
  return data;
}

/** BRD-10: место `position` среди папок `parentId`; вложение в свою дочернюю — 409. */
export async function moveFolder(
  id: string,
  parentId: string | null,
  position: number,
): Promise<Folder> {
  const { data, response } = await api.PUT(
    "/api/folders/{folder_id}/position",
    {
      params: { path: { folder_id: id } },
      body: { parent_id: parentId, position },
    },
  );
  if (!data) fail(response, FOLDER_MESSAGES);
  return data;
}

export type FavoriteKind = "board" | "folder";

/** BRD-07: добавить в избранное или убрать. */
export async function setFavorite(
  kind: FavoriteKind,
  id: string,
  favorite: boolean,
): Promise<void> {
  const { response } = await favoriteRequest(kind, id, favorite);
  if (!response.ok)
    fail(response, kind === "board" ? BOARD_MESSAGES : FOLDER_MESSAGES);
}

function favoriteRequest(kind: FavoriteKind, id: string, favorite: boolean) {
  if (kind === "board") {
    const params = { path: { board_id: id } };
    return favorite
      ? api.PUT("/api/boards/{board_id}/favorite", { params })
      : api.DELETE("/api/boards/{board_id}/favorite", { params });
  }
  const params = { path: { folder_id: id } };
  return favorite
    ? api.PUT("/api/folders/{folder_id}/favorite", { params })
    : api.DELETE("/api/folders/{folder_id}/favorite", { params });
}

export function errorMessage(error: unknown): string {
  return error instanceof LibraryApiError
    ? error.message
    : "Network error. Try again.";
}
