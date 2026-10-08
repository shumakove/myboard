import { describe, expect, it } from "vitest";
import {
  fitWorld,
  MIN_VIEW_FRAME,
  minimapWorld,
  toBoard,
  toMinimap,
  visibleFrame,
} from "./minimapFit";

describe("CVS-04: миникарта", () => {
  it("показывает объекты, видимую область и начало координат с полем", () => {
    const world = minimapWorld([{ x: 1000, y: 500, width: 200, height: 100 }], {
      x: -100,
      y: -50,
      width: 200,
      height: 100,
    });
    // Содержимое: x от −100 до 1200, y от −50 до 600; поле — 10% большей стороны.
    expect(world).toEqual({ x: -230, y: -180, width: 1560, height: 910 });
  });

  it("далёкий объект попадает на миникарту вместе с видимой областью", () => {
    const far = { x: 1_000_000, y: -2_000_000, width: 100, height: 100 };
    const view = { x: -400, y: -300, width: 800, height: 600 };
    const world = minimapWorld([far], view);
    const fit = fitWorld(world, { width: 160, height: 110 });
    for (const rect of [far, view]) {
      const shown = toMinimap(rect, fit);
      expect(shown.x).toBeGreaterThanOrEqual(0);
      expect(shown.y).toBeGreaterThanOrEqual(0);
      expect(shown.x + shown.width).toBeLessThanOrEqual(160);
      expect(shown.y + shown.height).toBeLessThanOrEqual(110);
    }
  });

  it("точка миникарты переводится обратно в точку доски", () => {
    const fit = fitWorld(
      { x: -100, y: -100, width: 1000, height: 500 },
      { width: 160, height: 110 },
    );
    const target = { x: 640, y: 210, width: 0, height: 0 };
    const shown = toMinimap(target, fit);
    const back = toBoard({ x: shown.x, y: shown.y }, fit);
    expect(back.x).toBeCloseTo(640);
    expect(back.y).toBeCloseTo(210);
  });
});

describe("BUG-003: рамка видимой области на миникарте", () => {
  it("не меньше нескольких px, центр на месте", () => {
    const frame = visibleFrame({
      x: 44.5,
      y: 63.9,
      width: 0.0129,
      height: 0.0096,
    });
    expect(frame.width).toBe(MIN_VIEW_FRAME.width);
    expect(frame.height).toBe(MIN_VIEW_FRAME.height);
    expect(frame.x + frame.width / 2).toBeCloseTo(44.5 + 0.0129 / 2);
    expect(frame.y + frame.height / 2).toBeCloseTo(63.9 + 0.0096 / 2);
  });

  it("крупная рамка не меняется", () => {
    const big = { x: 1, y: 2, width: 50, height: 40 };
    expect(visibleFrame(big)).toEqual(big);
  });
});
