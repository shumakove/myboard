import {
  AUTO_FONT_SIZE,
  COLORS,
  FONT_SIZES,
  NO_COLOR,
  STYLE_KEYS,
  styleKeysOf,
  type StyleKey,
  type StyleOption,
} from "./objectTypes";
import { THICKNESSES } from "./drawSettings";
import { colorCategory, type RecentColors } from "./recentColors";
import { shapeKind } from "./shapes";
import type { SceneObject } from "./sceneObjects";

/** SHP-04: свойства-цвета — у них есть пользовательский цвет и недавние цвета. */
export const COLOR_KEYS: readonly StyleKey[] = [
  "fill",
  "stroke",
  "color",
  "background",
];

export const RECENT_GROUP = "Recent colors";

/**
 * Подпись свойства в панели: обводка линии — её цвет и толщина (T6.4), обводка
 * рисунка — цвет и толщина штриха (DRW-01).
 */
export function styleLabel(
  key: StyleKey,
  selected: readonly SceneObject[],
): string {
  const all = (type: string) =>
    selected.length > 0 && selected.every((o) => o.type === type);
  if (all("line") && key === "stroke") return "Line color";
  if (all("line") && key === "strokeWidth") return "Line width";
  if (all("drawing") && key === "stroke") return "Color";
  if (all("drawing") && key === "strokeWidth") return "Thickness";
  return STYLE_KEYS[key].label;
}

/**
 * Свойства оформления объекта в порядке показа. У фигуры скругление — только у видов
 * с углами (SHP-03), маркер — только у фигур BPMN с маркерами (SHP-02).
 */
export function objectStyleKeys(object: SceneObject): StyleKey[] {
  const keys = styleKeysOf(object.type);
  if (object.type !== "shape") return keys;
  const kind = shapeKind(object.style.shape);
  const withMarker: StyleKey[] =
    kind.markers === undefined ? keys : ["shape", "marker", ...keys.slice(1)];
  return withMarker.filter((key) => key !== "radius" || kind.roundable);
}

/** Свойства, общие для всех выделенных объектов, у которых есть значения. */
export function sharedStyleKeys(
  selected: readonly SceneObject[],
  recent?: RecentColors,
): StyleKey[] {
  if (selected.length === 0) return [];
  const [first, ...rest] = selected.map(objectStyleKeys);
  return (first ?? []).filter(
    (key) =>
      rest.every((keys) => keys.includes(key)) &&
      styleOptions(key, selected, recent).length > 0,
  );
}

/**
 * Значения свойства для выделенных объектов:
 * - STK-02: у стикеров размер шрифта — ещё и Auto;
 * - SHP-02: маркеры — общего для всех выделенных вида фигуры BPMN;
 * - SHP-03: у фигур заливка может быть прозрачной;
 * - SHP-04: у цвета — недавние пользовательские цвета, если все выделенные объекты
 *   одной категории (текст, стикер, фигура или линия).
 */
export function styleOptions(
  key: StyleKey,
  selected: readonly SceneObject[],
  recent?: RecentColors,
): StyleOption[] {
  const types = new Set(selected.map((o) => o.type));
  const only = (type: string) => types.size === 1 && types.has(type);
  if (key === "fontSize" && only("sticky")) {
    return [{ value: AUTO_FONT_SIZE, label: "Auto" }, ...FONT_SIZES];
  }
  if (key === "marker") return markerOptions(selected);
  // CON-01: у линии нет толщины «без линии».
  if (key === "strokeWidth" && only("line")) {
    return STYLE_KEYS.strokeWidth.options.filter((o) => o.value !== 0);
  }
  // DRW-01: толщины штриха — те же, что у пера и маркера.
  if (key === "strokeWidth" && only("drawing")) {
    return THICKNESSES.map((value) => ({ value, label: String(value) }));
  }
  if (!COLOR_KEYS.includes(key)) return STYLE_KEYS[key].options;
  const base =
    key === "fill" && only("shape")
      ? [NO_COLOR, ...COLORS]
      : STYLE_KEYS[key].options;
  return [...base, ...recentOptions(selected, base, recent)];
}

function markerOptions(selected: readonly SceneObject[]): StyleOption[] {
  const kinds = new Set(
    selected.map((o) => (o.type === "shape" ? shapeKind(o.style.shape) : null)),
  );
  const [kind] = kinds;
  if (kinds.size !== 1 || !kind) return [];
  return (kind.markers ?? []).map((marker) => ({
    value: marker.id,
    label: marker.label,
  }));
}

function recentOptions(
  selected: readonly SceneObject[],
  base: readonly StyleOption[],
  recent: RecentColors | undefined,
): StyleOption[] {
  if (recent === undefined) return [];
  const categories = new Set(selected.map((o) => colorCategory(o.type)));
  const [category] = categories;
  if (categories.size !== 1 || !category) return [];
  return recent[category]
    .filter((color) => !base.some((option) => option.value === color))
    .map((color) => ({ value: color, label: color, group: RECENT_GROUP }));
}
