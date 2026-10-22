import type { ShapeKind } from "./shapes";

/**
 * Контур фигуры (SHP-01…SHP-03) — пути SVG в единицах доски для рамки `width`×`height`.
 * Первая часть — контур (заливка и обводка), следующие — детали поверх него.
 */
export interface ShapePart {
  d: string;
  /** Заливать цветом фигуры; `false` — только обводка. */
  filled: boolean;
  /** Без обводки (заливка-подложка). */
  noStroke?: boolean;
  dashed?: boolean;
}

type Pt = readonly [number, number];
type Draw = (w: number, h: number, r: number) => ShapePart[];

const n = (value: number): string => String(Math.round(value * 100) / 100);
const p = (x: number, y: number): string => `${n(x)},${n(y)}`;

const outline = (d: string): ShapePart => ({ d, filled: true });
const detail = (d: string): ShapePart => ({ d, filled: false });

/** Многоугольник по точкам в долях рамки; SHP-03: углы скруглены радиусом `r`. */
export function polygon(points: readonly Pt[], w: number, h: number, r = 0) {
  const pts = points.map(([x, y]) => [x * w, y * h] as const);
  if (r <= 0) return `M${pts.map(([x, y]) => p(x, y)).join("L")}Z`;
  const segments = pts.map((point, i) => {
    const prev = pts[(i + pts.length - 1) % pts.length] ?? point;
    const next = pts[(i + 1) % pts.length] ?? point;
    const toPrev = Math.hypot(prev[0] - point[0], prev[1] - point[1]);
    const toNext = Math.hypot(next[0] - point[0], next[1] - point[1]);
    // Радиус не больше половины прилегающих сторон: соседние скругления не пересекаются.
    const radius = Math.min(r, toPrev / 2, toNext / 2);
    const along = (to: Pt, length: number): string =>
      length === 0
        ? p(point[0], point[1])
        : p(
            point[0] + ((to[0] - point[0]) * radius) / length,
            point[1] + ((to[1] - point[1]) * radius) / length,
          );
    return {
      from: along(prev, toPrev),
      corner: p(point[0], point[1]),
      to: along(next, toNext),
    };
  });
  const [first] = segments;
  if (first === undefined) return "";
  return `M${first.from}${segments
    .map((s, i) => `${i === 0 ? "" : `L${s.from}`}Q${s.corner} ${s.to}`)
    .join("")}Z`;
}

export function ellipse(cx: number, cy: number, rx: number, ry: number) {
  return `M${p(cx - rx, cy)}A${n(rx)} ${n(ry)} 0 1 0 ${p(cx + rx, cy)}A${n(rx)} ${n(ry)} 0 1 0 ${p(cx - rx, cy)}Z`;
}

const RECT: readonly Pt[] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const DIAMOND: readonly Pt[] = [
  [0.5, 0],
  [1, 0.5],
  [0.5, 1],
  [0, 0.5],
];
const PARALLELOGRAM: readonly Pt[] = [
  [0.2, 0],
  [1, 0],
  [0.8, 1],
  [0, 1],
];

const poly =
  (points: readonly Pt[]): Draw =>
  (w, h, r) => [outline(polygon(points, w, h, r))];

/** Пятиконечная звезда, вершины — в долях рамки. */
function starPoints(): Pt[] {
  return Array.from({ length: 10 }, (_, i) => {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? 0.5 : 0.2;
    return [0.5 + radius * Math.cos(angle), 0.53 + radius * Math.sin(angle)];
  });
}

/** Цилиндр (база данных, хранилище данных): тело и передний край верхней крышки. */
const cylinder: Draw = (w, h) => {
  const ry = Math.min(h * 0.15, w * 0.25);
  const rx = w / 2;
  return [
    outline(
      `M${p(0, ry)}A${n(rx)} ${n(ry)} 0 0 1 ${p(w, ry)}V${n(h - ry)}A${n(rx)} ${n(ry)} 0 0 1 ${p(0, h - ry)}Z`,
    ),
    detail(`M${p(0, ry)}A${n(rx)} ${n(ry)} 0 0 0 ${p(w, ry)}`),
  ];
};

/** Документ блок-схемы: низ — волна; `w`, `h`, сдвиг `x`, `y` — рамка листа. */
function documentPath(x: number, y: number, w: number, h: number): string {
  return `M${p(x, y)}H${n(x + w)}V${n(y + h * 0.85)}Q${p(x + w * 0.75, y + h * 0.7)} ${p(x + w * 0.5, y + h * 0.85)}T${p(x, y + h * 0.85)}Z`;
}

