/**
 * Наборы фигур (SHP-01, SHP-02): базовые, выноски, блок-схемы и BPMN. Вид фигуры — поле
 * `shape` объекта типа `shape`, маркер BPMN — поле `marker`. Контур рисует
 * `shapeGeometry.ts`, значки маркеров — `bpmnMarkers.ts`.
 */

export type ShapeSet = "basic" | "callout" | "flowchart" | "bpmn";

export const SHAPE_SETS: readonly { id: ShapeSet; label: string }[] = [
  { id: "basic", label: "Basic" },
  { id: "callout", label: "Callouts" },
  { id: "flowchart", label: "Flowchart" },
  { id: "bpmn", label: "BPMN" },
];

/** Область текста в долях рамки фигуры; может выходить за рамку (подпись под событием). */
export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Маркер BPMN: значение поля `marker` и подпись в интерфейсе. */
export interface MarkerOption {
  id: string;
  label: string;
}

export interface ShapeKind {
  id: string;
  label: string;
  set: ShapeSet;
  /** Размер новой фигуры, единицы доски. */
  width: number;
  height: number;
  /** SHP-03: у контура есть углы, которые можно скруглить. */
  roundable: boolean;
  /** Оформление новой фигуры поверх значений типа `shape`. */
  style?: Record<string, string | number>;
  /** Где текст; по умолчанию — вся рамка с полями. */
  text?: TextBox;
  /** Подпись идёт вертикально (заголовок пула BPMN). */
  verticalText?: boolean;
  /** SHP-02: маркеры фигуры BPMN; первый — значение по умолчанию. */
  markers?: readonly MarkerOption[];
}

const FULL: TextBox = { x: 0.06, y: 0.06, width: 0.88, height: 0.88 };
/** Подпись под небольшой фигурой BPMN (событие, шлюз, данные), как принято в нотации. */
const BELOW: TextBox = { x: -0.8, y: 1.08, width: 2.6, height: 0.7 };

const m = (id: string, label: string): MarkerOption => ({ id, label });
const NONE = m("none", "None");

const TASK_MARKERS = [
  NONE,
  m("user", "User"),
  m("service", "Service"),
  m("manual", "Manual"),
  m("script", "Script"),
  m("send", "Send"),
  m("receive", "Receive"),
  m("business-rule", "Business rule"),
];
const SUBPROCESS_MARKERS = [
  NONE,
  m("loop", "Loop"),
  m("parallel", "Parallel multi-instance"),
  m("sequential", "Sequential multi-instance"),
  m("ad-hoc", "Ad hoc"),
];
const START_MARKERS = [
  NONE,
  m("message", "Message"),
  m("timer", "Timer"),
  m("conditional", "Conditional"),
  m("signal", "Signal"),
];
const INTERMEDIATE_MARKERS = [
  NONE,
  m("message", "Message"),
  m("timer", "Timer"),
  m("signal", "Signal"),
  m("link", "Link"),
  m("error", "Error"),
  m("escalation", "Escalation"),
];
const END_MARKERS = [
  NONE,
  m("message", "Message"),
  m("error", "Error"),
  m("signal", "Signal"),
  m("escalation", "Escalation"),
  m("terminate", "Terminate"),
];
const GATEWAY_MARKERS = [
  m("exclusive", "Exclusive"),
  m("parallel", "Parallel"),
  m("inclusive", "Inclusive"),
  m("event-based", "Event-based"),
  m("complex", "Complex"),
  NONE,
];
const DATA_MARKERS = [NONE, m("input", "Input"), m("output", "Output")];

const k = (
  id: string,
  label: string,
  set: ShapeSet,
  width: number,
  height: number,
  extra: Partial<ShapeKind> = {},
): ShapeKind => ({ id, label, set, width, height, roundable: true, ...extra });

