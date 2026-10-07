import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { Rect } from "../canvas/camera";
import {
  angleBetween,
  boundsOf,
  center,
  cornerPoint,
  frameInside,
  groupScale,
  lockAxis,
  opposite,
  polygonContains,
  rectContains,
  rectFromPoints,
  resizeFrame,
  rotateFrame,
  ROTATION_STEP,
  scaleFrame,
  snap,
  type Corner,
  type Frame,
} from "./geometry";
import {
  patchObjects,
  type ObjectPatch,
  type SceneObject,
} from "./sceneObjects";

/** Указатель во время жеста: точка доски и зажатые модификаторы. */
export interface ScenePointer {
  board: Point;
  shiftKey: boolean;
  altKey: boolean;
}

/** Жест на холсте от нажатия до отпускания. */
export interface Gesture {
  move(pointer: ScenePointer): void;
  end(pointer: ScenePointer): void;
  cancel(): void;
  /** CVS-13: у края холста вид прокручивается, пока жест идёт. */
  autoscroll?: boolean;
}

/** Черновик выделения областью — для отрисовки. */
export type AreaDraft =
  { kind: "marquee"; rect: Rect } | { kind: "lasso"; points: Point[] };

function writeFrames(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  frameOf: (object: SceneObject) => Partial<Frame>,
): void {
  const patches = new Map<SceneObject, ObjectPatch>();
  for (const object of targets) patches.set(object, frameOf(object));
  patchObjects(objects, patches);
}

/**
 * CVS-12: перемещение выделенных объектов. Общая рамка прилипает левым верхним углом
 * к сетке; Alt отключает прилипание, Shift оставляет сдвиг только по одной оси.
 */
export function moveGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  start: Point,
  gridStep: number,
): Gesture {
  const bounds = boundsOf(targets);
  const apply = (pointer: ScenePointer) => {
    if (bounds === null) return;
    let delta = { x: pointer.board.x - start.x, y: pointer.board.y - start.y };
    const locked = pointer.shiftKey;
    if (locked) delta = lockAxis(delta);
    if (!pointer.altKey && gridStep > 0) {
      delta = {
        x:
          locked && delta.x === 0
            ? 0
            : snap(bounds.x + delta.x, gridStep) - bounds.x,
        y:
          locked && delta.y === 0
            ? 0
            : snap(bounds.y + delta.y, gridStep) - bounds.y,
      };
    }
    writeFrames(objects, targets, (o) => ({
      x: o.x + delta.x,
      y: o.y + delta.y,
    }));
  };
  return { move: apply, end: apply, cancel: () => undefined, autoscroll: true };
}

/**
 * CVS-14: изменение размера за угол рамки выделения. Один объект меняет ширину и высоту
 * в своей повёрнутой системе; несколько — масштабируются вместе от противоположного угла.
 */
export function resizeGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  corner: Corner,
): Gesture {
  const bounds = boundsOf(targets);
  const apply = ({ board }: ScenePointer) => {
    const [single] = targets;
    if (targets.length === 1 && single !== undefined) {
      writeFrames(objects, targets, (o) => resizeFrame(o, corner, board));
      return;
    }
    if (bounds === null) return;
    const scale = groupScale(bounds, corner, board);
    const origin = cornerPoint({ ...bounds, rotation: 0 }, opposite(corner));
    writeFrames(objects, targets, (o) => scaleFrame(o, origin, scale));
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/** CVS-14: поворот вокруг центра выделения; Shift — шагами по 15°. */
export function rotateGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  start: Point,
): Gesture {
  const bounds = boundsOf(targets);
  const pivot = bounds === null ? start : center(bounds);
  const from = angleBetween(pivot, start);
  const [single] = targets;
  const apply = ({ board, shiftKey }: ScenePointer) => {
    let delta = angleBetween(pivot, board) - from;
    if (shiftKey) {
      // Один объект встаёт на кратный угол; несколько поворачиваются на кратный угол.
      const base = targets.length === 1 && single ? single.rotation : 0;
      delta = snap(base + delta, ROTATION_STEP) - base;
    }
    writeFrames(objects, targets, (o) => rotateFrame(o, pivot, delta));
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/**
 * CVS-10: выделение рамкой или лассо. Попадают объекты, лежащие внутри целиком.
 * `onDraft` рисует область, `onSelect` получает id выделенных.
 */
export function areaGesture(
  kind: AreaDraft["kind"],
  scene: readonly SceneObject[],
  start: Point,
  onDraft: (draft: AreaDraft | null) => void,
  onSelect: (ids: string[]) => void,
): Gesture {
  const points: Point[] = [start];
  let last = start;
  const draft = (): AreaDraft =>
    kind === "marquee"
      ? { kind, rect: rectFromPoints(start, last) }
      : { kind, points: [...points] };
  onDraft(draft());
  return {
    move: ({ board }) => {
      last = board;
      points.push(board);
      onDraft(draft());
    },
    end: ({ board }) => {
      last = board;
      points.push(board);
      const area = draft();
      const contains =
        area.kind === "marquee"
          ? (p: Point) => rectContains(area.rect, p)
          : (p: Point) => polygonContains(area.points, p);
      onDraft(null);
      onSelect(scene.filter((o) => frameInside(o, contains)).map((o) => o.id));
    },
    cancel: () => {
      onDraft(null);
    },
  };
}
