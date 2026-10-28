import type { components } from "../api/schema";

/** Загруженный файл доски (`MediaOut`): адрес открывается только с сессией этой доски. */
export type Media = components["schemas"]["MediaOut"];

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
