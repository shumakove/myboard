import { describe, expect, it } from "vitest";

// Все таблицы стилей приложения как текст.
const sheets = import.meta.glob<string>("/src/**/*.css", {
  query: "?raw",
  import: "default",
  eager: true,
});

const THEME = "/src/ui/theme.css";
const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/i;

describe("UI-01, UI-02: единая светлая тема", () => {
  it("тема задаёт светлую схему и не меняет вид при системной тёмной теме", () => {
    expect(Object.keys(sheets).length).toBeGreaterThan(5);
    const theme = sheets[THEME];
    expect(theme).toContain("color-scheme: light");
    for (const [path, css] of Object.entries(sheets)) {
      expect(css, path).not.toMatch(/prefers-color-scheme/);
    }
  });

  it("цвета и тени — только переменные темы: в остальных файлах нет своих значений", () => {
    const offenders = Object.entries(sheets)
      .filter(([path]) => path !== THEME)
      .flatMap(([path, css]) =>
        css
          .split("\n")
          .filter((line) => COLOR_LITERAL.test(line))
          .map((line) => `${path}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it("шрифт задан один раз — переменной темы, остальные берут её", () => {
    const declaring = Object.entries(sheets)
      .filter(([, css]) => /(?<!-)font-family:(?!\s*var\()/.test(css))
      .map(([path]) => path);
    expect(declaring).toEqual([]);
  });
});
