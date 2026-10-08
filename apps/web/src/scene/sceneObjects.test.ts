import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  createObject,
  objectText,
  patchObjects,
  readScene,
  type SceneObject,
} from "./sceneObjects";
import { unlockAll } from "./lock";
import { linkedDocs } from "./testDocs";

function only(objects: Y.Map<unknown>): SceneObject {
  const [object] = readScene(objects);
  if (object === undefined) throw new Error("объекта нет");
  return object;
}

describe("объект сцены в документе", () => {
  it("CVS-09: новый объект — Y.Map с type, z, рамкой, оформлением и Y.Text", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    const first = createObject(objects, "sticky", { x: 10, y: 20 }, "Hi");
    const second = createObject(objects, "shape", { x: 0, y: 0 });

    const map = objects.get(first) as Y.Map<unknown>;
    expect(map).toBeInstanceOf(Y.Map);
    expect(map.get("text")).toBeInstanceOf(Y.Text);
    expect(readScene(objects).map((o) => [o.id, o.type, o.z])).toEqual([
      [first, "sticky", 1],
      [second, "shape", 2],
    ]);
    expect(only(objects)).toMatchObject({
      x: 10,
      y: 20,
      width: 200,
      height: 200,
      rotation: 0,
      parent: null,
      text: "Hi",
      style: { fill: "#fff176" },
    });
  });

  it("координаты дочернего объекта — относительно родителя", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    objects.set("frame", {
      type: "frame",
      x: 100,
      y: 50,
      width: 500,
      height: 500,
    });
    objects.set("child", {
      type: "sticky",
      parent: "frame",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    });
    const child = readScene(objects).find((o) => o.id === "child");
    expect(child).toMatchObject({ x: 110, y: 60, origin: { x: 100, y: 50 } });

    if (child === undefined) throw new Error("нет объекта");
    patchObjects(objects, new Map([[child, { x: 200 }]]));
    expect((objects.get("child") as Y.Map<unknown>).get("x")).toBe(100);
  });

  it("запись JSON переводится в Y.Map при правке, неверные записи пропускаются", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    objects.set("old", {
      type: "sticky",
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      text: "A",
    });
    objects.set("broken", { type: "sticky", x: "1" });
    expect(readScene(objects).map((o) => o.id)).toEqual(["old"]);

    objectText(objects, "old")?.insert(1, "B");
    expect(objects.get("old")).toBeInstanceOf(Y.Map);
    expect(only(objects).text).toBe("AB");
  });

  it("COL-01: одновременные правки текста и разных полей одного объекта сливаются", () => {
    const [docA, docB] = linkedDocs();
    const objectsA = docA.getMap<unknown>("objects");
    const objectsB = docB.getMap<unknown>("objects");
    const id = createObject(objectsA, "sticky", { x: 0, y: 0 }, "middle");

    // Правки без обмена (как одновременные), затем обмен состоянием.
    const offline = new Y.Doc();
    Y.applyUpdate(offline, Y.encodeStateAsUpdate(docB));
    const objectsC = offline.getMap<unknown>("objects");
    objectText(objectsA, id)?.insert(0, "start ");
    objectText(objectsC, id)?.insert(6, " end");
    patchObjects(objectsA, new Map([[only(objectsA), { fill: "#81d4fa" }]]));
    patchObjects(objectsC, new Map([[only(objectsC), { x: 300 }]]));
    // Сервер рассылает правки третьего клиента обоим.
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(offline), "remote");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(offline), "remote");

    for (const objects of [objectsA, objectsB]) {
      expect(only(objects)).toMatchObject({
        text: "start middle end",
        x: 300,
        style: { fill: "#81d4fa" },
      });
    }
  });
});

describe("CVS-22: автор и даты объекта", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("новый объект хранит автора и время; правка — кто и когда изменил последним", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    vi.useFakeTimers({
      now: new Date("2026-10-08T10:00:00Z"),
      toFake: ["Date"],
    });
    const id = createObject(objects, "sticky", { x: 0, y: 0 }, "", "Alice");
    expect(only(objects).meta).toEqual({
      createdBy: "Alice",
      createdAt: "2026-10-08T10:00:00.000Z",
      updatedBy: "Alice",
      updatedAt: "2026-10-08T10:00:00.000Z",
    });

    vi.setSystemTime(new Date("2026-10-08T11:30:00Z"));
    patchObjects(objects, new Map([[only(objects), { x: 40 }]]), "Kate");
    expect(only(objects).meta).toEqual({
      createdBy: "Alice",
      createdAt: "2026-10-08T10:00:00.000Z",
      updatedBy: "Kate",
      updatedAt: "2026-10-08T11:30:00.000Z",
    });
    expect(objects.get(id)).toBeInstanceOf(Y.Map);
  });
});

describe("CVS-19: блокировка в сцене", () => {
  it("объект заблокированной группы тоже заблокирован; разблокировать всё снимает всё", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    objects.set("g", {
      type: "group",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      locked: true,
    });
    objects.set("child", {
      type: "sticky",
      parent: "g",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
    });
    objects.set("free", {
      type: "sticky",
      x: 0,
      y: 0,
      width: 5,
      height: 5,
      locked: true,
    });
    expect(readScene(objects).map((o) => [o.id, o.locked])).toEqual([
      ["free", true],
      ["g", true],
      ["child", true],
    ]);
    unlockAll(objects, "Bob");
    expect(readScene(objects).every((o) => !o.locked)).toBe(true);
  });
});
