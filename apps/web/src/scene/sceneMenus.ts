import type { Point } from "../realtime/messages";
import type { AlignOp } from "./arrange";
import type { Clip } from "./clipboard";
import type { MenuItem } from "./ContextMenu";
import type { LayerOp } from "./layers";
import { OBJECT_TYPES, type PlaceableType } from "./objectTypes";
import { placeableTypes } from "./tools";
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

/** FRM-05: блокировка с фреймами — выбор, что блокировать. */
function lockFrameItems({ lockFrames }: SceneCommands): MenuItem[] {
  return lockFrames === null
    ? []
    : [
        ...item("Lock frame only", () => {
          lockFrames(false);
        }),
        ...item("Lock frame and content", () => {
          lockFrames(true);
        }),
      ];
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
    ...lockFrameItems(commands),
    ...item("Unlock", commands.unlock),
    ...item(
      commands.frameContent?.hidden === true ? "Show content" : "Hide content",
      commands.frameContent?.toggle ?? null,
    ),
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
    create: (type: PlaceableType, at: Point) => void;
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
    ...placeableTypes().flatMap((type) =>
      item(`Add ${OBJECT_TYPES[type].label.toLowerCase()} here`, () => {
        actions.create(type, at);
      }),
    ),
    ...item("Select all", actions.selectAll),
    ...item("Unlock all", commands.unlockAll),
  ];
}
