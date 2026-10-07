import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { CameraView, Point } from "../realtime/messages";
import { panBy, pinch, screenToBoard, zoomAt, type Size } from "./camera";
import { wheelAction, type WheelMode } from "./wheel";
import "./canvas.css";

/** Шаг точечного фона, px при масштабе 1: по нему видно движение вида. */
const DOT_STEP = 32;

export type CameraUpdate = (camera: CameraView) => CameraView;

/**
 * Область холста с камерой над бесконечной плоскостью (CVS-01). Дочерние элементы
 * рисуются в координатах доски в слое с CSS-преобразованием камеры.
 *
 * - CVS-02, CVS-03: колесо масштабирует или сдвигает вид по выбранному режиму;
 *   перетаскивание левой или средней кнопкой мыши сдвигает вид.
 * - MOB-02: один палец двигает вид, два — щипок (масштаб и сдвиг одновременно).
 * - COL-02: положение указателя уходит наверх в координатах доски; во время щипка
 *   курсор не прыгает между пальцами.
 */
export function BoardCanvas({
  camera,
  wheelMode,
  onMove,
  onPointer,
  onResize,
  children,
}: {
  camera: CameraView;
  wheelMode: WheelMode;
  /** Своё перемещение вида (сдвиг, масштаб). */
  onMove: (update: CameraUpdate) => void;
  /** Указатель над холстом в координатах доски; `null` — ушёл с холста. */
  onPointer: (point: Point | null) => void;
  /** Размер области холста — для миникарты. */
  onResize?: (size: Size) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /** Зажатые указатели (пальцы, кнопка мыши): id → точка в области холста. */
  const pressed = useRef(new Map<number, Point>());
  const latest = useRef({ onMove, wheelMode, onResize });
  useEffect(() => {
    latest.current = { onMove, wheelMode, onResize };
  });

  // React вешает wheel пассивным — без preventDefault колесо прокручивало бы страницу.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (element === null) return;
      const { point, size } = locate(element, event);
      const action = wheelAction(event, latest.current.wheelMode);
      latest.current.onMove((current) =>
        action.kind === "zoom"
          ? zoomAt(current, action.factor, point, size)
          : panBy(current, action.dx, action.dy),
      );
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
    };
  }, []);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const report = () => {
      latest.current.onResize?.({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };
    report(); // наблюдатель в фоновой вкладке молчит до первой отрисовки
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Левая или средняя кнопка мыши; касание и перо приходят как левая.
    if (event.button !== 0 && event.button !== 1) return;
    if (event.button === 1) event.preventDefault(); // без автопрокрутки браузера
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен — сдвиг продолжится без захвата.
    }
    pressed.current.set(
      event.pointerId,
      locate(event.currentTarget, event).point,
    );
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const { point, size } = locate(event.currentTarget, event);
    const fingers = pressed.current;
    if (fingers.size <= 1) onPointer(screenToBoard(point, camera, size));

    const previous = fingers.get(event.pointerId);
    if (previous === undefined) return;
    const before = firstPair(fingers);
    fingers.set(event.pointerId, point);
    const after = firstPair(fingers);
    if (before !== null && after !== null) {
      onMove((current) => pinch(current, before, after, size));
    } else {
      onMove((current) =>
        panBy(current, point.x - previous.x, point.y - previous.y),
      );
    }
  }

  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    // Оставшийся палец продолжает сдвиг со своего места, без скачка вида.
    pressed.current.delete(event.pointerId);
  }

  const step = DOT_STEP * camera.zoom;
  return (
    <div
      ref={ref}
      className="board-canvas"
      data-testid="board-canvas"
      style={{
        backgroundSize: `${String(step)}px ${String(step)}px`,
        backgroundPosition: `calc(50% - ${String(camera.x * camera.zoom)}px) calc(50% - ${String(camera.y * camera.zoom)}px)`,
      }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") onPointer(null);
      }}
    >
      <div
        className="board-world"
        style={{
          transform: `scale(${String(camera.zoom)}) translate(${String(-camera.x)}px, ${String(-camera.y)}px)`,
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** Два первых зажатых указателя — пальцы щипка; `null`, если зажат один. */
function firstPair(pressed: Map<number, Point>): [Point, Point] | null {
  const [a, b] = pressed.values();
  return a !== undefined && b !== undefined ? [a, b] : null;
}

/** Точка события относительно области холста и размер области. */
function locate(
  element: HTMLElement,
  event: { clientX: number; clientY: number },
): { point: Point; size: Size } {
  const rect = element.getBoundingClientRect();
  return {
    point: { x: event.clientX - rect.left, y: event.clientY - rect.top },
    size: { width: rect.width, height: rect.height },
  };
}
