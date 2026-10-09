import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { searchScene } from "./search";
import { createObject, objectMap, readScene } from "./sceneObjects";

/** Доска с объектами: текст, положение и теги (`Y.Array` под ключом `tags`). */
function board(
  items: { text: string; at: [number, number]; tags?: string[] }[],
): { objects: Y.Map<unknown>; ids: string[] } {
  const objects = new Y.Doc().getMap<unknown>("objects");
  const ids = items.map(({ text, at: [x, y], tags }) => {
    const id = createObject(objects, "sticky", { x, y }, text);
    if (tags) {
      const list = new Y.Array<string>();
      list.push(tags);
      objectMap(objects, id)?.set("tags", list);
    }
    return id;
  });
  return { objects, ids };
}

function found(objects: Y.Map<unknown>, query: string): string[] {
  return searchScene(readScene(objects), query).map((hit) => hit.object.id);
}

describe("CVS-08: поиск по тексту и тегам", () => {
  it("находит объект по части текста без учёта регистра", () => {
    const { objects, ids } = board([
      { text: "Release plan", at: [0, 0] },
      { text: "Budget", at: [300, 0] },
    ]);
    expect(found(objects, "PLAN")).toEqual([ids[0]]);
    expect(found(objects, "  budget ")).toEqual([ids[1]]);
    expect(found(objects, "missing")).toEqual([]);
  });

  it("находит объект по тегу; совпавший тег — в результате", () => {
    const { objects, ids } = board([
      { text: "Fix login", at: [0, 0], tags: ["urgent", "backend"] },
      { text: "Write docs", at: [300, 0], tags: ["docs"] },
    ]);
    const hits = searchScene(readScene(objects), "urg");
    expect(hits.map((h) => h.object.id)).toEqual([ids[0]]);
    expect(hits[0]).toMatchObject({ snippet: "", tags: ["urgent"] });
  });

  it("запрос с # ищет только по тегам", () => {
    const { objects, ids } = board([
      { text: "docs are outdated", at: [0, 0] },
      { text: "Write guide", at: [300, 0], tags: ["#docs"] },
    ]);
    expect(found(objects, "docs")).toEqual([ids[0], ids[1]]);
    expect(found(objects, "#docs")).toEqual([ids[1]]);
  });

  it("пустой запрос ничего не находит", () => {
    const { objects } = board([{ text: "Anything", at: [0, 0] }]);
    expect(found(objects, "")).toEqual([]);
    expect(found(objects, "   ")).toEqual([]);
    expect(found(objects, "#")).toEqual([]);
  });

  it("результаты — в порядке чтения доски: сверху вниз, слева направо", () => {
    const { objects, ids } = board([
      { text: "task C", at: [0, 500] },
      { text: "task B", at: [400, 0] },
      { text: "task A", at: [0, 0] },
    ]);
    expect(found(objects, "task")).toEqual([ids[2], ids[1], ids[0]]);
  });

  it("длинный текст сокращается до отрывка вокруг совпадения", () => {
    const long = `${"a ".repeat(60)}needle${" b".repeat(60)}`;
    const { objects } = board([{ text: long, at: [0, 0] }]);
    const [hit] = searchScene(readScene(objects), "needle");
    expect(hit?.snippet).toContain("needle");
    expect(hit?.snippet.startsWith("…")).toBe(true);
    expect(hit?.snippet.endsWith("…")).toBe(true);
    expect(hit?.snippet.length).toBeLessThanOrEqual(82);
  });

  it("теги читаются и из записи JSON; пустые и повторы отбрасываются", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    objects.set("plain", {
      type: "sticky",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      tags: ["idea", " ", "idea", 5],
    });
    expect(readScene(objects)[0]?.tags).toEqual(["idea"]);
    expect(found(objects, "idea")).toEqual(["plain"]);
  });
});
