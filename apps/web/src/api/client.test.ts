import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "./client";

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
