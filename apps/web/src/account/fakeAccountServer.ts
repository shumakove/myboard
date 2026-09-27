// Тестовый двойник API входа пользователя досок: подменяет fetch.
import { vi } from "vitest";

export const USER = {
  name: "Alice",
  email: "alice@example.com",
  password: "alice-pw",
};

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
    ...initial,
  };

  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    server.calls.push({ method: request.method, path: pathname, body });
    const route = `${request.method} ${pathname}`;

    if (route === "GET /api/session") {
      return json(
        server.signedIn
          ? { authenticated: true, name: USER.name, email: USER.email }
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
    return json({ detail: "Not Found" }, 404);
  }

  vi.stubGlobal(
    "fetch",
    vi.fn((input: Request) => handle(input)),
  );
  return server;
}
