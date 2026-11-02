import type { components } from "../api/schema";

/** Загруженный файл доски (`MediaOut`): адрес открывается только с сессией этой доски. */
export type Media = components["schemas"]["MediaOut"];
type MediaCopies = components["schemas"]["MediaCopiesOut"];

/** Ошибка загрузки с текстом для показа участнику. */
export class UploadError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

const MESSAGES: Record<number, string> = {
  404: "You no longer have access to this board.",
  413: "The file is too large to upload.",
  415: "This file type is not supported. Use PNG, JPEG, GIF, WebP or SVG.",
};

/**
 * IMG-01, IMG-07: файл на доску — `POST /api/boards/{id}/media`. Тело — сам файл,
 * `Content-Type` — его объявленный тип; адрес — того же происхождения, что и страница.
 */
export async function uploadMedia(
  boardId: string,
  file: Blob,
  name: string,
  mime: string = file.type,
): Promise<Media> {
  const query = new URLSearchParams({ name });
  let response: Response;
  try {
    response = await fetch(
      `/api/boards/${encodeURIComponent(boardId)}/media?${query.toString()}`,
      {
        method: "POST",
        body: file,
        headers: { "Content-Type": mime },
        credentials: "same-origin",
      },
    );
  } catch {
    throw new UploadError(0, "The upload failed. Check the connection.");
  }
  if (!response.ok) {
    throw new UploadError(
      response.status,
      MESSAGES[response.status] ?? "The upload failed. Try again.",
    );
  }
  return (await response.json()) as Media;
}

const COPY_FAILED = "The images could not be copied to this board. Try again.";

/**
 * CVS-20: файлы другой доски становятся файлами этой — `POST /api/boards/{id}/media/copies`.
 * Ответ — исходный id → id на этой доске; файлов, к которым нет доступа, в нём нет.
 */
export async function copyMedia(
  boardId: string,
  media: readonly string[],
): Promise<Record<string, string>> {
  let response: Response;
  try {
    response = await fetch(
      `/api/boards/${encodeURIComponent(boardId)}/media/copies`,
      {
        method: "POST",
        body: JSON.stringify({ media }),
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      },
    );
  } catch {
    throw new UploadError(0, COPY_FAILED);
  }
  if (!response.ok) {
    throw new UploadError(
      response.status,
      MESSAGES[response.status] ?? COPY_FAILED,
    );
  }
  const body = (await response.json()) as MediaCopies;
  return body.copies;
}
