import type { CameraView } from "../realtime/messages";
import { panBy, ZOOM_STEP, zoomBy } from "./camera";

/** Сдвиг вида стрелкой, экранные пиксели. */
export const ARROW_STEP = 100;

const PAN: Record<string, [number, number]> = {
  // Вид едет в сторону стрелки — содержимое в обратную.
  ArrowLeft: [ARROW_STEP, 0],
  ArrowRight: [-ARROW_STEP, 0],
  ArrowUp: [0, ARROW_STEP],
  ArrowDown: [0, -ARROW_STEP],
};

/**
 * CVS-02: клавиши камеры — «+»/«−» масштабируют вид относительно центра, стрелки сдвигают.
 * Сочетания с Ctrl/⌘/Alt остаются браузеру (Ctrl + «+» — масштаб страницы).
 * `null` — клавиша не относится к камере.
 */
export function cameraKeyAction(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey">,
): ((camera: CameraView) => CameraView) | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case "+":
    case "=":
      return (camera) => zoomBy(camera, ZOOM_STEP);
    case "-":
    case "_":
    case "−":
      return (camera) => zoomBy(camera, 1 / ZOOM_STEP);
  }
  const pan = PAN[event.key];
  if (pan === undefined) return null;
  const [dx, dy] = pan;
  return (camera) => panBy(camera, dx, dy);
}

/** Клавиши в полях ввода принадлежат полю, а не камере. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}
