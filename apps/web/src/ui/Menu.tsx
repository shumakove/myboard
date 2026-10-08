import type { ComponentPropsWithRef } from "react";
import { classNames } from "./classNames";

/** UI-03: меню — выпадающее или контекстное. Положение задаёт вызывающий. */
export function Menu({
  label,
  className,
  ...props
}: ComponentPropsWithRef<"div"> & { label: string }) {
  return (
    <div
      role="menu"
      aria-label={label}
      className={classNames("ui-menu", className)}
      {...props}
    />
  );
}

/** UI-03: пункт меню. */
export function MenuItem({
  className,
  type = "button",
  ...props
}: ComponentPropsWithRef<"button">) {
  return (
    <button
      type={type}
      role="menuitem"
      className={classNames("ui-menu-item", className)}
      {...props}
    />
  );
}
