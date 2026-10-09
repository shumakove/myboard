import type { Point } from "../realtime/messages";
import type { AlignOp } from "./arrange";
import type { Clip } from "./clipboard";
import type { MenuItem } from "./ContextMenu";
import type { LayerOp } from "./layers";
import { OBJECT_TYPES, type ObjectType } from "./objectTypes";
import type { SceneCommands } from "./useSceneCommands";

/** Пункты контекстных меню сцены (CVS-23) из доступных команд. */

const ALIGN_ITEMS: readonly [AlignOp, string][] = [
  ["left", "Align left"],
  ["center", "Align center"],
  ["right", "Align right"],
  ["top", "Align top"],
  ["middle", "Align middle"],
  ["bottom", "Align bottom"],
];

const LAYER_ITEMS: readonly [LayerOp, string][] = [
  ["front", "Bring to front"],
  ["forward", "Bring forward"],
  ["backward", "Send backward"],
  ["back", "Send to back"],
];

function item(label: string, action: (() => unknown) | null): MenuItem[] {
  return action === null
    ? []
    : [
        {
          label,
          action: () => {
            action();
          },
        },
      ];
}

/** CVS-18: порядок слоёв выделенного. */
function layerItems({ layer }: SceneCommands): MenuItem[] {
  return layer === null
    ? []
    : LAYER_ITEMS.flatMap(([op, label]) =>
        item(label, () => {
          layer(op);
        }),
      );
}

/** CVS-15, CVS-18: меню Arrange панели выделения. */
export function arrangeMenu(commands: SceneCommands): MenuItem[] {
  const { align, distribute } = commands;
  return [
    ...(align === null
      ? []
      : ALIGN_ITEMS.flatMap(([op, label]) =>
          item(label, () => {
            align(op);
          }),
        )),
    ...(distribute === null
      ? []
      : [
          ...item("Distribute horizontally", () => {
            distribute("x");
          }),
          ...item("Distribute vertically", () => {
            distribute("y");
          }),
        ]),
    ...layerItems(commands),
  ];
}

/** Меню объекта: правый щелчок по объекту и кнопка More панели выделения. */
export function objectMenu(
  commands: SceneCommands,
  actions: {
    editText: (() => void) | null;
    /** Копия в системный буфер; `cut` — затем удалить. */
    copyToClipboard: (cut: boolean) => void;
    /** SHR-07: ссылка на один выделенный объект. */
    copyLink: (() => void) | null;
  },
): MenuItem[] {
  const count = commands.units.length;
  return [
    ...item("Edit text", actions.editText),
    ...item("Copy", () => {
      actions.copyToClipboard(false);
    }),
    ...item(
      "Cut",
      commands.cut &&
        (() => {
          actions.copyToClipboard(true);
        }),
    ),
    ...item("Duplicate", commands.duplicate),
    ...item("Copy link to object", actions.copyLink),
    ...item("Group", commands.group),
    ...item("Ungroup", commands.ungroup),
    ...item("Lock", commands.lock),
    ...item("Unlock", commands.unlock),
    ...layerItems(commands),
    ...item(
      count > 1 ? `Delete ${String(count)} objects` : "Delete",
      commands.remove,
    ),
  ];
}

/** Меню пустого места холста: вставка, создание, выделить всё, разблокировать всё. */
export function boardMenu(
  commands: SceneCommands,
  at: Point,
  clip: Clip | null,
  actions: {
    create: (type: ObjectType, at: Point) => void;
    selectAll: () => void;
  },
): MenuItem[] {
  return [
    ...item(
      "Paste here",
      clip &&
        (() => {
          commands.paste(clip, at);
        }),
    ),
    ...Object.values(OBJECT_TYPES).flatMap((spec) =>
      item(`Add ${spec.label.toLowerCase()} here`, () => {
        actions.create(spec.type, at);
      }),
    ),
    ...item("Select all", actions.selectAll),
    ...item("Unlock all", commands.unlockAll),
  ];
}
