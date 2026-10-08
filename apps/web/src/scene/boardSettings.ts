import { useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";

/**
 * CVS-06: фон доски и шаг сетки. Это свойство доски, общее для всех участников, поэтому
 * лежит в документе доски — корень `settings` (Y.Map), а не в браузере.
 */
export interface BoardSettings {
  background: string;
  /** Шаг сетки в единицах доски; 0 — сетки нет (и прилипания к ней). */
  gridStep: number;
}

export const DEFAULT_SETTINGS: BoardSettings = {
  background: "#fafafa",
  gridStep: 20,
};

export const BACKGROUNDS = [
  { value: "#fafafa", label: "Light gray" },
  { value: "#ffffff", label: "White" },
  { value: "#fdf6e3", label: "Cream" },
  { value: "#e8f5e9", label: "Mint" },
  { value: "#e3f2fd", label: "Sky" },
  { value: "#263238", label: "Dark" },
] as const;

export const GRID_STEPS = [0, 10, 20, 40, 80] as const;

export function readSettings(settings: Y.Map<unknown>): BoardSettings {
  const background = settings.get("background");
  const gridStep = settings.get("gridStep");
  return {
    background:
      typeof background === "string" && /^#[0-9a-f]{6}$/i.test(background)
        ? background
        : DEFAULT_SETTINGS.background,
    gridStep:
      typeof gridStep === "number" && Number.isFinite(gridStep) && gridStep >= 0
        ? gridStep
        : DEFAULT_SETTINGS.gridStep,
  };
}

export function updateSettings(
  settings: Y.Map<unknown>,
  patch: Partial<BoardSettings>,
): void {
  const write = () => {
    for (const [key, value] of Object.entries(patch)) settings.set(key, value);
  };
  if (settings.doc === null) write();
  else settings.doc.transact(write);
}

/** Настройки доски, обновляются при правке любого участника. */
export function useBoardSettings(settings: Y.Map<unknown>): BoardSettings {
  const key = useSyncExternalStore(
    (listener) => {
      settings.observe(listener);
      return () => {
        settings.unobserve(listener);
      };
    },
    () => JSON.stringify(readSettings(settings)),
  );
  return useMemo(() => JSON.parse(key) as BoardSettings, [key]);
}

/** Тёмный фон — точки сетки светлые. */
export function isDark(color: string): boolean {
  const value = Number.parseInt(color.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
