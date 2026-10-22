import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import {
  ANCHORS,
  anchorPoint,
  constrainAngle,
  findAttachment,
  projectOnto,
  routeOf,
} from "./connectors";
import type { Gesture, ScenePointer } from "./gestures";
import {
  boardPoints,
  createLine,
  removeLabel,
  setEnd,
  setLabel,
  setPoints,
  type BoardEnd,
  type EndName,
} from "./lineEdits";
import { readScene, type SceneObject } from "./sceneObjects";

/** CVS-26: на таком расстоянии от объекта (экранные px) конец линии притягивается к нему. */
export const ATTACH_PX = 16;
/** Длина линии, поставленной щелчком без протяжки, единицы доски. */
export const DEFAULT_LINE_LENGTH = 200;

/** Точки привязки объекта под концом линии, пока его тянут; `active` — выбранная. */
export type ConnectHint = { points: Point[]; active: Point } | null;

export interface LineGestureContext {
  objects: Y.Map<unknown>;
  /** Сцена в момент жеста. */
  scene: readonly SceneObject[];
  zoom: number;
  actor: string;
  setHint: (hint: ConnectHint) => void;
  select: (ids: string[]) => void;
}

/**
 * Куда встаёт конец линии под указателем:
 * - CVS-26: рядом с объектом — в его ближайшую точку привязки; Alt — не притягивать;
 * - CON-05: свободный конец без Shift — под углом, кратным 45°, к соседней точке;
 *   с Shift — под любым углом.
 */
export function endAt(
  ctx: LineGestureContext,
  lineId: string | null,
  pointer: ScenePointer,
  neighbor: Point | null,
): BoardEnd {
  if (!pointer.altKey) {
    const exclude = new Set(lineId === null ? [] : [lineId]);
    const found = findAttachment(
      ctx.scene,
      pointer.board,
      ATTACH_PX / ctx.zoom,
      exclude,
    );
    const target = found && ctx.scene.find((o) => o.id === found.object);
    if (found && target) {
      ctx.setHint({
        points: ANCHORS.map((a) => anchorPoint(target, a)),
        active: found.point,
      });
      return { point: found.point, object: found.object, anchor: found.anchor };
    }
  }
  ctx.setHint(null);
  const point =
    neighbor === null
      ? pointer.board
      : constrainAngle(neighbor, pointer.board, pointer.shiftKey);
  return { point };
}

function fresh(ctx: LineGestureContext, id: string): SceneObject | null {
  return readScene(ctx.objects).find((o) => o.id === id) ?? null;
}

/**
 * CON-01: инструмент Line — протяжка от точки нажатия рисует линию; начало и конец
 * на объектах привязываются к ним (CVS-26). Щелчок без протяжки ставит горизонтальную
 * линию длиной `DEFAULT_LINE_LENGTH`.
 */
export function drawLineGesture(
  ctx: LineGestureContext,
  press: ScenePointer,
): Gesture {
  const start = endAt(ctx, null, { ...press, shiftKey: true }, null);
  ctx.setHint(null);
  const id = createLine(ctx.objects, start, start, ctx.actor);
  ctx.select([id]);
  const line = fresh(ctx, id);
  const drag = line === null ? null : endGesture(ctx, line, "end");
  return {
    autoscroll: true,
    move: (pointer) => drag?.move(pointer),
    end: (pointer) => drag?.end(pointer),
    cancel: () => {
      ctx.setHint(null);
      ctx.objects.delete(id);
    },
    click: () => {
      if (line === null) return;
      const { point } = start;
      setEnd(
        ctx.objects,
        line,
        "end",
        { point: { x: point.x + DEFAULT_LINE_LENGTH, y: point.y } },
        ctx.actor,
      );
    },
  };
}

/** CVS-26, CON-05: перетаскивание конца линии. */
export function endGesture(
  ctx: LineGestureContext,
  line: SceneObject,
  name: EndName,
): Gesture {
  const path = line.line?.path ?? [];
  const neighbor = (name === "start" ? path[1] : path.at(-2)) ?? null;
  const apply = (pointer: ScenePointer) => {
    setEnd(
      ctx.objects,
      line,
      name,
      endAt(ctx, line.id, pointer, neighbor),
      ctx.actor,
    );
  };
  return {
    autoscroll: true,
    move: apply,
    end: (pointer) => {
      apply(pointer);
      ctx.setHint(null);
    },
    cancel: () => {
      ctx.setHint(null);
    },
  };
}

/**
 * Перетаскивание точки изгиба `index`; `insert` — маркер середины участка: при первом
 * движении на этом участке появляется новая точка (CON-01: ломаная и кривая через точки).
 */
export function pointGesture(
  ctx: LineGestureContext,
  line: SceneObject,
  index: number,
  insert: boolean,
): Gesture {
  const points = boardPoints(line);
  let inserted = !insert;
  const apply = ({ board }: ScenePointer) => {
    if (!inserted) {
      points.splice(index, 0, board);
      inserted = true;
    }
    points[index] = board;
    setPoints(ctx.objects, line, points, ctx.actor);
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/** CON-03: подпись двигают вдоль линии; щелчок по подписи выбирает её. */
export function labelGesture(
  ctx: LineGestureContext,
  line: SceneObject,
  labelId: string,
  onPick: (labelId: string) => void,
): Gesture {
  const route = line.line === null ? [] : routeOf(line.line);
  const apply = ({ board }: ScenePointer) => {
    setLabel(
      ctx.objects,
      line.id,
      labelId,
      { position: projectOnto(route, board) },
      ctx.actor,
    );
  };
  return {
    move: apply,
    end: (pointer) => {
      apply(pointer);
      onPick(labelId);
    },
    cancel: () => undefined,
    click: () => {
      onPick(labelId);
    },
  };
}

/** Пустая подпись после правки не остаётся на линии. */
export function dropEmptyLabel(
  objects: Y.Map<unknown>,
  line: SceneObject | undefined,
  labelId: string,
  actor: string,
): boolean {
  const label = line?.line?.labels.find((l) => l.id === labelId);
  if (line === undefined || label === undefined || label.text.trim() !== "") {
    return false;
  }
  removeLabel(objects, line.id, labelId, actor);
  return true;
}
