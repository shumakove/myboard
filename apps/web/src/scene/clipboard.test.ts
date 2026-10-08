import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  clipText,
  copyObjects,
  loadClip,
  parseClip,
  pasteObjects,
  saveClip,
} from "./clipboard";
import { groupObjects } from "./groups";
import { setLocked } from "./lock";
import { createObject, readScene, type SceneObject } from "./sceneObjects";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

function board() {
  return new Y.Doc().getMap<unknown>("objects");
}

function byType(scene: readonly SceneObject[], type: string): SceneObject {
  const found = scene.find((o) => o.type === type);
  if (found === undefined) throw new Error(`нет ${type}`);
  return found;
}

describe("CVS-20: копирование и вставка объектов", () => {
  it("копия с одной доски вставляется на другую: тип, рамка, оформление, текст, группа", () => {
    const source = board();
    const a = createObject(
      source,
      "sticky",
      { x: 100, y: 100 },
      "Plan",
      "Alice",
    );
    const b = createObject(source, "shape", { x: 400, y: 100 }, "Box", "Alice");
    (source.get(b) as Y.Map<unknown>).set("fill", "#81d4fa");
    const scene = readScene(source);
    const group = groupObjects(
      source,
      scene,
      scene.filter((o) => o.id === a || o.id === b),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");
    setLocked(source, [group], true, "Alice");

    // Через JSON — как через буфер обмена или хранилище браузера.
    const clip = parseClip(
      JSON.stringify(copyObjects(source, readScene(source), [group])),
    );
    if (clip === null) throw new Error("копии нет");
    expect(clipText(clip)).toBe("Plan\nBox");

    vi.useFakeTimers({
      now: new Date("2026-10-08T12:00:00Z"),
      toFake: ["Date"],
    });
    const target = board();
    createObject(target, "text", { x: 0, y: 0 });
    const roots = pasteObjects(
      target,
      clip,
      { kind: "at", point: { x: 1000, y: 1000 }, gridStep: 0 },
      "Bob",
    );
    const pasted = readScene(target);
    expect(roots).toHaveLength(1);
    const pastedGroup = byType(pasted, "group");
    expect(roots[0]).toBe(pastedGroup.id);
    expect(pastedGroup.id).not.toBe(group);
    // Центр копии — в точке вставки, взаимное положение сохранено.
    expect(pastedGroup).toMatchObject({
      x: 750,
      y: 900,
      width: 500,
      height: 200,
    });
    expect(byType(pasted, "sticky")).toMatchObject({
      x: 750,
      y: 900,
      text: "Plan",
      parent: pastedGroup.id,
    });
    expect(byType(pasted, "shape")).toMatchObject({
      x: 1050,
      y: 900,
      text: "Box",
      style: { fill: "#81d4fa" },
    });
    // Поверх объектов доски, без блокировки, автор — вставивший (CVS-22).
    expect(pastedGroup.z).toBeGreaterThan(byType(pasted, "text").z);
    expect(pasted.every((o) => !o.locked)).toBe(true);
    expect(pastedGroup.meta).toEqual({
      createdBy: "Bob",
      createdAt: "2026-10-08T12:00:00.000Z",
      updatedBy: "Bob",
      updatedAt: "2026-10-08T12:00:00.000Z",
    });
    // Текст вставленного — Y.Text, его можно править вместе (COL-01).
    expect(
      (target.get(byType(pasted, "sticky").id) as Y.Map<unknown>).get("text"),
    ).toBeInstanceOf(Y.Text);
  });

  it("дубликат встаёт со сдвигом в ту же группу", () => {
    const objects = board();
    const a = createObject(objects, "sticky", { x: 0, y: 0 });
    const b = createObject(objects, "sticky", { x: 300, y: 0 });
    const scene = readScene(objects);
    const group = groupObjects(objects, scene, scene, "Alice");
    const current = readScene(objects);
    const clip = copyObjects(objects, current, [a]);
    if (clip === null || group === null) throw new Error("нет копии");
    const [copy] = pasteObjects(
      objects,
      clip,
      {
        kind: "offset",
        offset: { x: 20, y: 20 },
        parent: current.find((o) => o.id === group) ?? null,
      },
      "Alice",
    );
    expect(readScene(objects).find((o) => o.id === copy)).toMatchObject({
      x: 20,
      y: 20,
      parent: group,
    });
    expect(readScene(objects).filter((o) => o.parent === group)).toHaveLength(
      3,
    );
    expect(b).toBeTruthy();
  });

  it("чужие и испорченные данные не вставляются", () => {
    expect(parseClip("plain text")).toBeNull();
    expect(
      parseClip(JSON.stringify({ format: "other", objects: [] })),
    ).toBeNull();
    expect(
      parseClip(
        JSON.stringify({
          format: "myboard/objects",
          bounds: { x: 0, y: 0, width: 1, height: 1 },
          objects: [{ id: "x", parent: null, fields: { type: "sticky" } }],
        }),
      ),
    ).toBeNull();
  });

  it("BUG-008: копия ложится поверх объектов, записанных JSON-значением", () => {
    const objects = board();
    // Сторонний клиент пишет объекты обычным JSON, а не Y.Map (ARCHITECTURE.md, раздел 6).
    objects.set("a", {
      type: "shape",
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      z: 1,
    });
    objects.set("b", {
      type: "shape",
      x: 60,
      y: 0,
      width: 50,
      height: 50,
      z: 2,
    });
    const clip = copyObjects(objects, readScene(objects), ["a", "b"]);
    if (clip === null) throw new Error("нет копии");
    const roots = pasteObjects(
      objects,
      clip,
      { kind: "at", point: { x: 0, y: 0 }, gridStep: 0 },
      "Bob",
    );
    const scene = readScene(objects);
    const pastedZ = scene.filter((o) => roots.includes(o.id)).map((o) => o.z);
    expect(pastedZ).toHaveLength(2);
    expect(Math.min(...pastedZ)).toBeGreaterThan(2);
  });

  it("последняя копия хранится в браузере — для вставки на другой доске", () => {
    const objects = board();
    const a = createObject(objects, "text", { x: 0, y: 0 }, "Hi");
    const clip = copyObjects(objects, readScene(objects), [a]);
    if (clip === null) throw new Error("нет копии");
    saveClip(clip);
    expect(loadClip()).toEqual(clip);
  });
});
