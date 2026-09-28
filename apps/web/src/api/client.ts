import createClient from "openapi-fetch";
import type { paths } from "./schema";

type UnauthorizedListener = (request: Request) => void;

const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Подписка на ответы `401` любого запроса API; возвращает отписку.
 * Что делать с отказом, решает подписчик (ACC-05: вкладка пользователя уходит на вход).
 */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/**
 * HTTP-клиент API с типами из OpenAPI (ARCHITECTURE.md, раздел 3).
 * Базовый адрес — происхождение страницы: пути схемы уже начинаются с `/api`,
 * поэтому запросы идут туда же, откуда загружен интерфейс (раздел 10).
 */
export function createApiClient(origin: string = window.location.origin) {
  // fetch берётся в момент запроса, а не при создании клиента: так его подменяют тесты.
  const client = createClient<paths>({
    baseUrl: origin,
    fetch: (request) => globalThis.fetch(request),
  });
  client.use({
    onResponse({ request, response }) {
      if (response.status === 401) {
        for (const listener of unauthorizedListeners) listener(request);
      }
    },
  });
  return client;
}

export const api = createApiClient();
