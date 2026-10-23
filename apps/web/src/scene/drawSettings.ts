import { useCallback, useState } from "react";
import type { Brush } from "./drawingShape";
import { normalizeColor } from "./recentColors";

/**
 * Настройки рисования этого браузера (общие для всех досок, `localStorage`):
 * - DRW-01: цвет и толщина пера и маркера;
 * - DRW-02: три пресета толщины — выбранный пресет задаёт толщину, его значение можно
 *   поменять, и оно сохраняется;
 * - MOB-05: режим «стилус сразу рисует».
 */
export const DRAW_SETTINGS_KEY = "myboard.drawSettings";

/** Толщины, из которых выбирают значение пресета. */
export const THICKNESSES: readonly number[] = [
  1, 2, 3, 4, 6, 8, 12, 16, 24, 32,
];

export interface BrushSettings {
  color: string;
  /** DRW-02: три пресета толщины. */
  presets: [number, number, number];
  /** Номер выбранного пресета: 0, 1 или 2. */
  preset: number;
}

export interface DrawSettings {
  pen: BrushSettings;
  marker: BrushSettings;
  /** MOB-05: стилус рисует пером при инструменте Select — без выбора инструмента. */
  stylusDraws: boolean;
}

export const DEFAULT_DRAW_SETTINGS: DrawSettings = {
  pen: { color: "#1f2937", presets: [2, 4, 8], preset: 1 },
  marker: { color: "#fff176", presets: [12, 16, 24], preset: 1 },
  stylusDraws: false,
};

/** Толщина выбранного пресета кисти. */
export function brushWidth(settings: BrushSettings): number {
  return settings.presets[settings.preset] ?? settings.presets[0];
}

/** DRW-02: новое значение выбранного пресета. */
export function setPresetWidth(
  settings: BrushSettings,
  width: number,
): BrushSettings {
  const presets = [...settings.presets] as BrushSettings["presets"];
  presets[settings.preset] = width;
  return { ...settings, presets };
}

function readBrush(value: unknown, fallback: BrushSettings): BrushSettings {
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const color = normalizeColor(record.color) ?? fallback.color;
  const presets =
    Array.isArray(record.presets) &&
    record.presets.length === 3 &&
    record.presets.every((w) => THICKNESSES.includes(w as number))
      ? (record.presets as BrushSettings["presets"])
      : fallback.presets;
  const preset =
    record.preset === 0 || record.preset === 1 || record.preset === 2
      ? record.preset
      : fallback.preset;
  return { color, presets, preset };
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Сохранённые настройки; испорченная запись — значения по умолчанию. */
export function loadDrawSettings(): DrawSettings {
  try {
    const raw = storage()?.getItem(DRAW_SETTINGS_KEY);
    if (raw == null) return DEFAULT_DRAW_SETTINGS;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return DEFAULT_DRAW_SETTINGS;
    const record = data as Record<string, unknown>;
    return {
      pen: readBrush(record.pen, DEFAULT_DRAW_SETTINGS.pen),
      marker: readBrush(record.marker, DEFAULT_DRAW_SETTINGS.marker),
      stylusDraws: record.stylusDraws === true,
    };
  } catch {
    return DEFAULT_DRAW_SETTINGS;
  }
}

function saveDrawSettings(settings: DrawSettings): void {
  try {
    storage()?.setItem(DRAW_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Без хранилища настройки живут, пока открыта доска.
  }
}

/** Настройки рисования вкладки с сохранением в браузере. */
export function useDrawSettings(): {
  settings: DrawSettings;
  setBrush: (
    brush: Brush,
    change: (current: BrushSettings) => BrushSettings,
  ) => void;
  setStylusDraws: (on: boolean) => void;
} {
  const [settings, setSettings] = useState(loadDrawSettings);
  const update = useCallback(
    (change: (current: DrawSettings) => DrawSettings) => {
      setSettings((current) => {
        const next = change(current);
        saveDrawSettings(next);
        return next;
      });
    },
    [],
  );
  const setBrush = useCallback(
    (brush: Brush, change: (current: BrushSettings) => BrushSettings) => {
      update((current) => ({ ...current, [brush]: change(current[brush]) }));
    },
    [update],
  );
  const setStylusDraws = useCallback(
    (on: boolean) => {
      update((current) => ({ ...current, stylusDraws: on }));
    },
    [update],
  );
  return { settings, setBrush, setStylusDraws };
}
