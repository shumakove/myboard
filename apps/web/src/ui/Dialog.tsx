import { useEffect, useId, type ReactNode } from "react";
import { classNames } from "./classNames";

/**
 * UI-03: модальный диалог поверх затемнения. Заголовок — доступное имя диалога;
 * Escape закрывает.
 */
export function Dialog({
  title,
  onClose,
  className,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="ui-backdrop">
      <div
        className={classNames("ui-dialog", className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
