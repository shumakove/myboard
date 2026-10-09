import { describe, expect, it } from "vitest";
import { linkedObjectId, objectLink, sharedBoardUrl } from "./objectLink";

describe("SHR-07: ссылка на объект", () => {
  it("ссылка на доску плюс ?object={id}", () => {
    expect(objectLink("http://192.168.1.20:8080/b/tok-1", "abc123")).toBe(
      "http://192.168.1.20:8080/b/tok-1?object=abc123",
    );
  });

  it("id объекта читается из строки запроса страницы", () => {
    expect(linkedObjectId("?object=abc123")).toBe("abc123");
    expect(linkedObjectId("object=abc123")).toBe("abc123");
    expect(linkedObjectId("")).toBeNull();
    expect(linkedObjectId("?object=")).toBeNull();
  });

  it("ссылка участника строится из адреса страницы, а не из localhost", () => {
    expect(sharedBoardUrl("tok-1", "http://192.168.1.20:8080")).toBe(
      "http://192.168.1.20:8080/b/tok-1",
    );
    expect(sharedBoardUrl("tok-1")).toBe(`${window.location.origin}/b/tok-1`);
  });

  it("ссылка и разбор взаимно обратны", () => {
    const link = new URL(objectLink(sharedBoardUrl("tok-1"), "f00d"));
    expect(linkedObjectId(link.search)).toBe("f00d");
  });
});
