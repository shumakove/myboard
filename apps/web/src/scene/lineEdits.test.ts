import { describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { copyObjects, pasteObjects } from "./clipboard";
import {
  addLabel,
  createLine,
  detachFrom,
  detachLine,
  labelText,
  setLabel,
  setPoints,
  swapEnds,
} from "./lineEdits";
import {
  createObject,
  patchObjects,
  readScene,
  type SceneObject,
} from "./sceneObjects";

function setup() {
  const board = createBoardDocument();
  const { objects } = board;
  // Стикеры 200×200: A в (0,0), B в (400,0); линия от правой стороны A к левой B.
  const a = createObject(objects, "sticky", { x: 0, y: 0 });
  const b = createObject(objects, "sticky", { x: 400, y: 0 });
  const id = createLine(
    objects,
    { point: { x: 200, y: 100 }, object: a, anchor: "e" },
    { point: { x: 400, y: 100 }, object: b, anchor: "w" },
    "Alice",
  );
  return { board, objects, a, b, id };
}

function find(objects: ReturnType<typeof setup>["objects"], id: string) {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

function moveBy(
  objects: ReturnType<typeof setup>["objects"],
  object: SceneObject,
  dx: number,
  dy: number,
) {
  patchObjects(
    objects,
    new Map([[object, { x: object.x + dx, y: object.y + dy }]]),
  );
}

describe("CVS-26: линия следует за привязанным объектом", () => {
  it("рамка линии — по её точкам; концы — в точках привязки", () => {
    const { objects, id } = setup();
    const line = find(objects, id);
    expect(line.line?.path).toEqual([
      { x: 200, y: 100 },
      { x: 400, y: 100 },
    ]);
    expect(line).toMatchObject({ x: 200, y: 100, width: 200, height: 0 });
  });

  it("перемещение объекта двигает привязанный конец", () => {
    const { objects, a, id } = setup();
    moveBy(objects, find(objects, a), 0, 300);
    expect(find(objects, id).line?.path[0]).toEqual({ x: 200, y: 400 });
  });

  it("после отвязки линия остаётся на месте и не следует за объектом", () => {
    const { objects, a, id } = setup();
    detachLine(objects, find(objects, id), "Bob");
    moveBy(objects, find(objects, a), 0, 300);
    const line = find(objects, id);
    expect(line.line?.path[0]).toEqual({ x: 200, y: 100 });
    expect(line.line?.start.object).toBeUndefined();
    expect(line.meta.updatedBy).toBe("Bob");
  });

  it("при удалении объекта привязанный к нему конец остаётся на месте", () => {
    const { objects, b, id } = setup();
    moveBy(objects, find(objects, b), 100, 0);
    detachFrom(objects, readScene(objects), new Set([b]), "Alice");
    objects.delete(b);
    const line = find(objects, id);
    expect(line.line?.path.at(-1)).toEqual({ x: 500, y: 100 });
    expect(line.line?.end.object).toBeUndefined();
    expect(line.line?.start.object).toBeDefined();
  });

  it("перемещение самой линии двигает свободные точки, привязанные концы остаются", () => {
    const { objects, id } = setup();
    setPoints(objects, find(objects, id), [{ x: 300, y: 200 }], "Alice");
    moveBy(objects, find(objects, id), 10, 10);
    expect(find(objects, id).line?.path).toEqual([
      { x: 200, y: 100 },
      { x: 310, y: 210 },
      { x: 400, y: 100 },
    ]);
  });
});

describe("CON-02: начало и конец меняются местами", () => {
  it("привязки и точки — в обратном порядке, подписи на месте", () => {
    const { objects, a, b, id } = setup();
    setPoints(
      objects,
      find(objects, id),
      [
        { x: 250, y: 0 },
        { x: 350, y: 0 },
      ],
      "Alice",
    );
    const label = addLabel(objects, id, 0.2, "Alice");
    swapEnds(objects, find(objects, id), "Alice");
    const line = find(objects, id);
    expect(line.line?.start.object).toBe(b);
    expect(line.line?.end.object).toBe(a);
    expect(line.line?.path).toEqual([
      { x: 400, y: 100 },
      { x: 350, y: 0 },
      { x: 250, y: 0 },
      { x: 200, y: 100 },
    ]);
    expect(line.line?.labels.find((l) => l.id === label)?.position).toBeCloseTo(
      0.8,
    );
    // Наконечники остаются у начала и конца — стрелка смотрит в другую сторону.
    expect(line.style).toMatchObject({ startCap: "none", endCap: "arrow" });
  });
});

describe("CON-03, CON-04: подписи", () => {
  it("несколько подписей с текстом в несколько строк и своим оформлением", () => {
    const { objects, id } = setup();
    const first = addLabel(objects, id, 0.5, "Alice");
    const second = addLabel(objects, id, 0.1, "Alice");
    labelText(objects, id, first)?.insert(0, "yes\nok");
    setLabel(
      objects,
      id,
      first,
      {
        fontSize: 24,
        color: "#ff0000",
        orientation: "along",
        fontFamily: "mono",
      },
      "Alice",
    );
    const labels = find(objects, id).line?.labels ?? [];
    expect(labels.map((l) => l.id)).toEqual([second, first]);
    expect(labels[1]).toMatchObject({
      text: "yes\nok",
      fontSize: 24,
      color: "#ff0000",
      orientation: "along",
      fontFamily: "mono",
    });
    // CVS-08: линию находят по тексту подписи.
    expect(find(objects, id).text).toContain("yes");
  });
});

describe("CVS-20: копия линии", () => {
  it("вместе с объектами — привязка к копиям; без них — свободные концы на месте", () => {
    const { objects, a, id } = setup();
    const scene = readScene(objects);
    const both = copyObjects(objects, scene, [a, id]);
    const lineOnly = copyObjects(objects, scene, [id]);
    if (both === null || lineOnly === null) throw new Error("нет копии");

    const pasted = pasteObjects(
      objects,
      both,
      {
        kind: "offset",
        offset: { x: 0, y: 500 },
        parent: null,
        cell: null,
        origin: { x: 0, y: 0 },
      },
      "Alice",
    );
    const copies = readScene(objects).filter((o) => pasted.includes(o.id));
    const copyOfA = copies.find((o) => o.type === "sticky");
    const copyOfLine = copies.find((o) => o.type === "line");
    expect(copyOfLine?.line?.start.object).toBe(copyOfA?.id);
    expect(copyOfLine?.line?.end.object).toBeUndefined();
    expect(copyOfLine?.line?.path).toEqual([
      { x: 200, y: 600 },
      { x: 400, y: 600 },
    ]);

    const [alone] = pasteObjects(
      objects,
      lineOnly,
      {
        kind: "offset",
        offset: { x: 0, y: 900 },
        parent: null,
        cell: null,
        origin: { x: 0, y: 0 },
      },
      "Alice",
    );
    const free = find(objects, alone ?? "");
    expect(free.line?.start.object).toBeUndefined();
    expect(free.line?.path[0]).toEqual({ x: 200, y: 1000 });
  });
});
