import { describe, expect, it } from "vitest";
import { clearBackground } from "./backgroundRemoval";

type Rgba = [number, number, number, number];

const WHITE: Rgba = [255, 255, 255, 255];
const RED: Rgba = [220, 30, 30, 255];

/** Картинка `size`×`size`, каждый пиксель — цвет `paint(x, y)`. */
function picture(size: number, paint: (x: number, y: number) => Rgba) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) data.set(paint(x, y), (y * size + x) * 4);
  }
  return data;
}

function alpha(data: Uint8ClampedArray, size: number, x: number, y: number) {
  return data[(y * size + x) * 4 + 3];
}

describe("IMG-05: удаление фона", () => {
  it("фон по краю прозрачный, предмет посередине остаётся", () => {
    const size = 20;
    const inside = (x: number, y: number) =>
      x >= 5 && x < 15 && y >= 5 && y < 15;
    const data = picture(size, (x, y) => (inside(x, y) ? RED : WHITE));

    const cleared = clearBackground(data, size, size);

    expect(cleared).toBe(size * size - 100);
    expect(alpha(data, size, 0, 0)).toBe(0);
    expect(alpha(data, size, 4, 10)).toBe(0);
    expect(alpha(data, size, 10, 10)).toBe(255);
    expect(alpha(data, size, 5, 5)).toBe(255);
  });

  it("фон с шумом в пределах допуска убирается целиком", () => {
    const size = 10;
    const data = picture(size, (x, y) =>
      x === 5 && y === 5 ? RED : [250 - ((x + y) % 3) * 4, 252, 248, 255],
    );

    clearBackground(data, size, size);

    expect(alpha(data, size, 0, 9)).toBe(0);
    expect(alpha(data, size, 4, 5)).toBe(0);
    expect(alpha(data, size, 5, 5)).toBe(255);
  });

  it("цвет фона внутри замкнутого контура предмета остаётся", () => {
    const size = 15;
    const ring = (x: number, y: number) =>
      (x === 3 || x === 11 || y === 3 || y === 11) &&
      x >= 3 &&
      x <= 11 &&
      y >= 3 &&
      y <= 11;
    const data = picture(size, (x, y) => (ring(x, y) ? RED : WHITE));

    clearBackground(data, size, size);

    expect(alpha(data, size, 0, 0)).toBe(0);
    expect(alpha(data, size, 3, 7)).toBe(255);
    // Белое внутри кольца не связано с краем — не фон.
    expect(alpha(data, size, 7, 7)).toBe(255);
  });

  it("уже прозрачный край — фон; предмет без фона не меняется", () => {
    const size = 8;
    const data = picture(size, (x, y) =>
      x === 0 || y === 0 ? [0, 0, 0, 0] : RED,
    );

    clearBackground(data, size, size);

    expect(alpha(data, size, 0, 3)).toBe(0);
    expect(alpha(data, size, 4, 4)).toBe(255);
  });
});
