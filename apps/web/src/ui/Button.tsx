import type { ComponentPropsWithRef } from "react";
import { classNames, type ButtonVariant } from "./classNames";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
};

/** UI-03: кнопка — основная, второстепенная (по умолчанию), опасная или тихая. */
export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={classNames("ui-button", `ui-button--${variant}`, className)}
      {...props}
    />
  );
}

export type IconButtonProps = ComponentPropsWithRef<"button"> & {
  /** Доступное имя: у кнопки-значка нет текста. */
  label: string;
};

/** UI-03: кнопка-значок — квадратная, имя задаётся `label`. */
export function IconButton({
  label,
  className,
  type = "button",
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={classNames("ui-icon-button", className)}
      {...props}
    />
  );
}
