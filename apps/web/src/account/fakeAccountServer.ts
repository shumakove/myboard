// Тестовый двойник API входа пользователя досок: подменяет fetch.
import { vi } from "vitest";

export const USER = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-pw",
};

/** Дополнительные маршруты двойника; `undefined` — маршрут не его. */
export type ExtraRoute = (
  method: string,
  url: URL,
  body: unknown,
) => Response | undefined;

interface Call {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeAccountServer {
  calls: Call[];
  signedIn: boolean;
  /** Ответ на POST /api/login вместо проверки пароля. */
  loginStatus: number | null;
  /** Имя, которое отдаёт GET /api/session (администратор может его сменить). */
  name: string;
  /** Пути, на которые сервер отвечает 401. */
  unauthorizedPaths: string[];
  /** Пути, на которые сервер отвечает 503. */
  failingPaths: string[];
  /** Сеть недоступна: fetch отклоняется. */
  offline: boolean;
  extraRoute: ExtraRoute | null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Ставит двойник вместо fetch; снять — `vi.unstubAllGlobals()`. */
export function installFakeAccountServer(
  initial: Partial<FakeAccountServer> = {},
): FakeAccountServer {
  const server: FakeAccountServer = {
    calls: [],
    signedIn: false,
    loginStatus: null,
    name: USER.name,
    unauthorizedPaths: [],
    failingPaths: [],
    offline: false,
    extraRoute: null,
    ...initial,
  };

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    server.calls.push({ method: request.method, path: pathname, body });
    if (server.offline) throw new TypeError("Failed to fetch");
    if (server.unauthorizedPaths.includes(pathname)) {
      return json({ detail: "Not signed in" }, 401);
    }
    if (server.failingPaths.includes(pathname)) {
      return json({ detail: "Service Unavailable" }, 503);
    }
    const route = `${request.method} ${pathname}`;

    if (route === "GET /api/session") {
      return json(
        server.signedIn
          ? { authenticated: true, name: server.name, email: USER.email }
          : { authenticated: false, name: null, email: null },
      );
    }
    if (route === "POST /api/login") {
      const { email, password } = body as { email: string; password: string };
      const status =
        server.loginStatus ??
        (email === USER.email && password === USER.password ? 204 : 401);
      if (status !== 204) return json({ detail: "refused" }, status);
      server.signedIn = true;
      return new Response(null, { status: 204 });
    }
    if (route === "POST /api/logout") {
      server.signedIn = false;
      return new Response(null, { status: 204 });
    }
    return (
      server.extraRoute?.(request.method, url, body) ??
      json({ detail: "Not Found" }, 404)
    );
  }

  vi.stubGlobal(
    "fetch",
    vi.fn((input: Request) => handle(input)),
  );
  return server;
}
