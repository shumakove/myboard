import type { Point } from "../realtime/messages";
import type { Gesture } from "./gestures";
import { dropAt, type NodeDrop } from "./mindmapData";
import type { NodeDragState } from "./MindmapView";
import type { SceneObject } from "./sceneObjects";

/** Что нужно перетаскиванию узла от сцены. */
export interface NodeDragContext {
  /** Показать перетаскиваемый узел и цель; `null` — жест закончен. */
  show: (drag: (NodeDragState & { mindmap: string }) | null) => void;
  /** Отпустить узел на цель. */
  drop: (mindmap: string, node: string, drop: NodeDrop) => void;
  /** Нажатие без движения — выбрать узел. */
  select: (mindmap: string, node: string) => void;
}

/**
 * MAP-02: перетаскивание узла выделенной карты. Узел едет за указателем, цель под
 * указателем подсвечивается (в конец её детей, перед ней или после неё); отпускание
 * на цели переставляет узел, мимо узлов — ничего не меняет.
 */
export function nodeDragGesture(
  ctx: NodeDragContext,
  mindmap: SceneObject,
  node: string,
  start: Point,
): Gesture {
  let target: NodeDrop | null = null;
  return {
    move(pointer) {
      const local = {
        x: pointer.board.x - mindmap.x,
        y: pointer.board.y - mindmap.y,
      };
      target =
        mindmap.mindmap === null ? null : dropAt(mindmap.mindmap, node, local);
      ctx.show({
        mindmap: mindmap.id,
        node,
        dx: pointer.board.x - start.x,
        dy: pointer.board.y - start.y,
        target: target?.target ?? null,
        place: target?.place ?? null,
      });
    },
    end() {
      ctx.show(null);
      if (target !== null) ctx.drop(mindmap.id, node, target);
    },
    cancel() {
      ctx.show(null);
    },
    click() {
      ctx.select(mindmap.id, node);
    },
  };
}
