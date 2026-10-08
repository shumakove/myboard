import type { ComponentPropsWithRef, ReactNode } from "react";
import { classNames } from "./classNames";

/** UI-03: переключатель «вкл/выкл» — флажок с ролью switch и подписью. */
export function Switch({
  label,
  className,
  ...props
}: Omit<ComponentPropsWithRef<"input">, "type"> & { label: ReactNode }) {
  return (
    <label className={classNames("ui-switch", className)}>
      <input
        type="checkbox"
        role="switch"
        className="ui-switch-input"
        {...props}
      />
      <span className="ui-switch-track" aria-hidden="true" />
      {label}
    </label>
  );
}
