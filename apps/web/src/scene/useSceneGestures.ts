import { useEffect, useMemo, useRef } from "react";
import type * as Y from "yjs";
import type { CanvasGestures, CanvasPress } from "../canvas/BoardCanvas";
import type { Point } from "../realtime/messages";
import type { Corner } from "./geometry";
import {
  areaGesture,
  moveGesture,
  resizeGesture,
  rotateGesture,
  type AreaDraft,
  type Gesture,
} from "./gestures";
import type { ObjectType } from "./objectTypes";
import type { SceneObject } from "./sceneObjects";
import { toolById, type ToolId } from "./tools";

/** Что сцена даёт жестам. Значения читаются в момент жеста — всегда свежие. */
export interface SceneControls {
  objects: Y.Map<unknown>;
  scene: readonly SceneObject[];
  selection: readonly string[];
  tool: ToolId;
  gridStep: number;
  select: (ids: string[]) => void;
  setTool: (tool: ToolId) => void;
  setDraft: (draft: AreaDraft | null) => void;
  /** Ставит объект и возвращает его (CVS-09). */
  create: (type: ObjectType, at: Point) => SceneObject | null;
  openMenu: (
    menu: { kind: "object" } | { kind: "canvas"; board: Point },
    at: Point,
  ) => void;
  editText: (id: string) => void;
}

/** Жест перемещения; если указатель так и не сдвинулся, вместо него — `onClick`. */
function withoutMove(move: Gesture, onClick: () => void): Gesture {
  let moved = false;
  return {
    ...move,
    move: (pointer) => {
      moved = true;
      move.move(pointer);
    },
    end: (pointer) => {
      if (moved) move.end(pointer);
      else onClick();
    },
  };
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

/**
 * Жесты инструментов на холсте (контракт инструмента, ARCHITECTURE.md, раздел 4):
 * - CVS-09: инструмент создания ставит объект в точку нажатия и сразу даёт его подвинуть;
 * - CVS-10: щелчок выделяет (Shift — добавляет/убирает), Shift+перетаскивание по пустому
 *   месту — рамка, инструмент Lasso — область произвольной формы;
 * - CVS-12, CVS-14: перетаскивание объекта, маркеров размера и поворота;
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
      latest.current.scene.filter((o) => ids.includes(o.id));

    const area = (kind: AreaDraft["kind"], press: CanvasPress) => {
      const c = latest.current;
      const base = press.shiftKey ? [...c.selection] : [];
      return areaGesture(kind, c.scene, press.board, c.setDraft, (ids) => {
        latest.current.select([...new Set([...base, ...ids])]);
        if (kind === "lasso") latest.current.setTool("select");
      });
    };

    return {
      start(press, longPress) {
        const c = latest.current;
        const tool = toolById(c.tool);
        const { objectId, handle } = hit(press.target);

        if (tool.kind === "create") {
          const created = c.create(tool.id, press.board);
          c.setTool("select");
          if (created === null) return null;
          // Поставленный щелчком объект сразу открывается для ввода текста.
          return withoutMove(
            moveGesture(c.objects, [created], press.board, c.gridStep),
            () => {
              latest.current.editText(created.id);
            },
          );
        }
        if (tool.kind === "lasso") return area("lasso", press);

        const selected = selectedObjects(c.selection);
        if (handle !== null && selected.length > 0) {
          return handle === "rotate"
            ? rotateGesture(c.objects, selected, press.board)
            : resizeGesture(c.objects, selected, handle as Corner);
        }
        if (objectId !== null) {
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
          const move = moveGesture(
            c.objects,
            selectedObjects(ids),
            press.board,
            c.gridStep,
          );
          if (!(press.shiftKey && isSelected)) return move;
          // Shift+щелчок по выделенному убирает его из выделения, Shift+перетаскивание —
          // двигает выделенное по оси.
          return withoutMove(move, () => {
            const { selection, select } = latest.current;
            select(selection.filter((id) => id !== objectId));
          });
        }
        if (press.shiftKey || longPress) return area("marquee", press);
        return null;
      },

      tap(press) {
        const c = latest.current;
        const { objectId } = hit(press.target);
        if (objectId !== null) c.select([objectId]);
        else if (!press.shiftKey) c.select([]);
      },

      contextMenu(press) {
        const c = latest.current;
        const { objectId } = hit(press.target);
        if (objectId !== null) {
          if (!c.selection.includes(objectId)) c.select([objectId]);
          c.openMenu({ kind: "object" }, press.screen);
        } else {
          c.openMenu({ kind: "canvas", board: press.board }, press.screen);
        }
      },

      doubleClick(press) {
        const { objectId } = hit(press.target);
        if (objectId !== null) latest.current.editText(objectId);
      },
    };
  }, []);
}
