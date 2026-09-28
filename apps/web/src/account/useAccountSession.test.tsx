import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { api } from "../api/client";
import { AppRoutes } from "../routes";
import {
  installFakeAccountServer,
  USER,
  type FakeAccountServer,
} from "./fakeAccountServer";
import { SESSION_CHECK_INTERVAL_MS } from "./useAccountSession";

const REVOCATION_DEADLINE_MS = 5000;

function openAt(path: string) {
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook}>
      <AppRoutes />
    </Router>,
  );
  return location;
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function sessionChecks(server: FakeAccountServer): number {
  return server.calls.filter((call) => call.path === "/api/session").length;
}

async function elapse(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

async function signInAt(path: string) {
  const server = installFakeAccountServer({ signedIn: true });
  const location = openAt(path);
  expect(await screen.findByRole("heading", { level: 1 })).toBeInTheDocument();
  await elapse(0);
  return { server, location };
}

describe("вкладка пользователя при отзыве сессии (ACC-05)", () => {
  beforeEach(() => {
    // Подменяются только интервалы: ожидания Testing Library идут в реальном времени.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("проверяет сессию чаще, чем раз в 5 секунд", () => {
    expect(SESSION_CHECK_INTERVAL_MS).toBeLessThan(REVOCATION_DEADLINE_MS);
  });

  it.each(["/", "/boards/42", "/templates"])(
    "%s: после отзыва сессии уходит на /login без действий пользователя",
    async (path) => {
      const { server, location } = await signInAt(path);

      server.signedIn = false; // смена пароля или отключение администратором
      await elapse(SESSION_CHECK_INTERVAL_MS);

      expect(
        await screen.findByRole("button", { name: "Sign in" }),
      ).toBeInTheDocument();
      expect(location.history.at(-1)).toBe("/login");
    },
  );

  it("пока сессия жива, остаётся на странице и видит новое имя", async () => {
    const { server, location } = await signInAt("/");
    expect(screen.getByText(USER.name)).toBeInTheDocument();

    server.name = "Alice Cooper"; // администратор сменил только имя
    await elapse(SESSION_CHECK_INTERVAL_MS * 3);

    expect(await screen.findByText("Alice Cooper")).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
    expect(sessionChecks(server)).toBeGreaterThanOrEqual(4);
  });

  it("скрытая вкладка не опрашивает сервер, а при возврате проверяет сразу", async () => {
    const { server, location } = await signInAt("/");

    setVisibility("hidden");
    const before = sessionChecks(server);
    await elapse(SESSION_CHECK_INTERVAL_MS * 5);
    expect(sessionChecks(server)).toBe(before);

    server.signedIn = false;
    act(() => {
      setVisibility("visible");
    });

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
  });

  it("при возврате фокуса проверяет сессию сразу", async () => {
    const { server, location } = await signInAt("/");

    server.signedIn = false;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
  });

  it("ответ 401 на любой запрос пользователя сразу уводит на /login", async () => {
    const { server, location } = await signInAt("/");

    // Сессия отозвана; интервал не сдвигается — сработать может только ответ 401.
    server.signedIn = false;
    server.unauthorizedPaths = ["/api/health"];
    await act(() => api.GET("/api/health"));

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
  });

  it("401 входа и панели администратора сессию пользователя не завершают", async () => {
    const { server, location } = await signInAt("/");

    server.unauthorizedPaths = ["/api/login", "/api/admin/session"];
    await act(async () => {
      await api.POST("/api/login", {
        body: { email: USER.email, password: "wrong" },
      });
      await api.GET("/api/admin/session");
    });
    await elapse(SESSION_CHECK_INTERVAL_MS);

    expect(screen.getByText(USER.name)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
  });

  it("сбой сети при проверке не выбивает вкладку", async () => {
    const { server, location } = await signInAt("/");

    server.offline = true;
    await elapse(SESSION_CHECK_INTERVAL_MS * 2);
    server.offline = false;
    await elapse(SESSION_CHECK_INTERVAL_MS);

    expect(screen.getByText(USER.name)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
  });

  it("после ухода на /login опрос прекращается", async () => {
    const { server } = await signInAt("/");

    server.signedIn = false;
    await elapse(SESSION_CHECK_INTERVAL_MS);
    await screen.findByRole("button", { name: "Sign in" });
    const after = sessionChecks(server);
    await elapse(SESSION_CHECK_INTERVAL_MS * 3);

    expect(sessionChecks(server)).toBe(after);
  });
});
