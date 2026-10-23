import { describe, expect, it } from "vitest";
import { encodeAwareness } from "../realtime/messages";
import {
  beginLine,
  encodeTrail,
  extendLine,
  fade,
  LASER_FADE_MS,
  LASER_MAX_POINTS,
  trailPoints,
  type TimedTrail,
} from "./laser";

/** Предел состояния присутствия на сервере (`MAX_AWARENESS_BYTES`). */
const SERVER_LIMIT = 4096;

describe("DRW-05: след лазера", () => {
  it("каждая точка исчезает через несколько секунд после появления", () => {
    let trail = beginLine([], { x: 0, y: 0 }, 0);
    trail = extendLine(trail, { x: 10, y: 0 }, 1000);
    expect(fade(trail, LASER_FADE_MS - 1)).toHaveLength(1);
    expect(fade(trail, LASER_FADE_MS)[0]).toEqual([{ x: 10, y: 0, at: 1000 }]);
    expect(fade(trail, LASER_FADE_MS + 1000)).toEqual([]);
  });

  it("новое нажатие — новая линия; близкие точки пропускаются", () => {
    let trail = beginLine([], { x: 0, y: 0 }, 0);
    trail = extendLine(trail, { x: 1, y: 1 }, 1);
    trail = beginLine(trail, { x: 50, y: 50 }, 2);
    expect(encodeTrail(trail)).toEqual([
      [0, 0],
      [50, 50],
    ]);
    expect(encodeTrail([])).toBeNull();
  });

  it("след ограничен по числу точек и всегда помещается в предел присутствия сервера", () => {
    let trail: TimedTrail = beginLine([], { x: -9_999_999, y: -9_999_999 }, 0);
    for (let i = 1; i < LASER_MAX_POINTS * 3; i++) {
      trail = extendLine(trail, { x: -9_999_999 + i * 10, y: -9_999_999 }, i);
    }
    const count = trail.reduce((sum, line) => sum + line.length, 0);
    expect(count).toBe(LASER_MAX_POINTS);
    // Остаются новые точки.
    expect(trail.at(-1)?.at(-1)?.at).toBe(LASER_MAX_POINTS * 3 - 1);
    const frame = encodeAwareness({
      cursor: { x: -9_999_999.123, y: -9_999_999.123 },
      camera: { x: -9_999_999.123, y: -9_999_999.123, zoom: 0.123456789 },
      following: "x".repeat(64),
      laser: encodeTrail(trail),
    });
    expect(frame.length).toBeLessThan(SERVER_LIMIT);
  });

  it("линии из канала превращаются в точки", () => {
    expect(trailPoints([[1, 2, 3, 4]])).toEqual([
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
    ]);
  });
});
