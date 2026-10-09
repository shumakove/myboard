/**
 * Типы объектов сцены и их свойства (CVS-09, CVS-11, CVS-14): стикер, фигура и текст
 * (T5.2), документ (T6.1, TXT-06). Остальные типы из раздела объектов требований
 * добавляют задачи T6.*, T7.* — тем же описанием.
 */
export type ObjectType = "sticky" | "shape" | "text" | "document";

/**
 * Свойства оформления, которые меняются в панели выделения (CVS-11). Текст и документ:
 * шрифт, размер, цвет, начертание, выравнивание, межстрочный интервал и фон (TXT-01).
 */
export type StyleKey =
  | "fill"
  | "stroke"
  | "fontFamily"
  | "fontSize"
  | "color"
  | "fontStyle"
  | "align"
  | "lineHeight"
  | "background";

/** Типы с форматированным текстом (TXT-01…TXT-08): редактор и показ — `richtext/`. */
export const RICH_TEXT_TYPES: readonly string[] = ["text", "document"];

export function isRichText(type: string): boolean {
  return RICH_TEXT_TYPES.includes(type);
}

export interface StyleOption {
  value: string | number;
  label: string;
}

export interface ObjectTypeSpec {
  type: ObjectType;
  /** Название типа в интерфейсе, единственное и множественное число. */
  label: string;
  plural: string;
  /** Размер нового объекта, единицы доски. */
  width: number;
  height: number;
  /** CVS-14: поворот предусмотрен. */
  rotatable: boolean;
  /** Свойства оформления и их значения у нового объекта. */
  style: Partial<Record<StyleKey, string | number>>;
}

export const OBJECT_TYPES: Record<ObjectType, ObjectTypeSpec> = {
  sticky: {
    type: "sticky",
    label: "Sticky note",
    plural: "sticky notes",
    width: 200,
    height: 200,
    rotatable: false,
    style: { fill: "#fff176" },
  },
  shape: {
    type: "shape",
    label: "Shape",
    plural: "shapes",
    width: 200,
    height: 120,
    rotatable: true,
    style: { fill: "#ffffff", stroke: "#1f2937" },
  },
  text: {
    type: "text",
    label: "Text",
    plural: "texts",
    width: 240,
    height: 60,
    rotatable: true,
    style: {
      fontFamily: "sans",
      fontSize: 24,
      color: "#1f2937",
      fontStyle: "normal",
      align: "left",
      lineHeight: 1.25,
      background: "transparent",
    },
  },
  document: {
    type: "document",
    label: "Document",
    plural: "documents",
    width: 480,
    height: 360,
    rotatable: false,
    style: {
      fontFamily: "sans",
      fontSize: 16,
      color: "#1f2937",
      fontStyle: "normal",
      align: "left",
      lineHeight: 1.5,
      background: "#ffffff",
    },
  },
};

/** Тип объекта-группы (CVS-17): рамка группы — описанный прямоугольник её объектов. */
export const GROUP_TYPE = "group";

/** Название типа в интерфейсе: «Sticky note» / «sticky notes»; группа — «Group» / «groups». */
export function typeName(type: string, plural = false): string {
  if (type === GROUP_TYPE) return plural ? "groups" : "Group";
  const spec = typeSpec(type);
  if (spec === undefined) return plural ? "objects" : "Object";
  return plural ? spec.plural : spec.label;
}

export function typeSpec(type: string): ObjectTypeSpec | undefined {
  return Object.hasOwn(OBJECT_TYPES, type)
    ? OBJECT_TYPES[type as ObjectType]
    : undefined;
}

const COLORS: StyleOption[] = [
  { value: "#fff176", label: "Yellow" },
  { value: "#ffb74d", label: "Orange" },
  { value: "#f48fb1", label: "Pink" },
  { value: "#81d4fa", label: "Blue" },
  { value: "#a5d6a7", label: "Green" },
  { value: "#ce93d8", label: "Purple" },
  { value: "#ffffff", label: "White" },
  { value: "#1f2937", label: "Black" },
];

/** TXT-01: шрифты текста — ключ в документе, набор шрифтов — в `FONT_STACKS`. */
export const FONT_STACKS: Record<string, string> = {
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  serif: 'Georgia, "Times New Roman", Times, serif',
  mono: 'ui-monospace, Menlo, Consolas, "Courier New", monospace',
  hand: '"Comic Sans MS", "Marker Felt", "Segoe Print", cursive',
};

/**
 * TXT-01: свойства текста, которые панель выделения показывает под кнопкой Text style,
 * чтобы панель оставалась в одну строку.
 */
export const MORE_TEXT_KEYS: readonly StyleKey[] = [
  "fontFamily",
  "fontStyle",
  "align",
  "lineHeight",
  "background",
];

/** Подпись и допустимые значения каждого свойства оформления. */
export const STYLE_KEYS: Record<
  StyleKey,
  { label: string; options: StyleOption[] }
> = {
  fill: { label: "Fill", options: COLORS },
  stroke: { label: "Border", options: COLORS },
  fontFamily: {
    label: "Font",
    options: [
      { value: "sans", label: "Sans" },
      { value: "serif", label: "Serif" },
      { value: "mono", label: "Monospace" },
      { value: "hand", label: "Handwritten" },
    ],
  },
  fontSize: {
    label: "Font size",
    options: [12, 14, 16, 18, 24, 32, 36, 48, 64, 72].map((size) => ({
      value: size,
      label: String(size),
    })),
  },
  color: { label: "Text color", options: COLORS },
  fontStyle: {
    label: "Style",
    options: [
      { value: "normal", label: "Regular" },
      { value: "bold", label: "Bold" },
      { value: "italic", label: "Italic" },
      { value: "bold-italic", label: "Bold italic" },
      { value: "underline", label: "Underline" },
      { value: "strike", label: "Strikethrough" },
    ],
  },
  align: {
    label: "Align",
    options: [
      { value: "left", label: "Left" },
      { value: "center", label: "Center" },
      { value: "right", label: "Right" },
      { value: "justify", label: "Justify" },
    ],
  },
  lineHeight: {
    label: "Line spacing",
    options: [1, 1.25, 1.5, 2, 2.5].map((value) => ({
      value,
      label: String(value),
    })),
  },
  background: {
    label: "Background",
    options: [{ value: "transparent", label: "None" }, ...COLORS],
  },
};

/** Свойства оформления типа в порядке показа. */
export function styleKeysOf(type: string): StyleKey[] {
  const spec = typeSpec(type);
  if (spec === undefined) return [];
  return (Object.keys(STYLE_KEYS) as StyleKey[]).filter((key) =>
    Object.hasOwn(spec.style, key),
  );
}
