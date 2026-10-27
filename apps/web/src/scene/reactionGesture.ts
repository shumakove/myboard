import type { Point } from "../realtime/messages";
import type { Gesture } from "./gestures";
import { reactionSize } from "./reactionData";
import type { ReactionDraft } from "./ReactionView";

/** Как часто растёт реакция, пока её держат, мс. */
const GROW_INTERVAL = 40;

/**
 * RCT-01, RCT-03: нажатие ставит реакцию в точку; пока кнопку мыши или палец держат,
 * реакция растёт (видна черновиком), отпускание записывает её в документ с выросшим
 * размером. Отмена жеста реакцию не ставит.
 */
export function reactionGesture(
  center: Point,
  image: string,
  handlers: {
    show: (draft: ReactionDraft | null) => void;
    place: (center: Point, size: number) => void;
  },
): Gesture {
  const started = Date.now();
  const size = () => reactionSize(Date.now() - started);
  const draw = () => {
    handlers.show({ center, size: size(), image });
  };
  draw();
  const timer = setInterval(draw, GROW_INTERVAL);
  const stop = () => {
    clearInterval(timer);
    handlers.show(null);
  };
  const place = () => {
    const grown = size();
    stop();
    handlers.place(center, grown);
  };
  return { move: () => undefined, end: place, click: place, cancel: stop };
}
