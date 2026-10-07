import { describe, expect, it } from "vitest";
import {
  boundsOf,
  cornerPoint,
  edgeVelocity,
  frameInside,
  groupScale,
  lockAxis,
  placeMenu,
  polygonContains,
  rectContains,
  resizeFrame,
  rotateFrame,
  snap,
  type Frame,
} from "./geometry";

const box: Frame = { x: 0, y: 0, width: 200, height: 100, rotation: 0 };

function close(frame: Frame, expected: Frame) {
  for (const key of ["x", "y", "width", "height", "rotation"] as const) {
    expect(frame[key]).toBeCloseTo(expected[key]);
  }
}

describe("CVS-10: попадание в рамку и лассо", () => {
  it("объект внутри, только если внутри все его углы, с учётом поворота", () => {
    const area = { x: -10, y: -10, width: 220, height: 120 };
    expect(frameInside(box, (p) => rectContains(area, p))).toBe(true);
    // Повёрнутый на 90° объект выходит за рамку по высоте.
    expect(
      frameInside({ ...box, rotation: 90 }, (p) => rectContains(area, p)),
    ).toBe(false);
  });

  it("лассо: точка внутри многоугольника произвольной формы", () => {
    const triangle = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(polygonContains(triangle, { x: 20, y: 20 })).toBe(true);
    expect(polygonContains(triangle, { x: 80, y: 80 })).toBe(false);
  });

  it("общая рамка повёрнутых объектов", () => {
    const bounds = boundsOf([{ ...box, rotation: 90 }]);
    expect(bounds?.x).toBeCloseTo(50);
    expect(bounds?.y).toBeCloseTo(-50);
    expect(bounds?.width).toBeCloseTo(100);
    expect(boundsOf([])).toBeNull();
  });
});

describe("CVS-12: прилипание и ось", () => {
  it("прилипание к сетке; шаг 0 — без прилипания", () => {
    expect(snap(43, 20)).toBe(40);
    expect(snap(51, 20)).toBe(60);
    expect(snap(43, 0)).toBe(43);
  });

  it("Shift оставляет большую из осей", () => {
    expect(lockAxis({ x: 43, y: 11 })).toEqual({ x: 43, y: 0 });
    expect(lockAxis({ x: -3, y: -40 })).toEqual({ x: 0, y: -40 });
  });
});

describe("CVS-13: автопрокрутка у края", () => {
  const size = { width: 800, height: 600 };

  it("у края вид едет в сторону края, тем быстрее, чем ближе", () => {
    expect(edgeVelocity({ x: 400, y: 300 }, size)).toEqual({ x: 0, y: 0 });
    const near = edgeVelocity({ x: 790, y: 300 }, size);
    const nearer = edgeVelocity({ x: 799, y: 300 }, size);
    expect(near.x).toBeGreaterThan(0);
    expect(nearer.x).toBeGreaterThan(near.x);
    expect(edgeVelocity({ x: 400, y: 2 }, size).y).toBeLessThan(0);
  });

  it("неизвестный размер области не прокручивает", () => {
    expect(edgeVelocity({ x: 0, y: 0 }, { width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});

describe("CVS-14: размер и поворот", () => {
  it("угол тянется, противоположный стоит на месте", () => {
    close(resizeFrame(box, "se", { x: 300, y: 250 }), {
      x: 0,
      y: 0,
      width: 300,
      height: 250,
      rotation: 0,
    });
    close(resizeFrame(box, "nw", { x: 50, y: 20 }), {
      x: 50,
      y: 20,
      width: 150,
      height: 80,
      rotation: 0,
    });
  });

  it("у повёрнутого объекта размер меняется в его системе", () => {
    const turned = { ...box, rotation: 90 };
    const fixed = cornerPoint(turned, "nw");
    // Угол se повёрнутого на 90° объекта уходит дальше вдоль его оси x (вниз по экрану).
    const resized = resizeFrame(turned, "se", {
      x: fixed.x - 100,
      y: fixed.y + 300,
    });
    expect(resized.width).toBeCloseTo(300);
    expect(resized.height).toBeCloseTo(100);
    const after = cornerPoint(resized, "nw");
    expect(after.x).toBeCloseTo(fixed.x);
    expect(after.y).toBeCloseTo(fixed.y);
  });

  it("размер не меньше минимального", () => {
    const tiny = resizeFrame(box, "se", { x: -500, y: -500 });
    expect(tiny.width).toBeGreaterThan(0);
    expect(tiny.height).toBeGreaterThan(0);
  });

  it("несколько объектов масштабируются вместе", () => {
    expect(
      groupScale({ x: 0, y: 0, width: 200, height: 100 }, "se", {
        x: 400,
        y: 150,
      }),
    ).toBeCloseTo(2);
  });

  it("поворот вокруг точки", () => {
    close(rotateFrame(box, { x: 100, y: 50 }, 90), { ...box, rotation: 90 });
    const moved = rotateFrame(box, { x: 0, y: 0 }, 180);
    expect(moved.x).toBeCloseTo(-200);
    expect(moved.rotation).toBeCloseTo(180);
  });
});

// BUG-005: меню у края холста целиком остаётся в видимой области.
describe("placeMenu", () => {
  const menu = { width: 190, height: 154 };
  const area = { x: 0, y: 0, width: 1200, height: 540 };

  it("при достатке места открывается от точки вправо-вниз", () => {
    expect(placeMenu({ x: 100, y: 100 }, menu, area)).toEqual({
      x: 100,
      y: 100,
    });
  });

  it("у нижнего края открывается вверх, у правого — влево", () => {
    expect(placeMenu({ x: 100, y: 532 }, menu, area)).toEqual({
      x: 100,
      y: 378,
    });
    expect(placeMenu({ x: 1190, y: 10 }, menu, area)).toEqual({
      x: 1000,
      y: 10,
    });
    const corner = placeMenu({ x: 1195, y: 535 }, menu, area);
    expect(corner).toEqual({ x: 1005, y: 381 });
  });

  it("без места ни в одну сторону прижимается к краю видимой части", () => {
    const visible = { x: 0, y: 200, width: 1200, height: 240 };
    const placed = placeMenu({ x: 50, y: 300 }, menu, visible);
    expect(placed.y).toBeGreaterThanOrEqual(visible.y);
    expect(placed.y + menu.height).toBeLessThanOrEqual(
      visible.y + visible.height,
    );
  });
});
