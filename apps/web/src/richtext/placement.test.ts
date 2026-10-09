import { describe, expect, it } from "vitest";
import { fits, menuPlacement, toolbarBelow, type Box } from "./placement";

const area: Box = { top: 0, bottom: 900, left: 0, right: 1440 };
/** Панель вида вверху справа и миникарта внизу справа. */
const panels: Box[] = [
  { top: 8, bottom: 56, left: 1100, right: 1432 },
  { top: 740, bottom: 892, left: 1230, right: 1432 },
];

describe("BUG-012: панель оформления и меню «/» видны целиком", () => {
  it("панель — над полем, а у верхнего края или под панелью вида — под полем", () => {
    const size = { width: 260, height: 44 };
    const middle = { top: 400, bottom: 500, left: 300, right: 600 };
    expect(toolbarBelow(middle, size, area, panels)).toBe(false);
    const nearTop = { top: 20, bottom: 120, left: 300, right: 600 };
    expect(toolbarBelow(nearTop, size, area, panels)).toBe(true);
    const underView = { top: 90, bottom: 190, left: 1150, right: 1400 };
    expect(toolbarBelow(underView, size, area, panels)).toBe(true);
  });

  it("меню — под строкой, а у нижнего края — над ней, целиком в окне", () => {
    const size = { width: 200, height: 400 };
    const caret = (top: number, left = 300): Box => ({
      top,
      bottom: top + 20,
      left,
      right: left,
    });
    expect(menuPlacement(caret(200), size, area, panels)).toEqual({
      above: false,
      shift: 0,
    });
    const low = menuPlacement(caret(720), size, area, panels);
    expect(low.above).toBe(true);
    const shown = { top: 720 - 400, bottom: 720, left: 300, right: 500 };
    expect(fits(shown, area, panels)).toBe(true);
  });

  it("меню не заходит под миникарту и за правый край", () => {
    const size = { width: 200, height: 300 };
    const caret = { top: 500, bottom: 520, left: 1300, right: 1300 };
    const placed = menuPlacement(caret, size, area, panels);
    expect(placed.above).toBe(true);
    expect(caret.left + placed.shift + size.width).toBeLessThanOrEqual(
      area.right,
    );
  });
});
