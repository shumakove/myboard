import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Rect } from "../canvas/camera";
import type { Point } from "../realtime/messages";
import { placeMenu } from "./geometry";

export interface MenuItem {
  label: string;
  action: () => void;
}

/** Видимая в окне часть элемента — в его собственных координатах. */
function visiblePart(element: Element): Rect {
  const box = element.getBoundingClientRect();
  const x = Math.max(0, -box.left);
  const y = Math.max(0, -box.top);
  return {
    x,
    y,
    width: Math.min(box.width, window.innerWidth - box.left) - x,
    height: Math.min(box.height, window.innerHeight - box.top) - y,
  };
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
  const [position, setPosition] = useState(at);
  // До отрисовки: меню не мелькает за краем окна.
  useLayoutEffect(() => {
    const menu = ref.current;
    const area = menu?.offsetParent;
    if (!menu || !area) return;
    setPosition(
      placeMenu(
        at,
        { width: menu.offsetWidth, height: menu.offsetHeight },
        visiblePart(area),
      ),
    );
  }, [at]);
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
      style={{ left: position.x, top: position.y }}
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
