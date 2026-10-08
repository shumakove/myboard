import type { ComponentPropsWithRef } from "react";
import { classNames } from "./classNames";

/** UI-01, UI-03: плавающая панель — белая, скруглённая, с мягкой тенью. */
export function FloatingPanel({
  className,
  ...props
}: ComponentPropsWithRef<"div">) {
  return <div className={classNames("ui-panel", className)} {...props} />;
}
