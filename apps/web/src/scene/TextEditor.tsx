import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { objectStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";
import { applyTextChange, shiftIndex } from "./textBinding";

/**
 * Редактирование текста объекта обычным полем ввода поверх объекта (ARCHITECTURE.md,
 * раздел 4). Правки уходят в `Y.Text` объекта, чужие правки того же текста появляются
 * в поле сразу, курсор остаётся на своём месте (COL-01).
 */
export function TextEditor({
  object,
  text,
  onEdit,
  onDone,
}: {
  object: SceneObject;
  text: Y.Text;
  /** Отметка «изменил» (CVS-22) — в той же транзакции, что и правка текста. */
  onEdit?: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = useRef(text.toJSON());

  useEffect(() => {
    const field = ref.current;
    if (field === null) return;
    field.value = shown.current;
    field.focus();
    field.select();
    const remote = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.local) return;
      const start = shiftIndex(field.selectionStart, event.delta);
      const end = shiftIndex(field.selectionEnd, event.delta);
      shown.current = text.toJSON();
      field.value = shown.current;
      field.setSelectionRange(start, end);
    };
    text.observe(remote);
    return () => {
      text.unobserve(remote);
    };
  }, [text]);

  return (
    <textarea
      ref={ref}
      className={`scene-object scene-${object.type} scene-editor`}
      aria-label="Object text"
      data-canvas-ignore=""
      style={objectStyle(object)}
      onInput={(event) => {
        const value = event.currentTarget.value;
        const write = () => {
          applyTextChange(text, shown.current, value);
          onEdit?.();
        };
        if (text.doc === null) write();
        else text.doc.transact(write);
        shown.current = value;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onDone();
      }}
      onBlur={onDone}
    />
  );
}
