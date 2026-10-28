import { DEFAULT_SHAPE, SHAPE_KINDS, SHAPE_SETS } from "./shapes";

/**
 * Типы объектов сцены и их свойства (CVS-09, CVS-11, CVS-14): стикер, фигура и текст
 * (T5.2), документ (T6.1, TXT-06), стопка стикеров (T6.2, STK-05); виды фигур — T6.3
 * (`shapes.ts`, SHP-01, SHP-02), линия (T6.4), рисунок (T6.5, DRW-01), фрейм (T6.6,
 * `frames.ts`, FRM-01…FRM-05), таблица (T6.7, `tables.ts`, TBL-01…TBL-07), канбан и карточка
 * задачи (T6.8, `kanbans.ts`, KBN-01…KBN-03), интеллект-карта (T6.9, `mindmaps.ts`,
 * MAP-01…MAP-04), реакция, флип-карточка и кубик (T6.11, `reactionData.ts`, `flipData.ts`,
 * `diceData.ts`; RCT-01…RCT-04, FLP-01…FLP-03, DICE-01…DICE-03). Остальные типы
 * из раздела объектов требований добавляют задачи T7.* — тем же описанием.
 */
export type ObjectType =
  | "sticky"
  | "shape"
  | "text"
  | "document"
  | "stack"
  | "line"
  | "drawing"
  | "frame"
  | "table"
  | "kanban"
  | "card"
  | "mindmap"
  | "reaction"
  | "flipcard"
  | "dice"
  | "image";

/**
 * Типы, которые ставят щелчком или из меню; рисунок появляется только штрихом (DRW-01),
 * реакция — только на объект своим инструментом (RCT-01), изображение — загрузкой файла
 * (IMG-01).
 */
export type PlaceableType = Exclude<
  ObjectType,
  "drawing" | "reaction" | "image"
>;

export function isPlaceable(type: ObjectType): type is PlaceableType {
  return type !== "drawing" && type !== "reaction" && type !== "image";
}

/**
 * Свойства оформления, которые меняются в панели выделения (CVS-11). Текст и документ:
 * шрифт, размер, цвет, начертание, выравнивание, межстрочный интервал и фон (TXT-01).
 * Фигура: вид и маркер BPMN (SHP-01, SHP-02), заливка, обводка и её толщина,
 * скругление углов, текст с межстрочным интервалом (SHP-03). Линия: вид (прямая,
 * ломаная, кривая) и наконечники концов (CON-01, CON-07), цвет и толщина. Фрейм:
 * вид оформления и цвет (FRM-02).
 */
export type StyleKey =
  | "appearance"
  | "shape"
  | "marker"
  | "lineStyle"
  | "startCap"
  | "endCap"
  | "fill"
  | "stroke"
  | "strokeWidth"
  | "radius"
  | "fontFamily"
  | "fontSize"
  | "color"
  | "fontStyle"
  | "align"
  | "lineHeight"
  | "background";

/**
 * Типы с форматированным текстом (TXT-01…TXT-08): редактор и показ — `richtext/`.
 * Текст стикера — тоже `Y.Text` с атрибутами (T6.2).
 */
export const RICH_TEXT_TYPES: readonly string[] = [
  "text",
  "document",
  "sticky",
];

export function isRichText(type: string): boolean {
  return RICH_TEXT_TYPES.includes(type);
}

/** STK-02: значение `fontSize` стикера «подгонять шрифт под размер стикера». */
export const AUTO_FONT_SIZE = "auto";

