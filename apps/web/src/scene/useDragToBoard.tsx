import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Point } from "../realtime/messages";

/** Сдвиг указателя, после которого нажатие на кнопку — уже перетаскивание, px. */
const DRAG_THRESHOLD = 6;

interface Ghost {
  label: string;
  at: Point;
}

type ButtonPointer = ReactPointerEvent<HTMLButtonElement>;

/**
 * Кнопку панели тянут на холст (CVS-09 инструмент, STK-01 образец цвета): пока тянут —
 * подпись под указателем, при отпускании — `onDrop(value, точка окна)`. Щелчок, который
 * приходит за отпусканием после перетаскивания, — не выбор: `consumeClick` вернёт `true`.
 */
export function useDragToBoard<T>(onDrop: (value: T, client: Point) => void) {
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const drag = useRef<{
    pointerId: number;
    start: Point;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  function handlers(value: T, label: string) {
    return {
      onPointerDown(event: ButtonPointer) {
        if (event.button !== 0) return;
        suppressClick.current = false;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Без захвата перетаскивание закончится над кнопкой.
        }
        drag.current = {
          pointerId: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          dragging: false,
        };
      },
      onPointerMove(event: ButtonPointer) {
        const current = drag.current;
        if (current?.pointerId !== event.pointerId) return;
        const at = { x: event.clientX, y: event.clientY };
        if (
          !current.dragging &&
          Math.hypot(at.x - current.start.x, at.y - current.start.y) >
            DRAG_THRESHOLD
        ) {
          current.dragging = true;
        }
        if (current.dragging) setGhost({ label, at });
      },
      onPointerUp(event: ButtonPointer) {
        const current = drag.current;
        drag.current = null;
        setGhost(null);
        if (current?.pointerId !== event.pointerId || !current.dragging) {
          return;
        }
        suppressClick.current = true;
        onDrop(value, { x: event.clientX, y: event.clientY });
      },
      onPointerCancel() {
        drag.current = null;
        setGhost(null);
      },
    };
  }

  function consumeClick(): boolean {
    const suppressed = suppressClick.current;
    suppressClick.current = false;
    return suppressed;
  }

  const ghostView = ghost && (
    <div
      className="tool-ghost"
      aria-hidden="true"
      style={{ left: ghost.at.x, top: ghost.at.y }}
    >
      {ghost.label}
    </div>
  );

  return { handlers, consumeClick, ghost: ghostView };
}
