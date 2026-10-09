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

  it("UI-01: серая шкала и цвета текста, границ, теней — чистые серые (R = G = B)", () => {
    const theme = sheets[THEME] ?? "";
    const grays = [...theme.matchAll(/--gray-\d+:\s*#([0-9a-f]{6});/gi)].map(
      (m) => m[1] ?? "",
    );
    expect(grays.length).toBeGreaterThanOrEqual(10);
    // Тени и затемнение — тоже без оттенка; полупрозрачный акцент — не серый.
    const shades = [
      ...theme.matchAll(/rgb\((\d+) (\d+) (\d+) \/ [\d.]+%\)/g),
    ].filter((m) => !m[0].startsWith("rgb(67 89 236"));
    const tinted = [
      ...grays.filter((hex) => {
        const [r, g, b] = [0, 2, 4].map((k) => hex.slice(k, k + 2));
        return r !== g || g !== b;
      }),
      ...shades.filter((m) => m[1] !== m[2] || m[2] !== m[3]).map((m) => m[0]),
    ];
    expect(tinted).toEqual([]);
  });

  it("BUG-009: высоту кнопок задаёт только ui.css — тихие кнопки одной высоты везде", () => {
    const overrides = Object.entries(sheets)
      .filter(([path]) => path !== "/src/ui/ui.css")
      .flatMap(([path, css]) =>
        [...css.matchAll(/([^{}]*\.ui-button[^{}]*)\{([^}]*)\}/g)]
          .filter((m) => /(?:^|[\s;])(?:min-)?height\s*:/.test(m[2] ?? ""))
          .map((m) => `${path}: ${(m[1] ?? "").trim()}`),
      );
    expect(overrides).toEqual([]);
  });
});
