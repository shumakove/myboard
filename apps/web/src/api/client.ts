import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * HTTP-клиент API с типами из OpenAPI (ARCHITECTURE.md, раздел 3).
 * Базовый адрес — происхождение страницы: пути схемы уже начинаются с `/api`,
 * поэтому запросы идут туда же, откуда загружен интерфейс (раздел 10).
 */
export function createApiClient(origin: string = window.location.origin) {
  return createClient<paths>({ baseUrl: origin });
}

export const api = createApiClient();
