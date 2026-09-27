// Тестовый двойник API панели: подменяет fetch и хранит учётки в памяти.
import { vi } from "vitest";
import type { User } from "./adminApi";

export const ADMIN = { email: "admin@example.com", password: "admin-pw" };

interface Call {
  method: string;
  path: string;
  body: unknown;
}

export interface FakeAdminServer {
  users: User[];
  calls: Call[];
  signedIn: boolean;
  /** Ответ на следующий POST /api/admin/login вместо проверки пароля. */
  loginStatus: number | null;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export function makeUser(fields: Partial<User> = {}): User {
  return {
    id: crypto.randomUUID(),
    name: "Alice",
    email: "alice@example.com",
    disabled: false,
    created_at: "2026-09-27T10:00:00Z",
    ...fields,
  };
}

/** Ставит двойник вместо fetch; снять — `vi.unstubAllGlobals()`. */
export function installFakeAdminServer(
  initial: Partial<FakeAdminServer> = {},
): FakeAdminServer {
  const server: FakeAdminServer = {
    users: [],
    calls: [],
    signedIn: false,
    loginStatus: null,
    ...initial,
  };

  function emailTaken(email: string, exceptId?: string): boolean {
    return server.users.some(
      (u) => u.email === email.toLowerCase() && u.id !== exceptId,
    );
  }

  async function handle(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const text = await request.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    server.calls.push({ method: request.method, path: pathname, body });
    const route = `${request.method} ${pathname}`;

    if (route === "GET /api/admin/session") {
      return json({
        authenticated: server.signedIn,
        email: server.signedIn ? ADMIN.email : null,
      });
    }
    if (route === "POST /api/admin/login") {
      const { email, password } = body as { email: string; password: string };
      const status =
        server.loginStatus ??
        (email === ADMIN.email && password === ADMIN.password ? 204 : 401);
      if (status !== 204) return json({ detail: "refused" }, status);
      server.signedIn = true;
      return new Response(null, { status: 204 });
    }
    if (route === "POST /api/admin/logout") {
      server.signedIn = false;
      return new Response(null, { status: 204 });
    }
    if (!server.signedIn) return json({ detail: "Sign in" }, 401);

    if (route === "GET /api/admin/users") return json(server.users);
    if (route === "POST /api/admin/users") {
      const data = body as { name: string; email: string; password: string };
      if (emailTaken(data.email)) return json({ detail: "taken" }, 409);
      const user = makeUser({
        name: data.name,
        email: data.email.toLowerCase(),
      });
      server.users.push(user);
      return json(user, 201);
    }
    const match = /^\/api\/admin\/users\/([^/]+)$/.exec(pathname);
    if (request.method === "PATCH" && match) {
      const user = server.users.find((u) => u.id === match[1]);
      if (!user) return json({ detail: "not found" }, 404);
      const data = body as Partial<User> & { password?: string };
      if (data.email && emailTaken(data.email, user.id)) {
        return json({ detail: "taken" }, 409);
      }
      Object.assign(user, {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.email !== undefined && { email: data.email.toLowerCase() }),
        ...(data.disabled !== undefined && { disabled: data.disabled }),
      });
      return json({ ...user });
    }
    return json({ detail: "Not Found" }, 404);
  }

  vi.stubGlobal(
    "fetch",
    vi.fn((input: Request) => handle(input)),
  );
  return server;
}
