import { describe, expect, it } from "vitest";
import {
  boardToScreen,
  HOME,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  screenToBoard,
  zoomAt,
} from "./camera";

const SIZE = { width: 800, height: 600 };

describe("камера холста", () => {
  it("центр экрана — центр вида; переводы точек взаимно обратны", () => {
    const camera = { x: 100, y: -50, zoom: 2 };
    expect(screenToBoard({ x: 400, y: 300 }, camera, SIZE)).toEqual({
      x: 100,
      y: -50,
    });
    const point = { x: 130, y: -20 };
    expect(
      screenToBoard(boardToScreen(point, camera, SIZE), camera, SIZE),
    ).toEqual(point);
  });

  it("сдвиг двигает содержимое вслед за указателем", () => {
    const point = { x: 10, y: 20 };
    const before = boardToScreen(point, HOME, SIZE);
    const after = boardToScreen(point, panBy(HOME, 30, -15), SIZE);
    expect(after).toEqual({ x: before.x + 30, y: before.y - 15 });
  });

  it("масштаб сохраняет точку под указателем и ограничен", () => {
    const anchor = { x: 650, y: 120 };
    const under = screenToBoard(anchor, HOME, SIZE);
    const zoomed = zoomAt(HOME, 2, anchor, SIZE);
    expect(zoomed.zoom).toBe(2);
    expect(screenToBoard(anchor, zoomed, SIZE)).toEqual(under);

    expect(zoomAt(HOME, 1000, anchor, SIZE).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(HOME, 0.0001, anchor, SIZE).zoom).toBe(MIN_ZOOM);
  });
});