/** Все виды фигур в порядке показа: по наборам. */
export const SHAPE_KINDS: readonly ShapeKind[] = [
  // SHP-01: базовые фигуры.
  k("rectangle", "Rectangle", "basic", 200, 120),
  k("ellipse", "Ellipse", "basic", 160, 120, { roundable: false }),
  k("triangle", "Triangle", "basic", 160, 140, {
    text: { x: 0.22, y: 0.4, width: 0.56, height: 0.55 },
  }),
  k("right-triangle", "Right triangle", "basic", 160, 140, {
    text: { x: 0.06, y: 0.45, width: 0.5, height: 0.5 },
  }),
  k("diamond", "Diamond", "basic", 160, 120, {
    text: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  }),
  k("parallelogram", "Parallelogram", "basic", 200, 120, {
    text: { x: 0.2, y: 0.06, width: 0.6, height: 0.88 },
  }),
  k("trapezoid", "Trapezoid", "basic", 200, 120, {
    text: { x: 0.18, y: 0.06, width: 0.64, height: 0.88 },
  }),
  k("pentagon", "Pentagon", "basic", 140, 140),
  k("hexagon", "Hexagon", "basic", 160, 140),
  k("octagon", "Octagon", "basic", 140, 140),
  k("star", "Star", "basic", 140, 140, {
    text: { x: 0.3, y: 0.35, width: 0.4, height: 0.4 },
  }),
  k("cross", "Cross", "basic", 140, 140, {
    text: { x: 0.34, y: 0.34, width: 0.32, height: 0.32 },
  }),
  k("arrow", "Arrow", "basic", 200, 100, {
    text: { x: 0.04, y: 0.27, width: 0.7, height: 0.46 },
  }),
  k("double-arrow", "Double arrow", "basic", 200, 100, {
    text: { x: 0.2, y: 0.27, width: 0.6, height: 0.46 },
  }),
  k("chevron", "Chevron", "basic", 160, 100, {
    text: { x: 0.25, y: 0.06, width: 0.5, height: 0.88 },
  }),
  // SHP-01: выноски.
  k("callout-rect", "Rectangular callout", "callout", 200, 140, {
    text: { x: 0.06, y: 0.05, width: 0.88, height: 0.66 },
  }),
  k("callout-oval", "Oval callout", "callout", 200, 140, {
    roundable: false,
    text: { x: 0.16, y: 0.1, width: 0.68, height: 0.6 },
  }),
  k("callout-cloud", "Cloud callout", "callout", 200, 140, {
    roundable: false,
    text: { x: 0.18, y: 0.14, width: 0.64, height: 0.52 },
  }),
  k("callout-side", "Side callout", "callout", 200, 120, {
    text: { x: 0.2, y: 0.06, width: 0.74, height: 0.88 },
  }),
  // SHP-01: фигуры блок-схем.
  k("process", "Process", "flowchart", 160, 80),
  k("decision", "Decision", "flowchart", 160, 100, {
    text: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
  }),
  k("terminator", "Terminator", "flowchart", 160, 70, {
    roundable: false,
    text: { x: 0.12, y: 0.06, width: 0.76, height: 0.88 },
  }),
  k("data", "Data", "flowchart", 160, 80, {
    text: { x: 0.2, y: 0.06, width: 0.6, height: 0.88 },
  }),
  k("document", "Document", "flowchart", 160, 100, {
    roundable: false,
    text: { x: 0.06, y: 0.06, width: 0.88, height: 0.7 },
  }),
  k("multi-document", "Multiple documents", "flowchart", 160, 110, {
    roundable: false,
    text: { x: 0.06, y: 0.2, width: 0.8, height: 0.56 },
  }),
  k("predefined-process", "Predefined process", "flowchart", 160, 80, {
    text: { x: 0.14, y: 0.06, width: 0.72, height: 0.88 },
  }),
  k("internal-storage", "Internal storage", "flowchart", 140, 100, {
    text: { x: 0.18, y: 0.26, width: 0.76, height: 0.68 },
  }),
  k("manual-input", "Manual input", "flowchart", 160, 90, {
    text: { x: 0.06, y: 0.3, width: 0.88, height: 0.64 },
  }),
  k("manual-operation", "Manual operation", "flowchart", 160, 80, {
    text: { x: 0.2, y: 0.06, width: 0.6, height: 0.88 },
  }),
  k("preparation", "Preparation", "flowchart", 160, 80, {
    text: { x: 0.16, y: 0.06, width: 0.68, height: 0.88 },
  }),
  k("database", "Database", "flowchart", 120, 110, {
    roundable: false,
    text: { x: 0.06, y: 0.3, width: 0.88, height: 0.6 },
  }),
  k("delay", "Delay", "flowchart", 140, 80, {
    roundable: false,
    text: { x: 0.06, y: 0.06, width: 0.74, height: 0.88 },
  }),
  k("display", "Display", "flowchart", 160, 80, {
    roundable: false,
    text: { x: 0.18, y: 0.06, width: 0.66, height: 0.88 },
  }),
  k("merge", "Merge", "flowchart", 120, 100, {
    text: { x: 0.25, y: 0.06, width: 0.5, height: 0.45 },
  }),
  k("connector", "Connector", "flowchart", 70, 70, { roundable: false }),
  k("off-page", "Off-page connector", "flowchart", 80, 90, {
    text: { x: 0.08, y: 0.06, width: 0.84, height: 0.6 },
  }),
  // SHP-02: BPMN.
  k("bpmn-task", "Task", "bpmn", 160, 100, {
    style: { radius: 12 },
    text: { x: 0.06, y: 0.24, width: 0.88, height: 0.7 },
    markers: TASK_MARKERS,
  }),
  k("bpmn-subprocess", "Sub-process", "bpmn", 180, 110, {
    style: { radius: 12 },
    text: { x: 0.06, y: 0.06, width: 0.88, height: 0.66 },
    markers: SUBPROCESS_MARKERS,
  }),
  k("bpmn-start", "Start event", "bpmn", 60, 60, {
    roundable: false,
    text: BELOW,
    markers: START_MARKERS,
  }),
  k("bpmn-intermediate", "Intermediate event", "bpmn", 60, 60, {
    roundable: false,
    text: BELOW,
    markers: INTERMEDIATE_MARKERS,
  }),
  k("bpmn-end", "End event", "bpmn", 60, 60, {
    roundable: false,
    style: { strokeWidth: 4 },
    text: BELOW,
    markers: END_MARKERS,
  }),
  k("bpmn-gateway", "Gateway", "bpmn", 70, 70, {
    text: BELOW,
    markers: GATEWAY_MARKERS,
  }),
  k("bpmn-data-object", "Data object", "bpmn", 60, 80, {
    roundable: false,
    text: BELOW,
    markers: DATA_MARKERS,
  }),
  k("bpmn-data-store", "Data store", "bpmn", 80, 70, {
    roundable: false,
    text: BELOW,
  }),
  k("bpmn-pool", "Pool", "bpmn", 480, 200, {
    text: { x: 0, y: 0, width: 0.08, height: 1 },
    verticalText: true,
  }),
  k("bpmn-annotation", "Text annotation", "bpmn", 160, 80, {
    roundable: false,
    style: { fill: "transparent" },
    text: { x: 0.1, y: 0.06, width: 0.86, height: 0.88 },
  }),
  k("bpmn-group", "Group", "bpmn", 240, 160, {
    style: { radius: 12, fill: "transparent" },
    text: { x: 0.04, y: 0.04, width: 0.92, height: 0.3 },
  }),
];

