import type { ComponentPropsWithRef, ReactNode } from "react";
import { classNames } from "./classNames";

/** UI-03: поле ввода без подписи (имя — `aria-label` или внешний `<label>`). */
export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  return <input className={classNames("ui-input", className)} {...props} />;
}

/** UI-03: поле ввода с подписью; подпись — доступное имя поля. */
export function TextField({
  label,
  className,
  ...props
}: ComponentPropsWithRef<"input"> & { label: ReactNode }) {
  return (
    <label className={classNames("ui-field", className)}>
      {label}
      <Input {...props} />
    </label>
  );
}

/** UI-03: выпадающий список без подписи. */
export function Select({
  className,
  ...props
}: ComponentPropsWithRef<"select">) {
  return <select className={classNames("ui-select", className)} {...props} />;
}

/** UI-03: выпадающий список с подписью в одной строке. */
export function SelectField({
  label,
  className,
  ...props
}: ComponentPropsWithRef<"select"> & { label: ReactNode }) {
  return (
    <label className={classNames("ui-field ui-field--inline", className)}>
      {label}
      <Select {...props} />
    </label>
  );
}
