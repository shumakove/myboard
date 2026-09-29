// Тестовый двойник API досок и папок поверх двойника входа: подменяет fetch.
import {
  installFakeAccountServer,
  type FakeAccountServer,
} from "../account/fakeAccountServer";
import { isWithin, siblingsOf } from "./folderTree";
import type { Board, Folder } from "./libraryApi";

export interface FakeLibraryServer {
  account: FakeAccountServer;
  /** Живые доски пользователя (удалённые убираются). */
  boards: Board[];
  folders: Folder[];
  /** Параметры каждого запроса GET /api/boards. */
  listQueries: URLSearchParams[];
}

const RECENT_LIMIT = 8;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const noContent = () => new Response(null, { status: 204 });

const BY_SORT: Record<string, (a: Board, b: Board) => number> = {
  updated: (a, b) => b.updated_at.localeCompare(a.updated_at),
  created: (a, b) => b.created_at.localeCompare(a.created_at),
  title: (a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()),
};

const AT = (minute: number) =>
  new Date(Date.UTC(2026, 8, 1, 12, minute)).toISOString();

/** Доска с датами из минуты `minute` фиксированного дня. */
export function board(
  id: string,
  title: string,
  minute = 0,
  extra: Partial<Board> = {},
): Board {
  const at = AT(minute);
  return {
    id,
    title,
    folder_id: null,
    favorite: false,
    created_at: at,
    updated_at: at,
    ...extra,
  };
}

/** Папка с порядком `position` внутри `parent_id`. */
export function folder(
  id: string,
  title: string,
  position: number,
  extra: Partial<Folder> = {},
): Folder {
  return {
    id,
    title,
    parent_id: null,
    position,
    favorite: false,
    created_at: AT(position),
    ...extra,
  };
}

/** Ставит двойник вместо fetch; снять — `vi.unstubAllGlobals()`. */
export function installFakeLibraryServer(
  initial: {
    boards?: Board[];
    folders?: Folder[];
  } & Partial<FakeAccountServer> = {},
): FakeLibraryServer {
  const { boards = [], folders = [], ...account } = initial;
  const server: FakeLibraryServer = {
    account: installFakeAccountServer({ signedIn: true, ...account }),
    boards: boards.map((b) => ({ ...b })),
    folders: folders.map((f) => ({ ...f })),
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

  function folderRoute(method: string, url: URL, body: unknown) {
    if (url.pathname === "/api/folders" && method === "GET") {
      const search = url.searchParams.get("q")?.toLowerCase() ?? "";
      return json(
        server.folders.filter((f) => f.title.toLowerCase().includes(search)),
      );
    }
    if (url.pathname === "/api/folders" && method === "POST") {
      const { title, parent_id } = body as {
        title: string;
        parent_id: string | null;
      };
      if (!title.trim()) return json({ detail: "invalid" }, 422);
      const created = folder(
        `folder-${String(server.folders.length + 1)}`,
        title.trim(),
        siblingsOf(server.folders, parent_id).length,
        { parent_id },
      );
      server.folders.push(created);
      return json(created, 201);
    }
    const match = /^\/api\/folders\/([^/]+)\/(position|favorite)$/.exec(
      url.pathname,
    );
    if (!match) return undefined;
    const found = server.folders.find((f) => f.id === match[1]);
    if (!found) return json({ detail: "Folder not found" }, 404);
    if (match[2] === "favorite") {
      found.favorite = method === "PUT";
      return noContent();
    }
    const { parent_id, position } = body as {
      parent_id: string | null;
      position: number;
    };
    if (isWithin(server.folders, parent_id, found.id)) {
      return json({ detail: "cycle" }, 409);
    }
    const siblings = siblingsOf(server.folders, parent_id).filter(
      (f) => f !== found,
    );
    siblings.splice(Math.min(position, siblings.length), 0, found);
    found.parent_id = parent_id;
    siblings.forEach((f, index) => {
      f.position = index;
    });
    return json(found);
  }

  server.account.extraRoute = (method, url, body) => {
    if (url.pathname.startsWith("/api/folders")) {
      return folderRoute(method, url, body);
    }
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
      const created = board(
        `board-${String(server.boards.length + 1)}`,
        title,
        0,
        {
          created_at: at,
          updated_at: at,
        },
      );
      server.boards.push(created);
      return json(created, 201);
    }
    const match = /^\/api\/boards\/([^/]+)(\/folder|\/favorite)?$/.exec(
      url.pathname,
    );
    const found = server.boards.find((b) => b.id === match?.[1]);
    if (!match) return undefined;
    if (!found) return json({ detail: "Board not found" }, 404);
    if (match[2] === "/favorite") {
      found.favorite = method === "PUT";
      return noContent();
    }
    if (match[2] === "/folder") {
      found.folder_id = (body as { folder_id: string | null }).folder_id;
      return json(found);
    }
    if (method === "GET") return json(found);
    if (method === "PATCH") {
      const title = (body as { title: string }).title.trim();
      if (!title) return json({ detail: "invalid" }, 422);
      Object.assign(found, { title, updated_at: now() });
      return json(found);
    }
    if (method === "DELETE") {
      server.boards = server.boards.filter((b) => b !== found);
      return noContent();
    }
    return undefined;
  };
  return server;
}
