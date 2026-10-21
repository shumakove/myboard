import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import { createObject, objectMap, readScene } from "./sceneObjects";
import { addTag, normalizeTag, removeTag } from "./tags";

function tagsOf(objects: Y.Map<unknown>, id: string): string[] {
  return readScene(objects).find((o) => o.id === id)?.tags ?? [];
}

describe("STK-03: теги объекта", () => {
  it("тег хранится без «#», пробелы по краям и внутри схлопываются, пустой не нужен", () => {
    expect(normalizeTag("  #urgent ")).toBe("urgent");
    expect(normalizeTag("##two  words")).toBe("two words");
    expect(normalizeTag("#")).toBeNull();
    expect(normalizeTag("   ")).toBeNull();
    expect(normalizeTag("x".repeat(60))).toHaveLength(40);
  });

  it("добавление пишет Y.Array строк, повтор не добавляется, автор правки отмечен", () => {
    const { objects } = createBoardDocument();
    const id = createObject(objects, "sticky", { x: 0, y: 0 }, "", "Alice");
    expect(addTag(objects, id, "#urgent", "Bob")).toBe(true);
    expect(addTag(objects, id, "urgent", "Bob")).toBe(true);
    expect(addTag(objects, id, " # ", "Bob")).toBe(false);
    const map = objectMap(objects, id);
    expect(map?.get("tags")).toBeInstanceOf(Y.Array);
    expect((map?.get("tags") as Y.Array<string>).toArray()).toEqual(["urgent"]);
    expect(map?.get("updatedBy")).toBe("Bob");
  });

  it("удаление убирает тег; теги из JSON-массива переводятся в Y.Array", () => {
    const { objects } = createBoardDocument();
    const id = createObject(objects, "sticky", { x: 0, y: 0 });
    objectMap(objects, id)?.set("tags", ["a", "b"]);
    removeTag(objects, id, "a", "Bob");
    expect(objectMap(objects, id)?.get("tags")).toBeInstanceOf(Y.Array);
    expect(tagsOf(objects, id)).toEqual(["b"]);
  });

  it("COL-01: два участника одновременно добавляют разные теги — остаются оба", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = createBoardDocument(docA).objects;
    const id = createObject(a, "sticky", { x: 0, y: 0 });
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    // Правки независимы (обмен обновлениями ещё не дошёл), затем сливаются.
    addTag(a, id, "mine", "Alice");
    addTag(createBoardDocument(docB).objects, id, "theirs", "Bob");
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    for (const doc of [docA, docB]) {
      expect(new Set(tagsOf(createBoardDocument(doc).objects, id))).toEqual(
        new Set(["mine", "theirs"]),
      );
    }
  });
});
