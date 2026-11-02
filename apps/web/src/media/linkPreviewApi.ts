import type { components } from "../api/schema";

export type LinkPreview = components["schemas"]["LinkPreviewOut"];

const FAILED = "The card could not be added. Try again.";
const NO_ACCESS = "You no longer have access to this board.";

/**
 * EMB-02: название и изображение страницы — `POST /api/boards/{id}/link-preview`. Сервер
 * отвечает и на недоступную страницу (полей нет); ошибка здесь — только отказ или сбой сети.
 */
export async function readLinkPreview(
  boardId: string,
  url: string,
): Promise<LinkPreview> {
  let response: Response;
  try {
    response = await fetch(
      `/api/boards/${encodeURIComponent(boardId)}/link-preview`,
      {
        method: "POST",
        body: JSON.stringify({ url }),
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      },
    );
  } catch {
    throw new Error(FAILED);
  }
  if (!response.ok) {
    throw new Error(response.status === 404 ? NO_ACCESS : FAILED);
  }
  return (await response.json()) as LinkPreview;
}
