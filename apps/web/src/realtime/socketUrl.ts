/** Адрес страницы, из которого строится адрес сокета. */
export type PageAddress = Pick<Location, "protocol" | "host">;

/**
 * Адрес WebSocket `/api/ws` из адреса страницы: `https:` → `wss:`, иначе `ws:`.
 * Хост и порт берутся со страницы, поэтому адрес работает и по IP в LAN,
 * и на публичном домене (ARCHITECTURE.md, раздел 10).
 */
export function socketUrl(page: PageAddress = window.location): string {
  const scheme = page.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${page.host}/api/ws`;
}
