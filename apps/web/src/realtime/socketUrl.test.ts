import { describe, expect, it } from "vitest";
import { socketUrl } from "./socketUrl";

describe("адрес WebSocket из адреса страницы (ARCHITECTURE.md, раздел 10)", () => {
  it("на http:// по IP в локальной сети использует ws:// с тем же хостом и портом", () => {
    expect(socketUrl({ protocol: "http:", host: "192.168.1.20:8080" })).toBe(
      "ws://192.168.1.20:8080/api/ws",
    );
  });

  it("на https:// публичного домена использует wss://", () => {
    expect(socketUrl({ protocol: "https:", host: "board.example.com" })).toBe(
      "wss://board.example.com/api/ws",
    );
  });

  it("по умолчанию берёт адрес текущей страницы", () => {
    expect(socketUrl()).toBe(`ws://${window.location.host}/api/ws`);
    expect(socketUrl()).not.toContain("localhost");
  });
});
