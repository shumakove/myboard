import { useEffect, useRef } from "react";
import type { Point } from "../realtime/messages";

export interface MenuItem {
  label: string;
  action: () => void;
}

/**
 * CVS-23: контекстное меню объекта или пустого места холста. Закрывается после выбора
 * пункта, по Escape и по нажатию вне меню.
 */
export function ContextMenu({
  label,
  at,
  items,
  onClose,
}: {
  label: string;
  /** Точка в области холста. */
  at: Point;
  items: readonly MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
    function outside(event: PointerEvent) {
      if (
        !(event.target instanceof Node) ||
        !ref.current?.contains(event.target)
      ) {
        onClose();
      }
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label={label}
      style={{ left: at.x, top: at.y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          onClick={() => {
            onClose();
            item.action();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
