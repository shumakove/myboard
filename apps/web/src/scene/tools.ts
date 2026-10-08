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
 *
 * `key` — горячая клавиша инструмента без модификаторов (CVS-25): код клавиши
 * `KeyboardEvent.code`, чтобы она работала при любой раскладке.
 */
export type Tool = { label: string; hint: string; key: string } & (
  | { kind: "select"; id: "select" }
  | { kind: "lasso"; id: "lasso" }
  | { kind: "create"; id: ObjectType }
);

export type ToolId = Tool["id"];

/** CVS-25: клавиши инструментов создания. */
const CREATE_KEYS: Record<ObjectType, string> = {
  sticky: "KeyN",
  shape: "KeyS",
  text: "KeyT",
};

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
  ...(Object.values(OBJECT_TYPES).map((spec) => ({
    kind: "create" as const,
    id: spec.type,
    label: spec.label,
    key: CREATE_KEYS[spec.type],
    hint: `Click the board or drag this button onto it to add a ${spec.label.toLowerCase()}.`,
  })) satisfies Tool[]),
];

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
