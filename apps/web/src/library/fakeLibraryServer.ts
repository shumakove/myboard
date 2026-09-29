// Тестовый двойник API списка досок поверх двойника входа: подменяет fetch.
import {
  installFakeAccountServer,
  type FakeAccountServer,
} from "../account/fakeAccountServer";
import type { Board } from "./libraryApi";

export interface FakeLibraryServer {
  account: FakeAccountServer;
  /** Живые доски пользователя (удалённые убираются). */
  boards: Board[];
  /** Параметры каждого запроса GET /api/boards. */
  listQueries: URLSearchParams[];
}

const RECENT_LIMIT = 8;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const BY_SORT: Record<string, (a: Board, b: Board) => number> = {
  updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  created: (a, b) => b.created_at.localeCompare(a.created_at),
  title: (a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
};

/** Доска с датами из минуты `minute` фиксированного дня. */
export function board(id: string, title: string, minute = 0): Board {
  const at = new Date(Date.UTC(2026, 8, 1, 12, minute)).toISOString();
  return { id, title, created_at: at, updated_at: at };
}

/** Ставит двойник вместо fetch; снять — `vi.unstubAllGlobals()`. */
export function installFakeLibraryServer(
  initial: { boards?: Board[] } & Partial<FakeAccountServer> = {},
): FakeLibraryServer {
  const { boards = [], ...account } = initial;
  const server: FakeLibraryServer = {
    account: installFakeAccountServer({ signedIn: true, ...account }),
    boards: boards.map((b) => ({ ...b })),
    listQueries: [],
  };
  let clock = 1000;
  const now = () => new Date(Date.UTC(2026, 8, 2, 0, 0, clock++)).toISOString();

  function list(params: URLSearchParams): Board[] {
    const search = params.get("q")?.toLowerCase() ?? "";
    const since = params.get("modified_since");
    const order = BY_SORT[params.get("sort") ?? "updated"] ?? BY_SORT.updated;
    return server.boards
      .filter((b) => b.title.toLowerCase().includes(search))
      .filter((b) => since === null || b.updated_at >= since)
      .sort(order);
  }

  server.account.extraRoute = (method, url, body) => {
    if (url.pathname === "/api/boards" && method === "GET") {
      server.listQueries.push(url.searchParams);
      return json(list(url.searchParams));
    }
    if (url.pathname === "/api/boards/recent" && method === "GET") {
      return json(list(new URLSearchParams()).slice(0, RECENT_LIMIT));
    }
    if (url.pathname === "/api/boards" && method === "POST") {
      const title = (body as { title?: string }).title ?? "Untitled board";
      const at = now();
      const created = {
        id: `board-${String(server.boards.length + 1)}`,
        title,
        created_at: at,
        updated_at: at,
      };
      server.boards.push(created);
      return json(created, 201);
    }
    const match = /^\/api\/boards\/([^/]+)$/.exec(url.pathname);
    const found = server.boards.find((b) => b.id === match?.[1]);
    if (!match) return undefined;
    if (!found) return json({ detail: "Board not found" }, 404);
    if (method === "GET") return json(found);
    if (method === "PATCH") {
      const title = (body as { title: string }).title.trim();
      if (!title) return json({ detail: "invalid" }, 422);
      Object.assign(found, { title, updated_at: now() });
      return json(found);
    }
    if (method === "DELETE") {
      server.boards = server.boards.filter((b) => b !== found);
      return new Response(null, { status: 204 });
    }
    return undefined;
  };
  return server;
}
