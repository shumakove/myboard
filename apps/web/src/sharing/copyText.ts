/**
 * Копирует текст в буфер обмена (SHR-01). Возвращает, удалось ли.
 *
 * Clipboard API есть только в защищённом контексте (https), а в локальной сети доска
 * открыта по http — тогда копируется выделение поля с текстом (`execCommand`).
 */
export async function copyText(
  text: string,
  field: HTMLInputElement | null,
): Promise<boolean> {
  if (window.isSecureContext && typeof navigator.clipboard !== "undefined") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Нет разрешения — пробуем через выделение.
    }
  }
  if (!field) return false;
  field.focus();
  field.select();
  try {
    // Единственный способ скопировать без защищённого контекста; API устарел, но
    // поддерживается всеми браузерами (docs/decisions.md, T3.1).
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    return document.execCommand("copy");
  } catch {
    return false;
  }
}
