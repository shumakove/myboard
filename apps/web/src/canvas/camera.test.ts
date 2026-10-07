import { describe, expect, it } from "vitest";
import {
  boardToScreen,
  centerOn,
  HOME,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  pinch,
  screenToBoard,
  viewRect,
  zoomAt,
  zoomBy,
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

  it("CVS-01: у плоскости нет края — вид уходит сколь угодно далеко от начала", () => {
    let camera = HOME;
    for (let i = 0; i < 1000; i++) camera = panBy(camera, -10_000, 10_000);
    expect(camera).toEqual({ x: 10_000_000, y: -10_000_000, zoom: 1 });
    const far = { x: 10_000_120, y: -9_999_950 };
    expect(boardToScreen(far, camera, SIZE)).toEqual({ x: 520, y: 350 });
  });

  it("CVS-02: сдвиг двигает содержимое вслед за указателем", () => {
    const point = { x: 10, y: 20 };
    const before = boardToScreen(point, HOME, SIZE);
    const after = boardToScreen(point, panBy(HOME, 30, -15), SIZE);
    expect(after).toEqual({ x: before.x + 30, y: before.y - 15 });
  });

  it("CVS-02: масштаб колесом сохраняет точку под указателем и ограничен", () => {
    const anchor = { x: 650, y: 120 };
    const under = screenToBoard(anchor, HOME, SIZE);
    const zoomed = zoomAt(HOME, 2, anchor, SIZE);
    expect(zoomed.zoom).toBe(2);
    expect(screenToBoard(anchor, zoomed, SIZE)).toEqual(under);

    expect(zoomAt(HOME, 1000, anchor, SIZE).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(HOME, 0.0001, anchor, SIZE).zoom).toBe(MIN_ZOOM);
  });

  it("CVS-02: масштаб кнопками — относительно центра вида, в пределах", () => {
    const camera = { x: 40, y: -7, zoom: 1 };
    expect(zoomBy(camera, 2)).toEqual({ x: 40, y: -7, zoom: 2 });
    expect(zoomBy({ ...camera, zoom: MAX_ZOOM }, 2).zoom).toBe(MAX_ZOOM);
    expect(zoomBy({ ...camera, zoom: MIN_ZOOM }, 0.5).zoom).toBe(MIN_ZOOM);
  });

  it("CVS-04: переход ставит центр вида в точку, масштаб прежний; видимая часть доски", () => {
    const camera = centerOn({ x: 0, y: 0, zoom: 2 }, { x: 500, y: 300 });
    expect(camera).toEqual({ x: 500, y: 300, zoom: 2 });
    expect(viewRect(camera, SIZE)).toEqual({
      x: 300,
      y: 150,
      width: 400,
      height: 300,
    });
  });

  it("MOB-02: щипок масштабирует как расстояние между пальцами", () => {
    const camera = pinch(
      HOME,
      [
        { x: 350, y: 300 },
        { x: 450, y: 300 },
      ],
      [
        { x: 300, y: 300 },
        { x: 500, y: 300 },
      ],
      SIZE,
    );
    expect(camera).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it("MOB-02: точка доски между пальцами идёт за пальцами", () => {
    const from = [
      { x: 100, y: 100 },
      { x: 200, y: 200 },
    ] as const;
    const to = [
      { x: 300, y: 50 },
      { x: 500, y: 250 },
    ] as const;
    const under = screenToBoard({ x: 150, y: 150 }, HOME, SIZE);
    const camera = pinch(HOME, from, to, SIZE);
    expect(camera.zoom).toBe(2);
    expect(boardToScreen(under, camera, SIZE)).toEqual({ x: 400, y: 150 });
  });

  it("MOB-02: совпавшие пальцы не ломают вид", () => {
    const same = { x: 10, y: 10 };
    const camera = pinch(HOME, [same, same], [same, { x: 20, y: 10 }], SIZE);
    expect(camera.zoom).toBe(1);
    expect(Number.isFinite(camera.x)).toBe(true);
  });
});
