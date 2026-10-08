import { useEffect, useMemo, useRef } from "react";
import type * as Y from "yjs";
import type { CanvasGestures, CanvasPress } from "../canvas/BoardCanvas";
import type { Point } from "../realtime/messages";
import { boundsOf, type Corner } from "./geometry";
import {
  areaGesture,
  moveGesture,
  resizeGesture,
  rotateGesture,
  spacingGesture,
  type AreaDraft,
  type Gesture,
} from "./gestures";
import {
  ancestors,
  enterGroup,
  selectionTarget,
  topmost,
  withDescendants,
} from "./groups";
import { GUIDE_SNAP_PX, type Guide } from "./guides";
import type { ObjectType } from "./objectTypes";
import { GROUP_TYPE, type SceneObject } from "./sceneObjects";
import { toolById, type ToolId } from "./tools";

/** Что сцена даёт жестам. Значения читаются в момент жеста — всегда свежие. */
export interface SceneControls {
  objects: Y.Map<unknown>;
  scene: readonly SceneObject[];
  selection: readonly string[];
  tool: ToolId;
  gridStep: number;
  /** Масштаб вида: расстояние прилипания к соседям задано в экранных px (CVS-16). */
  zoom: number;
  /** Кто правит — для отметки «изменил» (CVS-22). */
  actor: string;
  select: (ids: string[]) => void;
  setTool: (tool: ToolId) => void;
  setDraft: (draft: AreaDraft | null) => void;
  setGuides: (guides: Guide[]) => void;
  /** Ставит объект и возвращает его (CVS-09). */
  create: (type: ObjectType, at: Point) => SceneObject | null;
  openMenu: (
    menu: { kind: "object" } | { kind: "canvas"; board: Point },
    at: Point,
  ) => void;
  editText: (id: string) => void;
}

function hit(target: EventTarget | null): {
  objectId: string | null;
  handle: string | null;
} {
  if (!(target instanceof Element)) return { objectId: null, handle: null };
  return {
    objectId:
      target.closest("[data-object-id]")?.getAttribute("data-object-id") ??
      null,
    handle:
      target.closest("[data-handle]")?.getAttribute("data-handle") ?? null,
  };
}

/** Объекты верхнего уровня: их выделяют рамка и лассо (группа — целиком). */
function roots(scene: readonly SceneObject[]): SceneObject[] {
  const ids = new Set(scene.map((o) => o.id));
  return scene.filter((o) => o.parent === null || !ids.has(o.parent));
}

/** Соседи перемещаемых для направляющих: всё, кроме них самих, вложенных и их групп. */
function neighborsOf(
  scene: readonly SceneObject[],
  moving: readonly SceneObject[],
) {
  const related = new Set(
    withDescendants(
      scene,
      moving.map((o) => o.id),
    ).map((o) => o.id),
  );
  for (const object of moving) {
    for (const a of ancestors(scene, object.id)) related.add(a.id);
  }
  return scene
    .filter((o) => !related.has(o.id))
    .flatMap((o) => boundsOf([o]) ?? []);
}

/** Жест, который ничего не меняет: заблокированный объект не двигается (CVS-19). */
function still(click?: () => void): Gesture {
  const noop = () => undefined;
  return { move: noop, end: noop, cancel: noop, ...(click && { click }) };
}

/**
 * Жесты инструментов на холсте (контракт инструмента, ARCHITECTURE.md, раздел 4):
 * - CVS-09: инструмент создания ставит объект в точку нажатия и сразу даёт его подвинуть;
 * - CVS-10: щелчок выделяет (Shift — добавляет/убирает), Shift+перетаскивание по пустому
 *   месту — рамка, инструмент Lasso — область произвольной формы;
 * - CVS-12, CVS-14: перетаскивание объекта, маркеров размера и поворота;
 * - CVS-15: маркеры промежутка распределяют выделенное с равным шагом;
 * - CVS-16: при перемещении — прилипание и направляющие к соседям;
 * - CVS-17: щелчок по объекту группы выделяет группу, двойной — объект внутри;
 * - CVS-19: заблокированный объект выделяется, но не двигается;
 * - CVS-23: контекстное меню объекта и пустого места;
 * - MOB-03: касание пальцем по невыделенному объекту двигает вид; долгое нажатие выделяет
 *   объект (и даёт его тянуть) или начинает рамку на пустом месте.
 */
