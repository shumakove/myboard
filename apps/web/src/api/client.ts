import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * HTTP-клиент API с типами из OpenAPI (ARCHITECTURE.md, раздел 3).
 * Базовый адрес — происхождение страницы: пути схемы уже начинаются с `/api`,
 * поэтому запросы идут туда же, откуда загружен интерфейс (раздел 10).
 */
export function createApiClient(origin: string = window.location.origin) {
  // fetch берётся в момент запроса, а не при создании клиента: так его подменяют тесты.
  return createClient<paths>({
    baseUrl: origin,
    fetch: (request) => globalThis.fetch(request),
  });
}

export const api = createApiClient();
