import type { Point } from "../realtime/messages";
import { snap } from "./geometry";
import {
  isPlaceable,
  OBJECT_TYPES,
  type ObjectType,
  type PlaceableType,
} from "./objectTypes";

/**
 * Контракт инструмента (ARCHITECTURE.md, раздел 4): жест на камере создаёт или меняет
 * объект в документе.
 * - `select` — щелчок выделяет, перетаскивание двигает объект или вид, Shift+перетаскивание
 *   по пустому месту — рамка выделения (CVS-10, CVS-12);
 * - `lasso` — выделение областью произвольной формы (CVS-10);
 * - `create` — ставит объект своего типа (CVS-09); линия рисуется протяжкой (CON-01);
 * - `draw` — перо и маркер рисуют штрих (DRW-01), ластик стирает штрихи (DRW-03), лазер
 *   оставляет временный след (DRW-05).
 *
 * `key` — горячая клавиша инструмента без модификаторов (CVS-25): код клавиши
 * `KeyboardEvent.code`, чтобы она работала при любой раскладке.
 */
export type Tool = { label: string; hint: string; key: string } & (
  | { kind: "select"; id: "select" }
  | { kind: "lasso"; id: "lasso" }
  | { kind: "create"; id: PlaceableType }
  | { kind: "draw"; id: DrawToolId }
);

/** Инструменты рисования (T6.5). */
export type DrawToolId = "pen" | "marker" | "eraser" | "laser";

export type ToolId = Tool["id"];

/** CVS-25: клавиши инструментов создания. */
const CREATE_KEYS: Record<PlaceableType, string> = {
  sticky: "KeyN",
  shape: "KeyS",
  text: "KeyT",
  document: "KeyD",
  stack: "KeyK",
  line: "KeyC",
  frame: "KeyF",
};

/** Подсказка инструмента создания; у линии — протяжка и привязка к объектам (T6.4). */
function createHint(type: PlaceableType, label: string): string {
  if (type === "line") {
    return "Drag on the board to draw a line. Start or end it on an object to connect them; hold Shift for any angle, Alt to keep an end free.";
  }
  if (type === "frame") {
    return "Click the board to add a frame. Objects inside it or dropped into it move with the frame.";
  }
  return `Click the board or drag this button onto it to add a ${label.toLowerCase()}.`;
}

export const TOOLS: readonly Tool[] = [
  {
    kind: "select",
    id: "select",
    label: "Select",
    key: "KeyV",
    hint: "Click to select, drag to move. Drag empty space to pan, Shift+drag to select an area.",
  },
  {
    kind: "lasso",
    id: "lasso",
    label: "Lasso",
    key: "KeyL",
    hint: "Draw around objects to select them.",
  },
  ...(placeableTypes().map((type) => ({
    kind: "create" as const,
    id: type,
    label: OBJECT_TYPES[type].label,
    key: CREATE_KEYS[type],
    hint: createHint(type, OBJECT_TYPES[type].label),
  })) satisfies Tool[]),
  {
    kind: "draw",
    id: "pen",
    label: "Pen",
    key: "KeyP",
    hint: "Draw freehand lines. Hold Shift for a straight line.",
  },
  {
    kind: "draw",
    id: "marker",
    label: "Marker",
    key: "KeyM",
    hint: "Draw wide translucent lines. Hold Shift for a straight line.",
  },
  {
    kind: "draw",
    id: "eraser",
    label: "Eraser",
    key: "KeyE",
    hint: "Drag over drawings to erase them. Locked drawings stay.",
  },
  {
    kind: "draw",
    id: "laser",
    label: "Laser",
    key: "KeyR",
    hint: "Point at things for everyone: the trail fades in a few seconds and is not saved.",
  },
];

/** Типы, у которых есть инструмент создания, в порядке объявления. */
export function placeableTypes(): PlaceableType[] {
  return (Object.keys(OBJECT_TYPES) as ObjectType[]).filter(isPlaceable);
}

/** Инструмент рисования (T6.5) или `null`. */
export function drawTool(id: ToolId): DrawToolId | null {
  const tool = toolById(id);
  return tool.kind === "draw" ? tool.id : null;
}

export function toolById(id: ToolId): Tool {
  return TOOLS.find((tool) => tool.id === id) ?? (TOOLS[0] as Tool);
}

/** Буква клавиши для подсказки: `KeyV` → `V`. */
export function keyLabel(code: string): string {
  return code.replace(/^Key/, "");
}

/** Подсказка кнопки инструмента с его клавишей. */
export function toolTitle(tool: Tool): string {
  return `${tool.label} (${keyLabel(tool.key)}). ${tool.hint}`;
}

/**
 * Левый верхний угол нового объекта: центр — в точке, угол прилипает к сетке. `size` —
 * размер, если он не размер типа (вид фигуры, SHP-01).
 */
export function placement(
  type: PlaceableType,
  at: Point,
  gridStep: number,
  size: { width: number; height: number } = OBJECT_TYPES[type],
): Point {
  return {
    x: snap(at.x - size.width / 2, gridStep),
    y: snap(at.y - size.height / 2, gridStep),
  };
}
