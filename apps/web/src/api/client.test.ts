import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, onUnauthorized } from "./client";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("HTTP-клиент API (ARCHITECTURE.md, разделы 3 и 10)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("отправляет запрос на /api того же происхождения, что и страница", async () => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ status: "ok" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { data } = await createApiClient().GET("/api/health");

    expect(data).toEqual({ status: "ok" });
    const request = fetchMock.mock.calls[0]?.[0];
    expect(request?.url).toBe(`${window.location.origin}/api/health`);
    expect(request?.url).not.toContain("localhost");
  });

  it("использует переданное происхождение", async () => {
    const fetchMock = vi.fn<(request: Request) => Promise<Response>>(() =>
      Promise.resolve(jsonResponse({ status: "ok" })),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createApiClient("https://board.example.com").GET("/api/health");

    expect(fetchMock.mock.calls[0]?.[0].url).toBe(
      "https://board.example.com/api/health",
    );
  });
});

describe("уведомление об ответе 401 (ACC-05)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("сообщает подписчику о 401 с запросом и молчит об остальных ответах", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((request: Request) =>
        Promise.resolve(
          new URL(request.url).pathname === "/api/session"
            ? new Response(null, { status: 401 })
            : jsonResponse({ status: "ok" }),
        ),
      ),
    );
    const listener = vi.fn<(request: Request) => void>();
    const unsubscribe = onUnauthorized(listener);
    const client = createApiClient();

    await client.GET("/api/health");
    await client.GET("/api/session");
    unsubscribe();
    await client.GET("/api/session");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        url: `${window.location.origin}/api/session`,
      }),
    );
  });
});
