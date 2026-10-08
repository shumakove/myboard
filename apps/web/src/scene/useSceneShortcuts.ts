import { useEffect, useRef } from "react";
import { isTypingTarget } from "../canvas/keyboard";
import { CLIPBOARD_MIME, clipText, loadClip, parseClip } from "./clipboard";
import type { SceneCommands } from "./useSceneCommands";

/** Сочетание с Ctrl (⌘ на Mac) без Alt: команды буфера и дублирования. */
function commandKey(event: KeyboardEvent): string | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  return event.key.toLowerCase();
}

/**
 * Пункты Copy/Cut меню: копия в браузер и, где можно, в системный буфер. Без HTTPS
 * Clipboard API нет; команда copy вызывает событие copy, которое пишет буфер.
 */
export function copyToClipboard(commands: SceneCommands, cut: boolean): void {
  if (commands.copy() === null) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- единственный способ без HTTPS
    document.execCommand("copy");
  } catch {
    // Копия осталась в браузере — её вставят пункт Paste и Ctrl/⌘+V.
  }
  if (cut) commands.remove?.();
}

/**
 * Клавиши и события буфера обмена сцены:
 * - CVS-21: Delete/Backspace удаляют выделенное; Escape снимает выделение;
 * - CVS-20: Ctrl/⌘+C, X, V — копирование, вырезание, вставка через системный буфер
 *   (объекты — своим типом данных, текст — простым текстом), Ctrl/⌘+D — дубликат.
 *   Если браузер не прислал событие буфера (сочетание из средства автоматизации),
 *   работает копия в браузере;
 * - CVS-09: простой текст из буфера становится текстовым объектом.
 */
export function useSceneShortcuts(
  commands: SceneCommands,
  onEscape: () => void,
): void {
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const clearFallback = () => {
      if (fallback.current !== null) clearTimeout(fallback.current);
      fallback.current = null;
    };
    const hasSelection = commands.units.length > 0;

    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const command = commandKey(event);
      if (command === "d") {
        event.preventDefault(); // не закладка браузера
        commands.duplicate?.();
      } else if (command === "c" || command === "x" || command === "v") {
        // Событие буфера приходит сразу за клавишей; таймер сработает, только если его нет.
        clearFallback();
        fallback.current = setTimeout(() => {
          fallback.current = null;
          if (command === "v") {
            const clip = loadClip();
            if (clip !== null) commands.paste(clip);
          } else if (hasSelection) {
            if (command === "x") commands.cut?.();
            else commands.copy();
          }
        }, 0);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (!hasSelection) return;
        event.preventDefault();
        commands.remove?.();
      } else if (event.key === "Escape") {
        onEscape();
      }
    }

    function copyOrCut(event: ClipboardEvent) {
      if (isTypingTarget(event.target) || !hasSelection) return;
      clearFallback();
      const cut = event.type === "cut";
      if (cut && commands.cut === null) return;
      const clip = cut ? (commands.cut?.() ?? null) : commands.copy();
      if (clip === null) return;
      event.preventDefault();
      event.clipboardData?.setData(CLIPBOARD_MIME, JSON.stringify(clip));
      event.clipboardData?.setData("text/plain", clipText(clip));
    }

    function paste(event: ClipboardEvent) {
      if (isTypingTarget(event.target)) return;
      clearFallback();
      const data = event.clipboardData;
      const clip = parseClip(data?.getData(CLIPBOARD_MIME));
      const text = data?.getData("text/plain").trim() ?? "";
      if (clip === null && !text) return;
      event.preventDefault();
      if (clip !== null) commands.paste(clip);
      else commands.pasteText(text);
    }

    window.addEventListener("keydown", keydown);
    window.addEventListener("copy", copyOrCut);
    window.addEventListener("cut", copyOrCut);
    window.addEventListener("paste", paste);
    return () => {
      window.removeEventListener("keydown", keydown);
      window.removeEventListener("copy", copyOrCut);
      window.removeEventListener("cut", copyOrCut);
      window.removeEventListener("paste", paste);
    };
  }, [commands, onEscape]);

  useEffect(
    () => () => {
      if (fallback.current !== null) clearTimeout(fallback.current);
    },
    [],
  );
}
