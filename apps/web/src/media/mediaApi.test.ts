import { afterEach, describe, expect, it, vi } from "vitest";
import { copyMedia, uploadMedia, UploadError } from "./mediaApi";

const MEDIA = {
  id: "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f",
  name: "cat.png",
  mime: "image/png",
  size: 3,
  url: "/api/media/0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f",
};

function respond(status: number, body: unknown = {}) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IMG-01, IMG-07: загрузка файла доски", () => {
  it("тело — сам файл, Content-Type — его тип, адрес — того же происхождения", async () => {
    const fetchMock = respond(201, MEDIA);
    const file = new File(["abc"], "cat.png", { type: "image/png" });

    await expect(uploadMedia("board-1", file, "cat.png")).resolves.toEqual(
      MEDIA,
    );

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/boards/board-1/media?name=cat.png");
    expect(url).not.toContain("localhost");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(file);
    expect(init.headers).toEqual({ "Content-Type": "image/png" });
  });

  it("SVG уходит со своим типом", async () => {
    const fetchMock = respond(201, { ...MEDIA, mime: "image/svg+xml" });
    const svg = new Blob(["<svg/>"], { type: "image/svg+xml" });

    await uploadMedia("board-1", svg, "logo.svg");

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(init.headers).toEqual({ "Content-Type": "image/svg+xml" });
  });

  it.each([
    [413, "The file is too large to upload."],
    [415, "This file type is not supported. Use PNG, JPEG, GIF, WebP or SVG."],
    [404, "You no longer have access to this board."],
  ])("ответ %i — понятная ошибка", async (status, message) => {
    respond(status);
    const file = new File(["abc"], "big.png", { type: "image/png" });

    const failure = uploadMedia("board-1", file, "big.png");

    await expect(failure).rejects.toBeInstanceOf(UploadError);
    await expect(failure).rejects.toThrow(message);
  });
});

describe("CVS-20: копирование файлов на доску", () => {
  it("просит копии у этой доски и возвращает соответствие id", async () => {
    const fetchMock = respond(200, { copies: { a: "b" } });

    await expect(copyMedia("board 1", ["a", "c"])).resolves.toEqual({ a: "b" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/boards/board%201/media/copies");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ media: ["a", "c"] }));
  });

  it("отказ сервера и обрыв сети — ошибка с текстом для участника", async () => {
    respond(404);
    await expect(copyMedia("b", ["a"])).rejects.toThrow(
      "You no longer have access to this board.",
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("offline"))),
    );
    await expect(copyMedia("b", ["a"])).rejects.toBeInstanceOf(UploadError);
  });
});
