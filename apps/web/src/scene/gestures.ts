import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { Rect } from "../canvas/camera";
import { gapFor, spacingDeltas, type Axis } from "./arrange";
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
import { guidesFor, snapToNeighbors, type Guide } from "./guides";
import {
  GROUP_TYPE,
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

/**
 * Жест на холсте от нажатия до отпускания. `move` и `end` приходят, только если указатель
 * ушёл дальше допуска щелчка; отпускание на месте — `click`, а без него `cancel` (BUG-004).
 */
export interface Gesture {
  move(pointer: ScenePointer): void;
  end(pointer: ScenePointer): void;
  cancel(): void;
  /** Отпускание без движения: щелчок, касание, долгое нажатие на месте. */
  click?: () => void;
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
  actor: string,
): void {
  const patches = new Map<SceneObject, ObjectPatch>();
  for (const object of targets) patches.set(object, frameOf(object));
  patchObjects(objects, patches, actor);
}

/** Что нужно перемещению кроме объектов: сетка, соседи для направляющих, автор правки. */
export interface MoveOptions {
  gridStep: number;
  /** CVS-16: рамки соседей, к которым прилипает перемещаемое. */
  neighbors: readonly Rect[];
  /** Расстояние прилипания к соседу, единицы доски. */
  threshold: number;
  onGuides: (guides: Guide[]) => void;
  actor: string;
}

/**
 * CVS-12, CVS-16: перемещение выделенных объектов. Общая рамка прилипает краем или
 * центром к соседям (направляющие видны, пока тянут), иначе левым верхним углом к сетке;
 * Alt отключает прилипание, Shift оставляет сдвиг только по одной оси.
 */
export function moveGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  start: Point,
  options: MoveOptions,
): Gesture {
  const { gridStep, neighbors, threshold, onGuides, actor } = options;
  const bounds = boundsOf(targets);
  // Пишется только изменившийся сдвиг: одинаковые значения тоже дали бы кадр sync.
  let written = { x: 0, y: 0 };
  const apply = (pointer: ScenePointer) => {
    if (bounds === null) return;
    let raw = { x: pointer.board.x - start.x, y: pointer.board.y - start.y };
    const axisLocked = pointer.shiftKey;
    if (axisLocked) raw = lockAxis(raw);
    const snapping = !pointer.altKey;
    const axisDelta = (axis: Axis): number => {
      const value = raw[axis];
      if (!snapping || (axisLocked && value === 0)) return value;
      const moved = { ...bounds, [axis]: bounds[axis] + value };
      const guide = snapToNeighbors(moved, neighbors, axis, threshold);
      if (guide !== null) return value + guide;
      return gridStep > 0
        ? snap(bounds[axis] + value, gridStep) - bounds[axis]
        : value;
    };
    const delta = { x: axisDelta("x"), y: axisDelta("y") };
    const moved = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y };
    onGuides(snapping ? guidesFor(moved, neighbors) : []);
    if (delta.x === written.x && delta.y === written.y) return;
    written = delta;
    writeFrames(
      objects,
      targets,
      (o) => ({ x: o.x + delta.x, y: o.y + delta.y }),
      actor,
    );
  };
  return {
    move: apply,
    end: (pointer) => {
      apply(pointer);
      onGuides([]);
    },
    cancel: () => {
      onGuides([]);
    },
    autoscroll: true,
  };
}

/**
 * CVS-14: изменение размера за угол рамки выделения. Один объект меняет ширину и высоту
 * в своей повёрнутой системе; несколько или группа — объекты `leaves` масштабируются
 * вместе от противоположного угла общей рамки.
 */
export function resizeGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  leaves: readonly SceneObject[],
  corner: Corner,
  actor: string,
): Gesture {
  const bounds = boundsOf(targets);
  const [single] = targets;
  const apply = ({ board }: ScenePointer) => {
    if (
      targets.length === 1 &&
      single !== undefined &&
      single.type !== GROUP_TYPE
    ) {
      writeFrames(
        objects,
        targets,
        (o) => resizeFrame(o, corner, board),
        actor,
      );
      return;
    }
    if (bounds === null) return;
    const scale = groupScale(bounds, corner, board);
    const origin = cornerPoint({ ...bounds, rotation: 0 }, opposite(corner));
    writeFrames(objects, leaves, (o) => scaleFrame(o, origin, scale), actor);
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/**
 * CVS-15: жест за маркер промежутка рамки выделения — объекты встают вдоль оси с равным
 * промежутком, который растёт или уменьшается вслед за указателем (не меньше нуля).
 */
export function spacingGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  axis: Axis,
  start: Point,
  actor: string,
): Gesture {
  const items = targets.flatMap((o) => {
    const bounds = boundsOf([o]);
    return bounds === null ? [] : [{ id: o.id, bounds }];
  });
  const bounds = boundsOf(targets);
  const apply = ({ board }: ScenePointer) => {
    if (bounds === null) return;
    const length =
      (axis === "x" ? bounds.width : bounds.height) + board[axis] - start[axis];
    const gap = Math.max(0, gapFor(items, axis, length));
    const deltas = spacingDeltas(items, axis, gap);
    writeFrames(
      objects,
      targets,
      (o) => {
        const d = deltas.get(o.id) ?? { x: 0, y: 0 };
        return { x: o.x + d.x, y: o.y + d.y };
      },
      actor,
    );
  };
  return { move: apply, end: apply, cancel: () => undefined };
}

/** CVS-14: поворот вокруг центра выделения; Shift — шагами по 15°. */
export function rotateGesture(
  objects: Y.Map<unknown>,
  targets: readonly SceneObject[],
  start: Point,
  actor: string,
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
    writeFrames(objects, targets, (o) => rotateFrame(o, pivot, delta), actor);
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