export interface StyleOption {
  value: string | number;
  label: string;
  /** Подзаголовок группы значений в списке (набор фигур). */
  group?: string;
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
  /** У объекта есть свой текст (поле ввода по двойному щелчку и Edit text). */
  editable: boolean;
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
    editable: true,
    // STK-02: размер шрифта — число или автоматический подгон под стикер.
    style: { fill: "#fff176", fontSize: AUTO_FONT_SIZE },
  },
  shape: {
    type: "shape",
    label: "Shape",
    plural: "shapes",
    width: 200,
    height: 120,
    rotatable: true,
    editable: true,
    // SHP-01, SHP-03: вид фигуры, контур и текст внутри (по центру).
    style: {
      shape: DEFAULT_SHAPE,
      fill: "#ffffff",
      stroke: "#1f2937",
      strokeWidth: 2,
      radius: 0,
      fontSize: 18,
      color: "#1f2937",
      align: "center",
      lineHeight: 1.25,
    },
  },
  text: {
    type: "text",
    label: "Text",
    plural: "texts",
    width: 240,
    height: 60,
    rotatable: true,
    editable: true,
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
    editable: true,
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
  // STK-05: стопка — из неё вытягивают стикеры её цвета и с её тегами; своего текста нет.
  stack: {
    type: "stack",
    label: "Sticky stack",
    plural: "sticky stacks",
    width: 200,
    height: 200,
    rotatable: false,
    editable: false,
    style: { fill: "#fff176" },
  },
  // CON-01: линия — концы и точки изгиба вместо рамки (`connectors.ts`); рамка на сцене
  // вычисляется по её точкам, поэтому размер в документе — 0.
  line: {
    type: "line",
    label: "Line",
    plural: "lines",
    width: 0,
    height: 0,
    rotatable: false,
    editable: false,
    style: {
      lineStyle: "straight",
      startCap: "none",
      endCap: "arrow",
      stroke: "#1f2937",
      strokeWidth: 2,
    },
  },
  // DRW-01, DRW-06: штрих пера или маркера — точки в рамке (`drawingShape.ts`); размер
  // рамки растягивает штрих. Размер в документе задаёт сам штрих.
  drawing: {
    type: "drawing",
    label: "Drawing",
    plural: "drawings",
    width: 1,
    height: 1,
    rotatable: true,
    editable: false,
    style: { stroke: "#1f2937", strokeWidth: 4 },
  },
  // FRM-01: фрейм — родитель объектов, попавших в него (`frames.ts`); FRM-02: вид
  // оформления и цвет. Поворота нет: дети лежат в его системе координат по осям.
  frame: {
    type: "frame",
    label: "Frame",
    plural: "frames",
    width: 640,
    height: 480,
    rotatable: false,
    editable: false,
    style: { appearance: "fill", fill: "#ffffff" },
  },
  // TBL-01…TBL-05: таблица — столбцы, строки и ячейки (`tableData.ts`); размер рамки —
  // сумма их размеров (3×3 по 160×48). Оформление — у ячеек, текст — в ячейках.
  table: {
    type: "table",
    label: "Table",
    plural: "tables",
    width: 480,
    height: 144,
    rotatable: false,
    editable: false,
    style: {},
  },
  // KBN-01, KBN-03: канбан — столбцы с названиями (`kanbanData.ts`); ширина рамки — число
  // столбцов × 280, высота растёт под карточки. Оформления и своего текста нет.
  kanban: {
    type: "kanban",
    label: "Kanban",
    plural: "kanbans",
    width: 840,
    height: 480,
    rotatable: false,
    editable: false,
    style: {},
  },
  // KBN-02: карточка задачи — текст и теги; в столбце канбана выстраивается по порядку.
  card: {
    type: "card",
    label: "Card",
    plural: "cards",
    width: 240,
    height: 96,
    rotatable: false,
    editable: true,
    style: { fill: "#ffffff" },
  },
  // MAP-01…MAP-04: интеллект-карта — дерево узлов (`mindmapData.ts`); рамка — по раскладке
  // узлов. Оформление и названия — у узлов.
  mindmap: {
    type: "mindmap",
    label: "Mind map",
    plural: "mind maps",
    width: 400,
    height: 120,
    rotatable: false,
    editable: false,
    style: {},
  },
  // RCT-01…RCT-03: реакция-штамп — изображение из набора на объекте-родителе; размер —
  // каким его вырастили удержанием. Оформления и текста нет.
  reaction: {
    type: "reaction",
    label: "Reaction",
    plural: "reactions",
    width: 48,
    height: 48,
    rotatable: false,
    editable: false,
    style: {},
  },
  // FLP-01…FLP-03: флип-карточка — две стороны со своим текстом, оформлением текста,
  // цветом и картинкой (`flipData.ts`); общий текст объекта — лицевая сторона.
  flipcard: {
    type: "flipcard",
    label: "Flip card",
    plural: "flip cards",
    width: 240,
    height: 160,
    rotatable: false,
    editable: true,
    style: {},
  },
  // DICE-01: кубик — число граней и цвет; DICE-02: последнее выпавшее значение.
  dice: {
    type: "dice",
    label: "Dice",
    plural: "dice",
    width: 96,
    height: 96,
    rotatable: false,
    editable: false,
    style: { fill: "#ffffff" },
  },
  // IMG-01…IMG-07: изображение — файл модуля `media` с обрезкой, маской и отражением
  // (`imageData.ts`); IMG-02, IMG-03: скругление углов и обводка — оформление. Размер
  // задаёт загруженный файл.
  image: {
    type: "image",
    label: "Image",
    plural: "images",
    width: 320,
    height: 240,
    rotatable: true,
    editable: false,
    style: { stroke: "#1f2937", strokeWidth: 0, radius: 0 },
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

/** STK-03, STK-05, KBN-02: типы, у которых в интерфейсе правят теги. */
export const TAGGED_TYPES: readonly string[] = ["sticky", "stack", "card"];

export function typeSpec(type: string): ObjectTypeSpec | undefined {
  return Object.hasOwn(OBJECT_TYPES, type)
    ? OBJECT_TYPES[type as ObjectType]
    : undefined;
}

export const COLORS: StyleOption[] = [
  { value: "#fff176", label: "Yellow" },
  { value: "#ffb74d", label: "Orange" },
  { value: "#f48fb1", label: "Pink" },
  { value: "#81d4fa", label: "Blue" },
  { value: "#a5d6a7", label: "Green" },
  { value: "#ce93d8", label: "Purple" },
  { value: "#ffffff", label: "White" },
  { value: "#1f2937", label: "Black" },
];

/** STK-01: цвета стикера и стопки — палитра до постановки (без чёрного: текст тёмный). */
export const STICKY_COLORS: StyleOption[] = COLORS.filter(
  (color) => color.value !== "#1f2937",
);

export const FONT_SIZES: StyleOption[] = [
  12, 14, 16, 18, 24, 32, 36, 48, 64, 72,
].map((size) => ({ value: size, label: String(size) }));

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

/** CON-01, CON-07: наконечники концов линии; None — без наконечника. */
export const CAPS: StyleOption[] = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "triangle", label: "Triangle" },
  { value: "circle", label: "Circle" },
  { value: "diamond", label: "Diamond" },
];

