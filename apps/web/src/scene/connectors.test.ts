import { describe, expect, it } from "vitest";
import {
  anchorPoint,
  capPath,
  constrainAngle,
  findAttachment,
  pointAlong,
  projectOnto,
  readLineData,
  routeOf,
  routeSegments,
  uprightAngle,
} from "./connectors";

const frame = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };

describe("CVS-26: точки привязки", () => {
  it("середины сторон рамки, с учётом поворота", () => {
    expect(anchorPoint(frame, "e")).toEqual({ x: 200, y: 50 });
    expect(anchorPoint(frame, "n")).toEqual({ x: 100, y: 0 });
    const turned = anchorPoint({ ...frame, rotation: 90 }, "e");
    expect(turned.x).toBeCloseTo(100);
    expect(turned.y).toBeCloseTo(150);
  });

  it("конец рядом с объектом притягивается к ближайшей точке, вдали — нет", () => {
    const objects = [{ ...frame, id: "a", type: "sticky" }];
    expect(findAttachment(objects, { x: 190, y: 60 }, 16)).toEqual({
      object: "a",
      anchor: "e",
      point: { x: 200, y: 50 },
    });
    expect(findAttachment(objects, { x: 210, y: 50 }, 16)?.anchor).toBe("e");
    expect(findAttachment(objects, { x: 300, y: 50 }, 16)).toBeNull();
    // К линиям и группам не привязывают.
    expect(
      findAttachment(
        [{ ...frame, id: "l", type: "line" }],
        { x: 10, y: 10 },
        16,
      ),
    ).toBeNull();
  });
});

describe("CON-05: угол свободного конца", () => {
  it("без Shift — кратный 45°, с Shift — любой", () => {
    const base = { x: 0, y: 0 };
    const free = constrainAngle(base, { x: 100, y: 40 }, true);
    expect(free).toEqual({ x: 100, y: 40 });
    const snapped = constrainAngle(base, { x: 100, y: 40 }, false);
    expect(snapped.y).toBeCloseTo(0);
    const diagonal = constrainAngle(base, { x: 100, y: 90 }, false);
    expect(diagonal.x).toBeCloseTo(diagonal.y);
  });
});

describe("CON-01: вид линии", () => {
  const path = [
    { x: 0, y: 0 },
    { x: 100, y: 100 },
    { x: 200, y: 0 },
  ];

  it("прямая идёт через точки отрезками", () => {
    expect(routeSegments("straight", path, null, null)).toEqual([
      [path[0], path[1]],
      [path[1], path[2]],
    ]);
  });

  it("ломаная — только горизонтальные и вертикальные отрезки", () => {
    const route = routeOf({
      segments: routeSegments("elbow", path, null, null),
    });
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1];
      const b = route[i];
      expect(a?.x === b?.x || a?.y === b?.y).toBe(true);
    }
    expect(route).toContainEqual({ x: 100, y: 100 });
  });

  it("ломаная выходит из объекта по направлению точки привязки", () => {
    const [segment] = routeSegments(
      "elbow",
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      { x: 0, y: 1 },
      null,
    );
    expect(segment?.[1]?.x).toBe(0);
  });

  it("кривая проходит через промежуточную точку", () => {
    const route = routeOf({
      segments: routeSegments("curved", path, null, null),
    });
    expect(route).toContainEqual({ x: 100, y: 100 });
    expect(route.length).toBeGreaterThan(path.length);
  });
});

describe("CON-01, CON-07: наконечники", () => {
  it("без наконечника — ничего, иначе контур у конца", () => {
    const tip = { x: 100, y: 0 };
    const origin = { x: 0, y: 0 };
    expect(capPath("none", tip, 0, 10, origin)).toBeNull();
    for (const cap of ["arrow", "triangle", "circle", "diamond"] as const) {
      const path = capPath(cap, tip, 0, 10, origin);
      expect(path?.d).toContain("100 0");
      expect(path?.filled).toBe(cap !== "arrow");
    }
  });
});

describe("CON-03: подписи вдоль линии", () => {
  const route = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("положение — доля длины; проекция точки возвращает ту же долю", () => {
    expect(pointAlong(route, 0.25).point).toEqual({ x: 50, y: 0 });
    expect(pointAlong(route, 0.75)).toEqual({
      point: { x: 100, y: 50 },
      angle: 90,
    });
    expect(projectOnto(route, { x: 140, y: 50 })).toBeCloseTo(0.75);
  });

  it("текст вдоль линии не переворачивается вверх ногами", () => {
    expect(uprightAngle(180)).toBe(0);
    expect(uprightAngle(-135)).toBe(45);
    expect(uprightAngle(90)).toBe(90);
  });

  it("подписи читаются из записи; неверные поля — значения по умолчанию", () => {
    const data = readLineData({
      start: { x: 0, y: 0, object: "a", anchor: "e" },
      end: { x: 10, y: 5, object: "b", anchor: "x" },
      points: [{ x: 1, y: 2 }, "bad"],
      labels: {
        l2: { text: "late", position: 0.9 },
        l1: { text: "early", position: 2, fontSize: -1, orientation: "along" },
      },
    });
    expect(data.start).toEqual({ x: 0, y: 0, object: "a", anchor: "e" });
    expect(data.end).toEqual({ x: 10, y: 5 });
    expect(data.points).toEqual([{ x: 1, y: 2 }]);
    expect(data.labels.map((l) => [l.text, l.position])).toEqual([
      ["late", 0.9],
      ["early", 1],
    ]);
    expect(data.labels[1]).toMatchObject({
      fontSize: 16,
      orientation: "along",
    });
  });
});
