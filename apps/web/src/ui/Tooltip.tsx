import { useId, useState, type ReactElement, type ReactNode } from "react";

/**
 * UI-03: подсказка у элемента — появляется при наведении и фокусе с клавиатуры,
 * пропадает по Escape. Текст связан с элементом через `aria-describedby`.
 */
export function Tooltip({
  text,
  children,
}: {
  text: ReactNode;
  /** Получает id подсказки — для `aria-describedby` элемента. */
  children: (describedBy: string | undefined) => ReactElement;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="ui-tooltip-anchor"
      onPointerEnter={() => {
        setOpen(true);
      }}
      onPointerLeave={() => {
        setOpen(false);
      }}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {children(open ? id : undefined)}
      {open && (
        <span role="tooltip" id={id} className="ui-tooltip">
          {text}
        </span>
      )}
    </span>
  );
}
