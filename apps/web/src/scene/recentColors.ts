import { useCallback, useState } from "react";

/**
 * SHP-04: недавно выбранные пользовательские цвета — отдельно для текста, стикера,
 * фигуры и линии. Пользовательский цвет — выбранный в поле выбора цвета, а не из
 * стандартной палитры. Списки хранит браузер (`localStorage`): они общие для всех досок
 * этого браузера и переживают закрытие вкладки (docs/decisions.md, T6.3).
 */
export type ColorCategory = "text" | "sticky" | "shape" | "line";

export const COLOR_CATEGORIES: readonly ColorCategory[] = [
  "text",
  "sticky",
  "shape",
  "line",
];

export const RECENT_COLORS_KEY = "myboard.recentColors";

/** Сколько недавних цветов хранится в каждой категории. */
export const RECENT_LIMIT = 8;

export type RecentColors = Record<ColorCategory, string[]>;

const HEX = /^#[0-9a-f]{6}$/;

/** Цвет в виде `#rrggbb` (нижний регистр); иное — `null`. */
export function normalizeColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  return HEX.test(color) ? color : null;
}

/** Категория цвета по типу объекта; у типов без пользовательских цветов — `null`. */
export function colorCategory(type: string): ColorCategory | null {
  switch (type) {
    case "text":
    case "document":
      return "text";
    case "sticky":
    case "stack":
      return "sticky";
    case "shape":
      return "shape";
    case "line":
      return "line";
    default:
      return null;
  }
}

function empty(): RecentColors {
  return { text: [], sticky: [], shape: [], line: [] };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Списки из хранилища; испорченная запись — пустые списки. */
export function loadRecentColors(): RecentColors {
  const recent = empty();
  try {
    const raw = storage()?.getItem(RECENT_COLORS_KEY);
    if (raw == null) return recent;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return recent;
    for (const category of COLOR_CATEGORIES) {
      const list: unknown = (data as Record<string, unknown>)[category];
      if (!Array.isArray(list)) continue;
      const colors = list.map(normalizeColor).filter((c) => c !== null);
      recent[category] = [...new Set(colors)].slice(0, RECENT_LIMIT);
    }
  } catch {
    // Испорченная запись — как пустая.
  }
  return recent;
}

/** Цвет `color` — первым в списках `categories`; повтор поднимается наверх. */
export function addRecentColor(
  recent: RecentColors,
  categories: readonly ColorCategory[],
  color: string,
): RecentColors {
  const value = normalizeColor(color);
  if (value === null) return recent;
  const next = { ...recent };
  for (const category of new Set(categories)) {
    next[category] = [
      value,
      ...recent[category].filter((c) => c !== value),
    ].slice(0, RECENT_LIMIT);
  }
  return next;
}

/** Недавние цвета вкладки: чтение и запись в хранилище браузера. */
export function useRecentColors(): {
  recent: RecentColors;
  remember: (categories: readonly ColorCategory[], color: string) => void;
} {
  const [recent, setRecent] = useState(loadRecentColors);
  const remember = useCallback(
    (categories: readonly ColorCategory[], color: string) => {
      setRecent((current) => {
        // Список перечитывается: цвет могли добавить в другой вкладке.
        const base = storage() === null ? current : loadRecentColors();
        const next = addRecentColor(base, categories, color);
        try {
          storage()?.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
        } catch {
          // Без хранилища списки живут, пока открыта доска.
        }
        return next;
      });
    },
    [],
  );
  return { recent, remember };
}