/** Выноска-облако: «облако» из дуг вокруг эллипса и два кружка к углу. */
const cloud: Draw = (w, h) => {
  const cx = w * 0.5;
  const cy = h * 0.4;
  const rx = w * 0.42;
  const ry = h * 0.32;
  const count = 9;
  const pts = Array.from({ length: count }, (_, i) => {
    const angle = ((Math.PI * 2) / count) * i;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)] as const;
  });
  const bumps = pts
    .map((point, i) => {
      const next = pts[(i + 1) % count] ?? point;
      const chord = Math.hypot(next[0] - point[0], next[1] - point[1]);
      return `A${n(chord * 0.6)} ${n(chord * 0.6)} 0 0 1 ${p(next[0], next[1])}`;
    })
    .join("");
  const first = pts[0] ?? [0, 0];
  return [
    outline(
      `M${p(first[0], first[1])}${bumps}Z${ellipse(w * 0.2, h * 0.84, w * 0.05, h * 0.05)}${ellipse(w * 0.09, h * 0.95, w * 0.03, h * 0.03)}`,
    ),
  ];
};

/** Овальная выноска: эллипс с хвостом к левому нижнему углу. */
const ovalCallout: Draw = (w, h) => {
  const cx = w / 2;
  const cy = h * 0.4;
  const rx = w / 2;
  const ry = h * 0.4;
  const at = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return p(cx + rx * Math.cos(rad), cy + ry * Math.sin(rad));
  };
  return [
    outline(
      `M${at(125)}A${n(rx)} ${n(ry)} 0 1 1 ${at(102)}L${p(w * 0.15, h)}Z`,
    ),
  ];
};

/** Скруглённый прямоугольник с радиусом, не больше половины стороны. */
const rounded =
  (fixed?: number): Draw =>
  (w, h, r) => [
    outline(polygon(RECT, w, h, fixed ?? Math.min(r, w / 2, h / 2))),
  ];

