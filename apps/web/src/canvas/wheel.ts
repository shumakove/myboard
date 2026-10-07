/**
 * CVS-03: поведение колеса мыши.
 * - `zoom` — каждое вращение колеса меняет масштаб;
 * - `scroll` — колесо двигает вид, масштаб — колесом с зажатым Ctrl или ⌘
 *   (так же приходит щипок на тачпаде).
 */
export type WheelMode = "zoom" | "scroll";

export const DEFAULT_WHEEL_MODE: WheelMode = "zoom";

const STORAGE_KEY = "myboard.wheelMode";
/** Высота строки для `deltaMode = 1` (колесо в строках, Firefox). */
const LINE_PX = 16;
/** Чувствительность масштаба: экспонента от прокрутки в пикселях. */
const ZOOM_SENSITIVITY = 0.002;

export type WheelAction =
  { kind: "zoom"; factor: number } | { kind: "pan"; dx: number; dy: number };

/** Что делает событие колеса в выбранном режиме; `pan` — экранный сдвиг содержимого. */
export function wheelAction(
  event: Pick<
    WheelEvent,
    "deltaX" | "deltaY" | "deltaMode" | "ctrlKey" | "metaKey" | "shiftKey"
  >,
  mode: WheelMode,
): WheelAction {
  const scale = event.deltaMode === 1 ? LINE_PX : 1;
  const dx = event.deltaX * scale;
  const dy = event.deltaY * scale;
  if (mode === "zoom" || event.ctrlKey || event.metaKey) {
    return { kind: "zoom", factor: Math.exp(-dy * ZOOM_SENSITIVITY) };
  }
  // Shift + колесо — сдвиг по горизонтали (там, где браузер сам не поменял оси).
  if (event.shiftKey && dx === 0) return { kind: "pan", dx: -dy, dy: 0 };
  return { kind: "pan", dx: -dx, dy: -dy };
}

/** Выбор режима запоминается в этом браузере для всех досок. */
export function loadWheelMode(): WheelMode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "zoom" || saved === "scroll" ? saved : DEFAULT_WHEEL_MODE;
  } catch {
    return DEFAULT_WHEEL_MODE;
  }
}

export function saveWheelMode(mode: WheelMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Хранилище недоступно: выбор действует до перезагрузки.
  }
}
