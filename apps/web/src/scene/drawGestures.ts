import type * as Y from "yjs";
import type { CanvasPress } from "../canvas/BoardCanvas";
import type { Point } from "../realtime/messages";
import { createDrawing, type StrokeStyle } from "./drawEdits";
import { touchesStroke } from "./drawingShape";
import type { Gesture } from "./gestures";
import type { SceneObject } from "./sceneObjects";

/** Новая точка штриха — не ближе этого к прошлой, экранных px: штрих не раздувается. */
const POINT_STEP_PX = 2;
/** DRW-03: радиус ластика, экранных px. */
export const ERASER_RADIUS_PX = 10;

/** Штрих, который рисуют прямо сейчас: виден только рисующему до отпускания. */
export interface InkDraft extends StrokeStyle {
  points: Point[];
}

/**
 * DRW-01, DRW-04: штрих пера или маркера. Пока рисуют, штрих — черновик вкладки
 * (`onDraft`); в документ он попадает целиком при отпускании, одной правкой. С Shift штрих —
 * прямой отрезок от начала до указателя. Касание без движения ставит точку. Отменённый
 * жест (второй палец — щипок) ничего не пишет.
 */
export function drawGesture(
  objects: Y.Map<unknown>,
  press: CanvasPress,
  style: StrokeStyle,
  options: {
    zoom: number;
    actor: string;
    onDraft: (ink: InkDraft | null) => void;
    /** Штрих записан в документ (попадание во фрейм, FRM-01). */
    onCommit?: (id: string) => void;
  },
): Gesture {
  const start = press.board;
  let freehand: Point[] = [start];
  let points: Point[] = [start];
  const step = POINT_STEP_PX / options.zoom;
  const show = () => {
    options.onDraft({ ...style, points });
  };
  const commit = () => {
    options.onDraft(null);
    const id = createDrawing(objects, points, style, options.actor);
    options.onCommit?.(id);
  };
  show();
  return {
    ink: true,
    move: ({ board, shiftKey }) => {
      const last = freehand.at(-1) ?? start;
      if (Math.hypot(board.x - last.x, board.y - last.y) >= step) {
        freehand = [...freehand, board];
      }
      points = shiftKey ? [start, board] : freehand;
      show();
    },
    end: ({ board, shiftKey }) => {
      if (shiftKey) points = [start, board];
      else if (freehand.at(-1) !== board) points = [...freehand, board];
      commit();
    },
    click: commit,
    cancel: () => {
      options.onDraft(null);
    },
  };
}

/**
 * DRW-03: ластик стирает штрихи, которых касается по пути (каждый — в корзину, целиком).
 * Заблокированный штрих (сам или его группа, CVS-19) остаётся.
 */
export function eraseGesture(
  scene: readonly SceneObject[],
  press: CanvasPress,
  options: { zoom: number; erase: (ids: string[]) => void },
): Gesture {
  const radius = ERASER_RADIUS_PX / options.zoom;
  const erased = new Set<string>();
  let last = press.board;
  const sweep = (to: Point) => {
    const from = last;
    last = to;
    // Точки пути не реже радиуса: быстрый взмах не перескакивает тонкий штрих.
    const steps = Math.max(
      1,
      Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / radius),
    );
    const hits = scene.filter(
      (o) =>
        o.type === "drawing" &&
        !o.locked &&
        !erased.has(o.id) &&
        Array.from({ length: steps + 1 }, (_, i) => ({
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        })).some((p) => touchesStroke(o, p, radius)),
    );
    if (hits.length === 0) return;
    for (const o of hits) erased.add(o.id);
    options.erase(hits.map((o) => o.id));
  };
  return {
    ink: true,
    move: ({ board }) => {
      sweep(board);
    },
    end: ({ board }) => {
      sweep(board);
    },
    click: () => {
      sweep(press.board);
    },
    cancel: () => undefined,
  };
}

/** DRW-05: лазер — след указателя без правок документа. */
export function laserGesture(
  press: CanvasPress,
  laser: { begin: (at: Point) => void; add: (at: Point) => void },
): Gesture {
  laser.begin(press.board);
  return {
    ink: true,
    move: ({ board }) => {
      laser.add(board);
    },
    end: ({ board }) => {
      laser.add(board);
    },
    click: () => undefined,
    cancel: () => undefined,
  };
}
