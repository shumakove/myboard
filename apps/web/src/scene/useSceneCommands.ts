import { useMemo } from "react";
import { moveToTrash, type BoardDocument } from "../realtime/boardDocument";
import type { Point } from "../realtime/messages";
import {
  alignDeltas,
  distributeDeltas,
  type AlignOp,
  type Axis,
  type Placed,
} from "./arrange";
import {
  copyObjects,
  DUPLICATE_OFFSET,
  pasteObjects,
  saveClip,
  type Clip,
} from "./clipboard";
import { boundsOf } from "./geometry";
import {
  canGroup,
  groupObjects,
  removalSet,
  topmost,
  ungroupObjects,
} from "./groups";
import { renumber, reorder, type LayerOp } from "./layers";
import { setLocked, unlockAll } from "./lock";
import { htmlToDelta } from "../richtext/html";
import { plainText } from "../richtext/delta";
import { objectLabel } from "./objectLabel";
import { GROUP_TYPE, type StyleKey } from "./objectTypes";
import {
  createObject,
  objectMap,
  patchObjects,
  readScene,
  transact,
  writeFields,
  type ObjectPatch,
  type SceneObject,
} from "./sceneObjects";
import { estimateHeight } from "./textHeight";
import { loadTextStyle, rememberTextStyle } from "./textStyle";
import { placement } from "./tools";

/** Команды над выделенным; `null` — команда сейчас недоступна. */
export interface SceneCommands {
  /** Выделенные без вложенных в выделенную группу. */
  units: SceneObject[];
  /** Незаблокированные из них — их меняют команды (CVS-19). */
  editable: SceneObject[];
  remove: (() => void) | null;
  copy: () => Clip | null;
  cut: (() => Clip | null) | null;
  paste: (clip: Clip, at?: Point) => void;
  /**
   * CVS-09: текст из буфера — новый текстовый блок; TXT-08: при HTML внешнего документа —
   * с базовым форматированием.
   */
  pasteText: (text: string, html?: string) => void;
  duplicate: (() => void) | null;
  align: ((op: AlignOp) => void) | null;
  distribute: ((axis: Axis) => void) | null;
  layer: ((op: LayerOp) => void) | null;
  group: (() => void) | null;
  ungroup: (() => void) | null;
  lock: (() => void) | null;
  unlock: (() => void) | null;
  unlockAll: (() => void) | null;
  setStyle: (key: StyleKey, value: string | number) => void;
  /** Подпись объекта по id (ссылки документа, TXT-06); `null` — объекта нет. */
  objectLabel: (id: string) => string | null;
}

export interface CommandContext {
  board: BoardDocument;
  scene: readonly SceneObject[];
  selection: readonly string[];
  select: (ids: string[]) => void;
  /** Кто правит — автор (CVS-22) и удаливший в корзине. */
  actor: string;
  gridStep: number;
  /** Куда вставлять: под указателем или в центре вида (вызывается в момент вставки). */
  pastePoint: () => Point;
  /** Вызывается после удаления (закрыть редактор текста). */
  onRemoved: () => void;
}

/**
 * Команды сцены над выделенным (T5.3): CVS-15 выравнивание и распределение, CVS-17 группы,
 * CVS-18 порядок слоёв, CVS-19 блокировка, CVS-20 копирование/вырезание/вставка/дублирование,
 * CVS-21 удаление; каждая правка отмечает автора и время (CVS-22). Заблокированные
 * объекты команды не меняют.
 */
