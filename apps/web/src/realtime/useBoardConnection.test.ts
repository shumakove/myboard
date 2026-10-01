import { describe, expect, it } from "vitest";
import { boardSocketUrl } from "./useBoardConnection";

describe("адрес канала доски (ARCHITECTURE.md, раздел 10)", () => {
  const page = { protocol: "http:", host: "192.168.1.20:8080" };

  it("владелец открывает канал по id доски", () => {
    expect(boardSocketUrl({ kind: "owner", boardId: "b-1" }, page)).toBe(
      "ws://192.168.1.20:8080/api/ws?board=b-1",
    );
  });

  it("участник по ссылке — по токену ссылки", () => {
    expect(boardSocketUrl({ kind: "participant", token: "a_b-c" }, page)).toBe(
      "ws://192.168.1.20:8080/api/ws?token=a_b-c",
    );
  });

  it("по умолчанию берёт адрес текущей страницы, без localhost", () => {
    const url = boardSocketUrl({ kind: "owner", boardId: "b-1" });
    expect(url).toBe(`ws://${window.location.host}/api/ws?board=b-1`);
    expect(url).not.toContain("localhost");
  });
});
