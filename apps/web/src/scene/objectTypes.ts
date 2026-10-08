/**
 * Типы объектов сцены, которые ставит T5.2, и их свойства (CVS-09, CVS-11, CVS-14).
 * Остальные типы из раздела объектов требований добавляют задачи T6.*, T7.* — тем же
 * описанием.
 */
export type ObjectType = "sticky" | "shape" | "text";

/** Свойства оформления, которые меняются в панели выделения (CVS-11). */
export type StyleKey = "fill" | "stroke" | "color" | "fontSize";

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
    style: { color: "#1f2937", fontSize: 24 },
  },
};

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

/** Подпись и допустимые значения каждого свойства оформления. */
export const STYLE_KEYS: Record<
  StyleKey,
  { label: string; options: StyleOption[] }
> = {
  fill: { label: "Fill", options: COLORS },
  stroke: { label: "Border", options: COLORS },
  color: { label: "Text color", options: COLORS },
  fontSize: {
    label: "Font size",
    options: [12, 16, 24, 36, 48, 72].map((size) => ({
      value: size,
      label: String(size),
    })),
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