/** SHP-03: прозрачная заливка фигуры. */
export const NO_COLOR: StyleOption = { value: "transparent", label: "None" };

/** Подпись и допустимые значения каждого свойства оформления. */
export const STYLE_KEYS: Record<
  StyleKey,
  { label: string; options: StyleOption[] }
> = {
  // FRM-02: заливка цветом; цвет только у границы (фон белый); граница цветом без фона.
  appearance: {
    label: "Frame style",
    options: [
      { value: "fill", label: "Fill" },
      { value: "border", label: "Border only" },
      { value: "outline", label: "No background" },
    ],
  },
  shape: {
    label: "Shape",
    options: SHAPE_KINDS.map((kind) => ({
      value: kind.id,
      label: kind.label,
      group: SHAPE_SETS.find((set) => set.id === kind.set)?.label,
    })),
  },
  // Значения маркера зависят от вида фигуры — см. `styleOptions.ts`.
  marker: { label: "Marker", options: [] },
  lineStyle: {
    label: "Line type",
    options: [
      { value: "straight", label: "Straight" },
      { value: "elbow", label: "Elbow" },
      { value: "curved", label: "Curved" },
    ],
  },
  startCap: { label: "Start", options: CAPS },
  endCap: { label: "End", options: CAPS },
  fill: { label: "Fill", options: COLORS },
  stroke: { label: "Border", options: COLORS },
  strokeWidth: {
    label: "Border width",
    options: [0, 1, 2, 4, 6, 8].map((value) => ({
      value,
      label: value === 0 ? "None" : String(value),
    })),
  },
  radius: {
    label: "Corners",
    options: [0, 4, 8, 12, 16, 24, 32, 48].map((value) => ({
      value,
      label: value === 0 ? "Square" : String(value),
    })),
  },
  fontFamily: {
    label: "Font",
    options: [
      { value: "sans", label: "Sans" },
      { value: "serif", label: "Serif" },
      { value: "mono", label: "Monospace" },
      { value: "hand", label: "Handwritten" },
    ],
  },
  fontSize: { label: "Font size", options: FONT_SIZES },
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
