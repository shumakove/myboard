/**
 * SHR-07: ссылка на объект — ссылка на доску `/b/{token}` плюс `?object={id}`
 * (ARCHITECTURE.md, раздел 5). Доступ даёт сам токен: с отозванным токеном
 * страница доски отказывает так же, как без `object`.
 */
export const OBJECT_PARAM = "object";

/** Ссылка на объект `objectId` из ссылки на доску. */
export function objectLink(boardUrl: string, objectId: string): string {
  const url = new URL(boardUrl);
  url.searchParams.set(OBJECT_PARAM, objectId);
  return url.toString();
}

/** Id объекта из строки запроса страницы (`?object=…`); `null` — ссылка на всю доску. */
export function linkedObjectId(search: string): string | null {
  const id = new URLSearchParams(search).get(OBJECT_PARAM);
  return id === null || id === "" ? null : id;
}

/**
 * Ссылка на доску для участника, открывшего её по токену: адрес собирается из адреса
 * страницы, а не из `localhost` (ARCHITECTURE.md, раздел 10).
 */
export function sharedBoardUrl(
  token: string,
  origin: string = window.location.origin,
): string {
  return `${origin}/b/${encodeURIComponent(token)}`;
}
