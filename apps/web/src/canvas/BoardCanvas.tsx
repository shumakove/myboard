import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { CameraView, Point } from "../realtime/messages";
import { panBy, screenToBoard, zoomAt, type Size } from "./camera";
import "./canvas.css";

/** Шаг точечного фона, px при масштабе 1: по нему видно движение вида. */
const DOT_STEP = 32;

export type CameraUpdate = (camera: CameraView) => CameraView;

/**
 * Область холста с камерой: перетаскивание сдвигает вид, колесо масштабирует.
 * Сообщает положение указателя в координатах доски (курсор для других — COL-02).
 * Дочерние элементы рисуются в координатах доски. Полная камера — T5.1.
 */
export function BoardCanvas({
  camera,
  onMove,
  onPointer,
  children,
}: {
  camera: CameraView;
  /** Своё перемещение вида (сдвиг, масштаб). */
  onMove: (update: CameraUpdate) => void;
  /** Указатель над холстом в координатах доски; `null` — ушёл с холста. */
  onPointer: (point: Point | null) => void;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });

  // React вешает wheel пассивным — без preventDefault колесо прокручивало бы страницу.
  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    function wheel(event: WheelEvent) {
      event.preventDefault();
      if (element === null) return;
      const { point, size } = locate(element, event);
      const factor = Math.exp(-event.deltaY * 0.002);
      onMoveRef.current((current) => zoomAt(current, factor, point, size));
    }
    element.addEventListener("wheel", wheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", wheel);
    };
  }, []);

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен — сдвиг продолжится без захвата.
    }
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const { point, size } = locate(event.currentTarget, event);
    onPointer(screenToBoard(point, camera, size));
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    const dx = event.clientX - active.x;
    const dy = event.clientY - active.y;
    drag.current = { ...active, x: event.clientX, y: event.clientY };
    onMove((current) => panBy(current, dx, dy));
  }

  function pointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
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
