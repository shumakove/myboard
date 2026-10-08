import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Point } from "../realtime/messages";
import type { ObjectType } from "./objectTypes";
import { TOOLS, type ToolId } from "./tools";

/** Сдвиг указателя, после которого нажатие на кнопку — уже перетаскивание, px. */
const DRAG_THRESHOLD = 6;

/**
 * Левая панель инструментов (CVS-09, CVS-10). Инструмент создания выбирается нажатием
 * (затем щелчок по холсту ставит объект) или перетаскивается с панели прямо на холст.
 */
export function ToolPanel({
  tool,
  onTool,
  onDrop,
  children,
}: {
  tool: ToolId;
  onTool: (tool: ToolId) => void;
  /** Кнопку инструмента отпустили над точкой экрана (координаты окна). */
  onDrop: (type: ObjectType, client: Point) => void;
  /** Действия доски после инструментов (в той же строке на телефоне). */
  children?: ReactNode;
}) {
  const [ghost, setGhost] = useState<{ label: string; at: Point } | null>(null);
  const drag = useRef<{
    pointerId: number;
    start: Point;
    dragging: boolean;
  } | null>(null);
  const suppressClick = useRef(false);

  function pointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
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
  }

  function pointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
    label: string,
  ) {
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
  }

  function pointerUp(
    event: ReactPointerEvent<HTMLButtonElement>,
    type: ObjectType,
  ) {
    const current = drag.current;
    drag.current = null;
    setGhost(null);
    if (current?.pointerId !== event.pointerId || !current.dragging) return;
    suppressClick.current = true; // за отпусканием придёт click — это не выбор инструмента
    onDrop(type, { x: event.clientX, y: event.clientY });
  }

  return (
    <div
      className="tool-panel"
      role="toolbar"
      aria-label="Tools"
      aria-orientation="vertical"
    >
      {TOOLS.map((item) => (
        <button
          key={item.id}
          type="button"
          className="tool-button"
          aria-pressed={tool === item.id}
          title={item.hint}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            onTool(item.id);
          }}
          {...(item.kind === "create" && {
            onPointerDown: pointerDown,
            onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
              pointerMove(event, item.label);
            },
            onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
              pointerUp(event, item.id);
            },
            onPointerCancel: () => {
              drag.current = null;
              setGhost(null);
            },
          })}
        >
          {item.label}
        </button>
      ))}
      {children}
      {ghost && (
        <div
          className="tool-ghost"
          aria-hidden="true"
          style={{ left: ghost.at.x, top: ghost.at.y }}
        >
          {ghost.label}
        </div>
      )}
    </div>
  );
}
