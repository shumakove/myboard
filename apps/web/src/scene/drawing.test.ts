import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createDrawing } from "./drawEdits";
import { strokePath, touchesStroke } from "./drawingShape";
import { patchObjects, readScene, type SceneObject } from "./sceneObjects";

function setup() {
  const doc = new Y.Doc();
  return doc.getMap<unknown>("objects");
}

function only(objects: Y.Map<unknown>): SceneObject {
  const [object] = readScene(objects);
  if (object === undefined) throw new Error("нет штриха");
  return object;
}

const PEN = { brush: "pen" as const, color: "#ff0000", width: 4 };

describe("DRW-01: штрих — объект доски", () => {
  it("рамка — описанный прямоугольник точек, точки — относительно рамки", () => {
    const objects = setup();
    createDrawing(
      objects,
      [
        { x: 100, y: 50 },
        { x: 140, y: 80 },
        { x: 120, y: 110 },
      ],
      PEN,
      "Alice",
    );
    const stroke = only(objects);
    expect(stroke).toMatchObject({
      type: "drawing",
      x: 100,
      y: 50,
      width: 40,
      height: 60,
      style: { stroke: "#ff0000", strokeWidth: 4 },
      meta: { createdBy: "Alice" },
    });
    expect(stroke.drawing).toEqual({
      brush: "pen",
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 30 },
        { x: 20, y: 60 },
      ],
    });
  });

  it("маркер хранит свою кисть; одна точка — штрих-точка с ненулевой рамкой", () => {
    const objects = setup();
    createDrawing(
      objects,
      [{ x: 5, y: 5 }],
      { ...PEN, brush: "marker" },
      "Alice",
    );
    const stroke = only(objects);
    expect(stroke.drawing?.brush).toBe("marker");
    expect(stroke).toMatchObject({ width: 1, height: 1 });
    expect(strokePath(stroke.drawing?.points ?? [])).toBe("M0 0 L0 0");
  });

  it("испорченные точки в документе — штрих без точек, а не ошибка", () => {
    const objects = setup();
    const map = new Y.Map<unknown>();
    objects.set("x1", map);
    map.set("type", "drawing");
    for (const key of ["x", "y", "width", "height"]) map.set(key, 1);
    map.set("points", [1, "a"]);
    expect(only(objects).drawing).toBeNull();
  });
});

describe("DRW-06: масштаб нарисованного штриха", () => {
  it("новый размер рамки растягивает точки, толщина не меняется", () => {
    const objects = setup();
    createDrawing(
      objects,
      [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
      ],
      PEN,
      "Alice",
    );
    patchObjects(
      objects,
      new Map([[only(objects), { width: 300, height: 25 }]]),
    );
    const stroke = only(objects);
    expect(stroke.drawing?.points).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 25 },
    ]);
    expect(stroke.style.strokeWidth).toBe(4);
  });
});

describe("DRW-03: ластик задевает штрих", () => {
  it("рядом с линией штриха — да, в пустом углу рамки — нет", () => {
    const objects = setup();
    createDrawing(
      objects,
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      PEN,
      "Alice",
    );
    const stroke = only(objects);
    expect(touchesStroke(stroke, { x: 50, y: 55 }, 4)).toBe(true);
    expect(touchesStroke(stroke, { x: 90, y: 10 }, 4)).toBe(false);
  });

  it("учитывает поворот штриха", () => {
    const objects = setup();
    createDrawing(
      objects,
      [
        { x: 0, y: 50 },
        { x: 100, y: 50 },
      ],
      PEN,
      "Alice",
    );
    const stroke = { ...only(objects), rotation: 90 };
    // Горизонтальный штрих, повёрнутый на 90°, — вертикальный через центр (50, 50.5).
    expect(touchesStroke(stroke, { x: 50, y: 5 }, 4)).toBe(true);
    expect(touchesStroke(stroke, { x: 5, y: 50 }, 4)).toBe(false);
  });
});
