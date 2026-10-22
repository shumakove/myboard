import type { ShapeKind } from "./shapes";

/**
 * SHP-02: значки маркеров BPMN. Значок нарисован в квадрате 24×24; `ink` — цвет обводки
 * фигуры, `paper` — цвет её заливки. Закрашенный вариант — «бросающие» события
 * (конечное событие, отправка, выход данных).
 */
export interface IconPart {
  d: string;
  fill: "none" | "ink" | "paper";
  stroke: "ink" | "paper" | "none";
  width?: number;
}

/** Положение значка в рамке фигуры: левый верхний угол и сторона квадрата. */
export interface IconPlacement {
  x: number;
  y: number;
  size: number;
}

const line = (d: string, width = 1.6): IconPart => ({
  d,
  fill: "none",
  stroke: "ink",
  width,
});
const shape = (d: string, filled: boolean): IconPart => ({
  d,
  fill: filled ? "ink" : "none",
  stroke: "ink",
  width: 1.6,
});

const ENVELOPE = "M3,6H21V18H3Z";
const FLAP = "M3,6L12,13L21,6";

function envelope(filled: boolean): IconPart[] {
  return [
    shape(ENVELOPE, filled),
    { d: FLAP, fill: "none", stroke: filled ? "paper" : "ink", width: 1.6 },
  ];
}

/** Шестерёнка (задача-сервис): зубцы по кругу и ось. */
function gear(): IconPart[] {
  const teeth = 8;
  const points = Array.from({ length: teeth * 2 }, (_, i) => {
    const angle = (Math.PI / teeth) * i;
    const radius = i % 2 === 0 ? 9 : 6.5;
    return `${(12 + radius * Math.cos(angle)).toFixed(2)},${(12 + radius * Math.sin(angle)).toFixed(2)}`;
  });
  return [
    shape(`M${points.join("L")}Z`, false),
    shape("M9,12A3,3 0 1 0 15,12A3,3 0 1 0 9,12Z", false),
  ];
}

/** Окружность радиуса `r` с центром в середине значка. */
function CIRCLE(r: number): string {
  const left = String(12 - r);
  const right = String(12 + r);
  const radius = String(r);
  return `M${left},12A${radius},${radius} 0 1 0 ${right},12A${radius},${radius} 0 1 0 ${left},12Z`;
}