export function useSceneGestures(controls: SceneControls): CanvasGestures {
  const latest = useRef(controls);
  useEffect(() => {
    latest.current = controls;
  });

  return useMemo<CanvasGestures>(() => {
    const selectedObjects = (ids: readonly string[]) =>
      topmost(latest.current.scene, ids);

    const move = (
      objects: readonly SceneObject[],
      press: CanvasPress,
    ): Gesture => {
      const c = latest.current;
      const targets = objects.filter((o) => !o.locked);
      if (targets.length === 0) return still();
      return moveGesture(c.objects, targets, press.board, {
        gridStep: c.gridStep,
        neighbors: neighborsOf(c.scene, targets),
        threshold: GUIDE_SNAP_PX / c.zoom,
        onGuides: c.setGuides,
        actor: c.actor,
      });
    };

    const area = (kind: AreaDraft["kind"], press: CanvasPress) => {
      const c = latest.current;
      const base = press.shiftKey ? [...c.selection] : [];
      return areaGesture(
        kind,
        roots(c.scene),
        press.board,
        c.setDraft,
        (ids) => {
          latest.current.select([...new Set([...base, ...ids])]);
          if (kind === "lasso") latest.current.setTool("select");
        },
      );
    };

    return {
      start(press, longPress) {
        const c = latest.current;
        const tool = toolById(c.tool);
        const { objectId: leafId, handle } = hit(press.target);

        if (tool.kind === "create") {
          const created = c.create(tool.id, press.board);
          c.setTool("select");
          if (created === null) return null;
          // Поставленный щелчком объект сразу открывается для ввода текста.
          return {
            ...move([created], press),
            click: () => {
              latest.current.editText(created.id);
            },
          };
        }
        if (tool.kind === "lasso") return area("lasso", press);

        const selected = selectedObjects(c.selection);
        if (handle !== null && selected.length > 0) {
          if (selected.some((o) => o.locked)) return still();
          if (handle === "rotate") {
            return rotateGesture(c.objects, selected, press.board, c.actor);
          }
          if (handle === "spacing-x" || handle === "spacing-y") {
            const axis = handle === "spacing-x" ? "x" : "y";
            return spacingGesture(
              c.objects,
              selected,
              axis,
              press.board,
              c.actor,
            );
          }
          const leaves = withDescendants(
            c.scene,
            selected.map((o) => o.id),
          ).filter((o) => o.type !== GROUP_TYPE);
          return resizeGesture(
            c.objects,
            selected,
            leaves,
            handle as Corner,
            c.actor,
          );
        }
        if (leafId !== null) {
          const objectId = selectionTarget(c.scene, leafId, c.selection);
          const isSelected = c.selection.includes(objectId);
          // MOB-03: короткое движение пальцем двигает вид, а не объект.
          if (press.pointerType === "touch" && !longPress && !isSelected) {
            return null;
          }
          const ids = isSelected
            ? [...c.selection]
            : press.shiftKey
              ? [...c.selection, objectId]
              : [objectId];
          c.select(ids);
          const moving = move(selectedObjects(ids), press);
          if (!(press.shiftKey && isSelected)) return moving;
          // Shift+щелчок по выделенному убирает его из выделения, Shift+перетаскивание —
          // двигает выделенное по оси.
          return {
            ...moving,
            click: () => {
              const { selection, select } = latest.current;
              select(selection.filter((id) => id !== objectId));
            },
          };
        }
        if (press.shiftKey || longPress) return area("marquee", press);
        return null;
      },

      tap(press) {
        const c = latest.current;
        const { objectId: leafId } = hit(press.target);
        if (leafId !== null) {
          c.select([selectionTarget(c.scene, leafId, c.selection)]);
        } else if (!press.shiftKey) c.select([]);
      },

      contextMenu(press) {
        const c = latest.current;
        const { objectId: leafId } = hit(press.target);
        if (leafId !== null) {
          const objectId = selectionTarget(c.scene, leafId, c.selection);
          if (!c.selection.includes(objectId)) c.select([objectId]);
          c.openMenu({ kind: "object" }, press.screen);
        } else {
          c.openMenu({ kind: "canvas", board: press.board }, press.screen);
        }
      },

      doubleClick(press) {
        const c = latest.current;
        const { objectId: leafId } = hit(press.target);
        if (leafId === null) return;
        const inner = enterGroup(c.scene, leafId, c.selection);
        if (inner !== null) c.select([inner]);
        else c.editText(leafId);
      },
    };
  }, []);
}
