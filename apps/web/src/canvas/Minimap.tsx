import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { CameraView, Point } from "../realtime/messages";
import { viewRect, type Rect, type Size } from "./camera";
import {
  fitWorld,
  minimapWorld,
  toBoard,
  toMinimap,
  type MinimapFit,
} from "./minimapFit";

/** Размер миникарты, px. */
const MINIMAP_SIZE: Size = { width: 160, height: 110 };

/**
 * CVS-04: миникарта — объекты доски и рамка видимой области. Щелчок или перетаскивание
 * по ней ставит центр вида в выбранную точку доски. Пока палец или кнопка зажаты,
 * масштаб миникарты не меняется, чтобы точка под указателем не уезжала.
 */
export function Minimap({
  camera,
  viewport,
  rects,
  onNavigate,
}: {
  camera: CameraView;
  /** Размер области холста. */
  viewport: Size;
  rects: readonly Rect[];
  /** Новый центр вида в координатах доски. */
  onNavigate: (point: Point) => void;
}) {
  const view = viewRect(camera, viewport);
  const [frozen, setFrozen] = useState<MinimapFit | null>(null);
  const pointer = useRef<number | null>(null);
  const fit = frozen ?? fitWorld(minimapWorld(rects, view), MINIMAP_SIZE);

  function navigate(
    event: ReactPointerEvent<SVGSVGElement>,
    using: MinimapFit,
  ) {
    const box = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - box.left, y: event.clientY - box.top };
    onNavigate(toBoard(point, using));
  }

  function pointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    event.stopPropagation();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Указатель уже отпущен — переход всё равно выполнится.
    }
    pointer.current = event.pointerId;
    setFrozen(fit);
    navigate(event, fit);
  }

  function pointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (pointer.current !== event.pointerId || frozen === null) return;
    navigate(event, frozen);
  }

  function pointerEnd(event: ReactPointerEvent<SVGSVGElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    setFrozen(null);
  }

  const frame = toMinimap(view, fit);
  return (
    <svg
      className="minimap"
      role="img"
      aria-label="Minimap"
      data-testid="minimap"
      width={MINIMAP_SIZE.width}
      height={MINIMAP_SIZE.height}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd}
    >
      {rects.map((rect, index) => {
        const shown = toMinimap(rect, fit);
        return (
          <rect
            key={index}
            className="minimap-object"
            x={shown.x}
            y={shown.y}
            // Мелкий объект на большой доске всё равно виден точкой.
            width={Math.max(shown.width, 2)}
            height={Math.max(shown.height, 2)}
          />
        );
      })}
      <rect
        className="minimap-view"
        data-testid="minimap-view"
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
      />
    </svg>
  );
}