/** Значок маркера `marker`; `filled` — закрашенный («бросающий») вариант. */
export function markerIcon(marker: string, filled: boolean): IconPart[] {
  switch (marker) {
    case "message":
    case "receive":
      return envelope(filled);
    case "send":
      return envelope(true);
    case "timer":
      return [shape(CIRCLE(8), false), line("M12,7V12L15.5,14")];
    case "conditional":
      return [
        shape("M6,4H18V20H6Z", false),
        line("M8.5,8.5H15.5M8.5,12H15.5M8.5,15.5H15.5", 1.2),
      ];
    case "signal":
      return [shape("M12,4L20,19H4Z", filled)];
    case "link":
      return [shape("M4,9H13V5L20,12L13,19V15H4Z", filled)];
    case "error":
      return [shape("M5,19L9,6L14,13L19,4L15,18L10,11Z", filled)];
    case "escalation":
      return [shape("M12,4L18,20L12,14L6,20Z", filled)];
    case "terminate":
      return [shape(CIRCLE(8), true)];
    case "exclusive":
      return [line("M7,7L17,17M17,7L7,17", 3.2)];
    case "parallel":
      return [line("M12,4V20M4,12H20", 3.2)];
    case "inclusive":
      return [line(CIRCLE(6.5), 2.6)];
    case "event-based":
      return [
        line(CIRCLE(9), 1.2),
        line(CIRCLE(7.5), 1.2),
        line("M12,7.5L16.3,10.6L14.6,15.6H9.4L7.7,10.6Z", 1.2),
      ];
    case "complex":
      return [
        line("M12,4V20M4,12H20M6.3,6.3L17.7,17.7M17.7,6.3L6.3,17.7", 2.6),
      ];
    case "user":
      return [
        shape("M8.5,8A3.5,3.5 0 1 0 15.5,8A3.5,3.5 0 1 0 8.5,8Z", false),
        shape("M5,21C5,14.5 19,14.5 19,21Z", false),
      ];
    case "service":
      return gear();
    case "manual":
      return [
        shape(
          "M3,10H15A1.5,1.5 0 0 1 15,13H11M11,13H19A1.5,1.5 0 0 1 19,16H11M11,16H18A1.5,1.5 0 0 1 18,19H11M11,19H16A1.5,1.5 0 0 1 16,21H3Z",
          false,
        ),
      ];
    case "script":
      return [
        shape("M7,4H19C16,8 21,13 17,20H5C9,15 4,9 7,4Z", false),
        line("M8.5,8.5H15.5M8.5,12H16.5M8,15.5H15", 1.2),
      ];
    case "business-rule":
      return [
        shape("M4,6H20V18H4Z", false),
        { d: "M4,6H20V10H4Z", fill: "ink", stroke: "ink", width: 1.2 },
        line("M4,14H20M9,10V18", 1.2),
      ];
    case "loop":
      return [line("M17,8A6.5,6.5 0 1 0 18.5,13"), line("M17.5,3.5V8.5H12.5")];
    case "sequential":
      return [line("M5,7H19M5,12H19M5,17H19", 2)];
    case "ad-hoc":
      return [line("M5,13C8,8 10,8 12,12S16,16 19,11", 2)];
    case "input":
    case "output":
      return [shape("M4,9H12V5L19,12L12,19V15H4Z", marker === "output")];
    default:
      return [];
  }
}

/** Маркер многоэкземплярности подпроцесса «parallel» — три вертикальные черты. */
export function parallelBars(): IconPart[] {
  return [line("M8,5V19M12,5V19M16,5V19", 2)];
}

/** Знак свёрнутого подпроцесса — «+» в квадрате внизу по центру. */
export function collapsedIcon(): IconPart[] {
  return [
    { d: "M5,5H19V19H5Z", fill: "paper", stroke: "ink", width: 1.4 },
    line("M12,8V16M8,12H16", 1.6),
  ];
}

/** Где значок маркера у фигуры вида `kind` в рамке `w`×`h`. */
export function markerPlacement(
  kind: ShapeKind,
  w: number,
  h: number,
): IconPlacement {
  const side = Math.min(w, h);
  switch (kind.id) {
    case "bpmn-task":
      return { x: 6, y: 6, size: 22 };
    case "bpmn-subprocess":
      return { x: w / 2 - 34, y: h - 22, size: 20 };
    case "bpmn-data-object":
      return { x: 2, y: 2, size: side * 0.4 };
    case "bpmn-gateway": {
      const size = side * 0.5;
      return { x: (w - size) / 2, y: (h - size) / 2, size };
    }
    default: {
      const size = side * 0.62;
      return { x: (w - size) / 2, y: (h - size) / 2, size };
    }
  }
}

/** Значки фигуры BPMN: маркер и, у подпроцесса, знак «+». */
export function shapeIcons(
  kind: ShapeKind,
  marker: string | null,
  w: number,
  h: number,
): { at: IconPlacement; parts: IconPart[] }[] {
  const icons: { at: IconPlacement; parts: IconPart[] }[] = [];
  if (kind.id === "bpmn-subprocess") {
    icons.push({
      at: { x: w / 2 - 10, y: h - 22, size: 20 },
      parts: collapsedIcon(),
    });
  }
  if (marker === null || marker === "none") return icons;
  const parts =
    kind.id === "bpmn-subprocess" && marker === "parallel"
      ? parallelBars()
      : markerIcon(marker, kind.id === "bpmn-end");
  if (parts.length > 0) icons.push({ at: markerPlacement(kind, w, h), parts });
  return icons;
}