export function useSceneCommands(context: CommandContext): SceneCommands {
  const {
    board,
    scene,
    selection,
    select,
    actor,
    gridStep,
    pastePoint,
    onRemoved,
  } = context;
  return useMemo(() => {
    const { objects } = board;
    const units = topmost(scene, selection);
    const editable = units.filter((o) => !o.locked);
    const ids = editable.map((o) => o.id);
    const when = <T>(enabled: boolean, command: T): T | null =>
      enabled ? command : null;

    const remove = () => {
      // Свежая сцена: выделенное могли изменить другие участники.
      const moved = moveToTrash(
        board,
        removalSet(readScene(objects), selection),
        actor,
      );
      if (moved.length === 0) return;
      select(selection.filter((id) => !moved.includes(id)));
      onRemoved();
    };

    const copy = () => {
      const clip = copyObjects(objects, readScene(objects), selection);
      if (clip !== null) saveClip(clip);
      return clip;
    };

    const placed = (): Placed[] =>
      editable.flatMap((o) => {
        const bounds = boundsOf([o]);
        return bounds === null ? [] : [{ id: o.id, bounds }];
      });

    /** Сдвиг объектов на рассчитанные смещения одной транзакцией. */
    const shift = (deltas: ReadonlyMap<string, Point>) => {
      const patches = new Map<SceneObject, ObjectPatch>();
      for (const object of editable) {
        const d = deltas.get(object.id);
        if (d && (d.x !== 0 || d.y !== 0)) {
          patches.set(object, { x: object.x + d.x, y: object.y + d.y });
        }
      }
      patchObjects(objects, patches, actor);
    };

    const groups = editable.filter((o) => o.type === GROUP_TYPE);
    const lockedUnits = units.filter((o) => o.locked);

    return {
      units,
      editable,
      remove: when(editable.length > 0, remove),
      copy,
      cut: when(editable.length > 0, () => {
        const clip = copy();
        if (clip !== null) remove();
        return clip;
      }),
      paste: (clip, at) => {
        select(
          pasteObjects(
            objects,
            clip,
            { kind: "at", point: at ?? pastePoint(), gridStep },
            actor,
          ),
        );
      },
      pasteText: (text, html = "") => {
        const at = placement("text", pastePoint(), gridStep);
        // TXT-05: новый текст — с последним выбранным размером и цветом шрифта.
        const style = loadTextStyle();
        const delta = html === "" ? null : htmlToDelta(html);
        if (delta === null || plainText(delta).trim() === "") {
          select([createObject(objects, "text", at, text, actor, style)]);
          return;
        }
        let id = "";
        transact(objects, () => {
          id = createObject(objects, "text", at, delta, actor, style);
          objectMap(objects, id)?.set("height", estimateHeight(delta, style));
        });
        select([id]);
      },
      duplicate: when(units.length > 0, () => {
        const current = readScene(objects);
        const clip = copyObjects(objects, current, selection);
        if (clip === null) return;
        // Дубликат — рядом с оригиналом, в той же группе.
        const [first] = units;
        const parentId =
          first !== undefined && units.every((o) => o.parent === first.parent)
            ? first.parent
            : null;
        const parent = current.find((o) => o.id === parentId) ?? null;
        const offset = { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET };
        select(
          pasteObjects(
            objects,
            clip,
            { kind: "offset", offset, parent },
            actor,
          ),
        );
      }),
      align: when(editable.length > 1, (op: AlignOp) => {
        shift(alignDeltas(placed(), op));
      }),
      distribute: when(editable.length > 2, (axis: Axis) => {
        shift(distributeDeltas(placed(), axis));
      }),
      layer: when(editable.length > 0, (op: LayerOp) => {
        // Порядок меняется среди соседей: в группе или на верхнем уровне (CVS-17).
        const chosen = new Set(ids);
        const changes = new Map<string, Record<string, unknown>>();
        for (const parent of new Set(editable.map((o) => o.parent))) {
          const siblings = scene.filter((o) => o.parent === parent);
          for (const [id, z] of renumber(reorder(siblings, chosen, op))) {
            changes.set(id, { z });
          }
        }
        writeFields(objects, changes, actor);
      }),
      group: when(canGroup(units), () => {
        const id = groupObjects(objects, scene, units, actor);
        if (id !== null) select([id]);
      }),
      ungroup: when(groups.length > 0, () => {
        select(ungroupObjects(objects, scene, groups, actor));
      }),
      lock: when(editable.length > 0, () => {
        setLocked(objects, ids, true, actor);
      }),
      // Снимается собственная блокировка; вложенные в заблокированную группу
      // разблокируются вместе с ней.
      unlock: when(lockedUnits.length > 0, () => {
        setLocked(
          objects,
          lockedUnits.map((o) => o.id),
          false,
          actor,
        );
      }),
      unlockAll: when(
        scene.some((o) => o.locked),
        () => {
          unlockAll(objects, actor);
        },
      ),
      setStyle: (key, value) => {
        const patches = new Map<SceneObject, ObjectPatch>();
        for (const object of editable) patches.set(object, { [key]: value });
        patchObjects(objects, patches, actor);
        // TXT-05: размер и цвет шрифта текста запоминаются для следующего блока.
        if (editable.some((o) => o.type === "text")) {
          rememberTextStyle(key, value);
        }
      },
      objectLabel: (id) => objectLabel(scene, id),
    };
  }, [board, scene, selection, select, actor, gridStep, pastePoint, onRemoved]);
}
