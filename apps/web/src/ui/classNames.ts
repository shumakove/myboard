/** Склеивает классы, пропуская пустые. */
export function classNames(
  ...names: (string | false | null | undefined)[]
): string {
  return names.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

/** Классы кнопки для ссылки, которая выглядит как кнопка (роль остаётся link). */
export function buttonClass(variant: ButtonVariant = "secondary"): string {
  return `ui-button ui-button--${variant}`;
}
