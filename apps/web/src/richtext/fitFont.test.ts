import { afterEach, describe, expect, it, vi } from "vitest";
import { fitBoxFont, fitFontSize, MAX_FIT_FONT, MIN_FIT_FONT } from "./fitFont";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("STK-02: автоматический размер шрифта", () => {
  it("наибольший размер, при котором текст помещается", () => {
    expect(fitFontSize((size) => size <= 23)).toBe(23);
    expect(fitFontSize(() => true)).toBe(MAX_FIT_FONT);
    expect(fitFontSize(() => false)).toBe(MIN_FIT_FONT);
    expect(fitFontSize((size) => size <= 10, 10, 10)).toBe(10);
  });

  it("длинный текст получает меньший шрифт, чем короткий", () => {
    // Раскладка: строка ~0,6 em на символ в ширину 200, высота строки 1,25 em.
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        const box = this.parentElement;
        const size = parseFloat(box?.style.fontSize ?? "") || 16;
        const chars = this.textContent.length;
        const lines = Math.max(1, Math.ceil((chars * size * 0.6) / 200));
        return lines * size * 1.25;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(200);
    const fitted = (text: string) => {
      const box = document.createElement("div");
      const content = document.createElement("div");
      content.className = "rich-text";
      content.textContent = text;
      box.append(content);
      fitBoxFont(box);
      return parseFloat(box.style.fontSize);
    };
    const short = fitted("Hi");
    const long = fitted("A much longer sticky note text ".repeat(6));
    expect(long).toBeLessThan(short);
    expect(long).toBeGreaterThanOrEqual(MIN_FIT_FONT);
  });
});
