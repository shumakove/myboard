import type { Point } from "../realtime/messages";
import { snap } from "./geometry";
import { OBJECT_TYPES, type ObjectType } from "./objectTypes";

/**
 * Контракт инструмента (ARCHITECTURE.md, раздел 4): жест на камере создаёт или меняет
 * объект в документе.
 * - `select` — щелчок выделяет, перетаскивание двигает объект или вид, Shift+перетаскивание
 *   по пустому месту — рамка выделения (CVS-10, CVS-12);
 * - `lasso` — выделение областью произвольной формы (CVS-10);
 * - `create` — ставит объект своего типа (CVS-09).
 */
export type Tool =
  | { kind: "select"; id: "select"; label: string; hint: string }
  | { kind: "lasso"; id: "lasso"; label: string; hint: string }
  | { kind: "create"; id: ObjectType; label: string; hint: string };

export type ToolId = Tool["id"];

export const TOOLS: readonly Tool[] = [
  {
    kind: "select",
    id: "select",
    label: "Select",
    hint: "Click to select, drag to move. Drag empty space to pan, Shift+drag to select an area.",
  },
  {
    kind: "lasso",
    id: "lasso",
    label: "Lasso",
    hint: "Draw around objects to select them.",
  },
  ...(Object.values(OBJECT_TYPES).map((spec) => ({
    kind: "create" as const,
    id: spec.type,
    label: spec.label,
    hint: `Click the board or drag this button onto it to add a ${spec.label.toLowerCase()}.`,
  })) satisfies Tool[]),
];

export function toolById(id: ToolId): Tool {
  return TOOLS.find((tool) => tool.id === id) ?? (TOOLS[0] as Tool);
}

/** Левый верхний угол нового объекта: центр — в точке, угол прилипает к сетке. */
export function placement(
  type: ObjectType,
  at: Point,
  gridStep: number,
): Point {
  const spec = OBJECT_TYPES[type];
  return {
    x: snap(at.x - spec.width / 2, gridStep),
    y: snap(at.y - spec.height / 2, gridStep),
  };
}