const DRAWINGS: Record<string, Draw> = {
  rectangle: poly(RECT),
  ellipse: (w, h) => [outline(ellipse(w / 2, h / 2, w / 2, h / 2))],
  triangle: poly([
    [0.5, 0],
    [1, 1],
    [0, 1],
  ]),
  "right-triangle": poly([
    [0, 0],
    [1, 1],
    [0, 1],
  ]),
  diamond: poly(DIAMOND),
  parallelogram: poly(PARALLELOGRAM),
  trapezoid: poly([
    [0.2, 0],
    [0.8, 0],
    [1, 1],
    [0, 1],
  ]),
  pentagon: poly([
    [0.5, 0],
    [1, 0.38],
    [0.81, 1],
    [0.19, 1],
    [0, 0.38],
  ]),
  hexagon: poly([
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ]),
  octagon: poly([
    [0.3, 0],
    [0.7, 0],
    [1, 0.3],
    [1, 0.7],
    [0.7, 1],
    [0.3, 1],
    [0, 0.7],
    [0, 0.3],
  ]),
  star: poly(starPoints()),
  cross: poly([
    [0.33, 0],
    [0.67, 0],
    [0.67, 0.33],
    [1, 0.33],
    [1, 0.67],
    [0.67, 0.67],
    [0.67, 1],
    [0.33, 1],
    [0.33, 0.67],
    [0, 0.67],
    [0, 0.33],
    [0.33, 0.33],
  ]),
  arrow: poly([
    [0, 0.25],
    [0.65, 0.25],
    [0.65, 0],
    [1, 0.5],
    [0.65, 1],
    [0.65, 0.75],
    [0, 0.75],
  ]),
  "double-arrow": poly([
    [0, 0.5],
    [0.2, 0],
    [0.2, 0.25],
    [0.8, 0.25],
    [0.8, 0],
    [1, 0.5],
    [0.8, 1],
    [0.8, 0.75],
    [0.2, 0.75],
    [0.2, 1],
  ]),
  chevron: poly([
    [0, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0, 1],
    [0.25, 0.5],
  ]),
  "callout-rect": poly([
    [0, 0],
    [1, 0],
    [1, 0.75],
    [0.42, 0.75],
    [0.18, 1],
    [0.26, 0.75],
    [0, 0.75],
  ]),
  "callout-oval": ovalCallout,
  "callout-cloud": cloud,
  "callout-side": poly([
    [0.15, 0],
    [1, 0],
    [1, 1],
    [0.15, 1],
    [0.15, 0.62],
    [0, 0.5],
    [0.15, 0.4],
  ]),
  process: poly(RECT),
  decision: poly(DIAMOND),
  terminator: (w, h) => rounded(Math.min(w, h) / 2)(w, h, 0),
  data: poly(PARALLELOGRAM),
  document: (w, h) => [outline(documentPath(0, 0, w, h))],
  "multi-document": (w, h) => {
    const dw = w * 0.88;
    const dh = h * 0.84;
    return [
      outline(documentPath(w * 0.12, 0, dw, dh)),
      { d: documentPath(w * 0.06, h * 0.08, dw, dh), filled: true },
      { d: documentPath(0, h * 0.16, dw, dh), filled: true },
    ];
  },
  "predefined-process": (w, h, r) => [
    outline(polygon(RECT, w, h, r)),
    detail(`M${p(w * 0.1, 0)}V${n(h)}M${p(w * 0.9, 0)}V${n(h)}`),
  ],
  "internal-storage": (w, h, r) => [
    outline(polygon(RECT, w, h, r)),
    detail(`M${p(w * 0.14, 0)}V${n(h)}M${p(0, h * 0.2)}H${n(w)}`),
  ],
  "manual-input": poly([
    [0, 0.25],
    [1, 0],
    [1, 1],
    [0, 1],
  ]),
  "manual-operation": poly([
    [0, 0],
    [1, 0],
    [0.8, 1],
    [0.2, 1],
  ]),
  preparation: poly([
    [0.15, 0],
    [0.85, 0],
    [1, 0.5],
    [0.85, 1],
    [0.15, 1],
    [0, 0.5],
  ]),
  database: cylinder,
  delay: (w, h) => [
    outline(`M0,0H${n(w / 2)}A${n(w / 2)} ${n(h / 2)} 0 0 1 ${p(w / 2, h)}H0Z`),
  ],
  display: (w, h) => [
    outline(
      `M${p(w * 0.15, 0)}H${n(w * 0.85)}A${n(w * 0.15)} ${n(h / 2)} 0 0 1 ${p(w * 0.85, h)}H${n(w * 0.15)}L${p(0, h / 2)}Z`,
    ),
  ],
  merge: poly([
    [0, 0],
    [1, 0],
    [0.5, 1],
  ]),
  connector: (w, h) => [outline(ellipse(w / 2, h / 2, w / 2, h / 2))],
  "off-page": poly([
    [0, 0],
    [1, 0],
    [1, 0.7],
    [0.5, 1],
    [0, 0.7],
  ]),
  "bpmn-task": rounded(),
  "bpmn-subprocess": rounded(),
  "bpmn-start": (w, h) => [outline(ellipse(w / 2, h / 2, w / 2, h / 2))],
  "bpmn-intermediate": (w, h) => {
    const inset = Math.min(w, h) * 0.08;
    return [
      outline(ellipse(w / 2, h / 2, w / 2, h / 2)),
      detail(ellipse(w / 2, h / 2, w / 2 - inset, h / 2 - inset)),
    ];
  },
  "bpmn-end": (w, h) => [outline(ellipse(w / 2, h / 2, w / 2, h / 2))],
  "bpmn-gateway": poly(DIAMOND),
  "bpmn-data-object": (w, h) => {
    const fold = Math.min(w, h) * 0.3;
    return [
      outline(`M0,0H${n(w - fold)}L${p(w, fold)}V${n(h)}H0Z`),
      detail(`M${p(w - fold, 0)}V${n(fold)}H${n(w)}`),
    ];
  },
  "bpmn-data-store": cylinder,
  "bpmn-pool": (w, h, r) => {
    const header = Math.min(w * 0.08, 40);
    return [
      outline(polygon(RECT, w, h, r)),
      detail(`M${p(header, 0)}V${n(h)}`),
    ];
  },
  "bpmn-annotation": (w, h) => {
    const arm = Math.min(w * 0.1, 20);
    return [
      { d: polygon(RECT, w, h), filled: true, noStroke: true },
      detail(`M${p(arm, 0)}H0V${n(h)}H${n(arm)}`),
    ];
  },
  "bpmn-group": (w, h, r) => [
    {
      d: polygon(RECT, w, h, Math.min(r, w / 2, h / 2)),
      filled: true,
      dashed: true,
    },
  ],
};

/** Пути фигуры вида `kind` в рамке `width`×`height` со скруглением `radius`. */
export function shapeParts(
  kind: ShapeKind,
  width: number,
  height: number,
  radius: number,
): ShapePart[] {
  const draw = DRAWINGS[kind.id] ?? poly(RECT);
  return draw(
    Math.max(width, 1),
    Math.max(height, 1),
    kind.roundable ? Math.max(radius, 0) : 0,
  );
}
