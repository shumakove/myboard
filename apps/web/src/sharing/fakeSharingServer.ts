// Тестовый двойник API ссылок на доску поверх двойника досок: подменяет fetch.
import { vi } from "vitest";
import type { Board } from "../library/libraryApi";
import {
  installFakeLibraryServer,
  type FakeLibraryServer,
} from "../library/fakeLibraryServer";
import type { FakeAccountServer } from "../account/fakeAccountServer";

export const BASE_URL = "http://192.168.1.20:8080";

/** Подменяет копирование выделения (`document.execCommand`) и возвращает заглушку. */
export function stubCopyCommand(copied = true) {
  const command = vi.fn(() => copied);
  Object.defineProperty(document, "execCommand", {
    value: command,
    configurable: true,
  });
  return command;
}

export interface FakeSharingServer {
  library: FakeLibraryServer;
  /** Действующий токен доски по её id. */
  links: Record<string, string>;
  /** Имя участника этого браузера по токену; нет записи — имя не введено. */
  participants: Record<string, string>;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const unavailable = () => json({ detail: "Link is not available" }, 404);

/** Ставит двойник вместо fetch; снять — `vi.unstubAllGlobals()`. */
export function installFakeSharingServer(
  initial: {
    boards?: Board[];
    links?: Record<string, string>;
    participants?: Record<string, string>;
  } & Partial<FakeAccountServer> = {},
): FakeSharingServer {
  const { links = {}, participants = {}, ...rest } = initial;
  const library = installFakeLibraryServer(rest);
  const server: FakeSharingServer = {
    library,
    links: { ...links },
    participants: { ...participants },
  };
  let issued = 0;
  const link = (token: string) => ({ token, url: `${BASE_URL}/b/${token}` });

  function sharedBoard(token: string) {
    const board = library.boards.find((b) => server.links[b.id] === token);
    if (!board) return undefined;
    const name = server.participants[token];
    return { title: board.title, participant: name ? { name } : null };
  }

  function route(method: string, url: URL, body: unknown) {
    const owner = /^\/api\/boards\/([^/]+)\/share(\/reset)?$/.exec(
      url.pathname,
    );
    if (owner) {
      const id = owner[1] ?? "";
      if (!library.boards.some((b) => b.id === id)) {
        return json({ detail: "Board not found" }, 404);
      }
      const old = server.links[id];
      const reset = owner[2] !== undefined && method === "POST";
      const token = old && !reset ? old : `token-${id}-${String(++issued)}`;
      if (old && reset) Reflect.deleteProperty(server.participants, old);
      server.links[id] = token;
      return json(link(token));
    }
    const guest = /^\/api\/share\/([^/]+)(\/join)?$/.exec(url.pathname);
    if (!guest) return undefined;
    const token = guest[1] ?? "";
    if (!sharedBoard(token)) return unavailable();
    if (guest[2] && method === "POST") {
      const name = (body as { name: string }).name.trim();
      if (!name) return json({ detail: "invalid" }, 422);
      server.participants[token] = name;
    }
    return json(sharedBoard(token));
  }

  const libraryRoute = library.account.extraRoute;
  library.account.extraRoute = (method, url, body) =>
    route(method, url, body) ?? libraryRoute?.(method, url, body);
  return server;
}