export const DEFAULT_SHAPE = "rectangle";

const BY_ID = new Map(SHAPE_KINDS.map((kind) => [kind.id, kind]));

/** Вид фигуры по значению поля `shape`; неизвестное или пустое — прямоугольник. */
export function shapeKind(value: unknown): ShapeKind {
  return (
    (typeof value === "string" ? BY_ID.get(value) : undefined) ??
    (BY_ID.get(DEFAULT_SHAPE) as ShapeKind)
  );
}

export function isShapeKind(value: unknown): value is string {
  return typeof value === "string" && BY_ID.has(value);
}

/** SHP-02: действующий маркер фигуры — записанный, если он есть у вида, иначе первый. */
export function shapeMarker(kind: ShapeKind, value: unknown): string | null {
  const markers = kind.markers;
  if (markers === undefined) return null;
  const found = markers.find((marker) => marker.id === value);
  return (found ?? markers[0] ?? NONE).id;
}

export function textBoxOf(kind: ShapeKind): TextBox {
  return kind.text ?? FULL;
}

/** Поля новой фигуры вида `kind`: размер и оформление вида, маркер по умолчанию. */
export function newShapeFields(kind: ShapeKind): {
  width: number;
  height: number;
  style: Record<string, string | number>;
} {
  const marker = shapeMarker(kind, undefined);
  return {
    width: kind.width,
    height: kind.height,
    style: {
      ...kind.style,
      shape: kind.id,
      ...(marker !== null && { marker }),
    },
  };
}

/** Выбранный до постановки вид фигуры — на время сессии вкладки (как цвет стикера). */
export const SHAPE_KIND_KEY = "myboard.shapeKind";

export function loadShapeKind(): string {
  try {
    const value = window.sessionStorage.getItem(SHAPE_KIND_KEY);
    return isShapeKind(value) ? value : DEFAULT_SHAPE;
  } catch {
    return DEFAULT_SHAPE;
  }
}

export function rememberShapeKind(kind: string): void {
  try {
    window.sessionStorage.setItem(SHAPE_KIND_KEY, kind);
  } catch {
    // Без хранилища выбор живёт, пока открыта доска.
  }
}
