import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
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
  style,
  label = "Object text",
  className = "",
  caretAtEnd = false,
  onKeyDown,
  onEdit,
  onDone,
}: {
  object: SceneObject;
  text: Y.Text;
  /** Название поля для чтения с экрана (подпись линии — Line label). */
  label?: string;
  /** Положение и вид поля; по умолчанию — рамка объекта (у фигуры — область текста). */
  style?: CSSProperties;
  /** Дополнительный класс поля (ячейка таблицы). */
  className?: string;
  /** Курсор — в конец текста, а не выделение всего текста (ячейка таблицы, TBL-04). */
  caretAtEnd?: boolean;
  /** Клавиши поля до обработки Escape; `preventDefault` отменяет поведение поля. */
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Отметка «изменил» (CVS-22) — в той же транзакции, что и правка текста. */
  onEdit?: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = useRef(text.toJSON());
  // Способ выделения важен только при открытии поля.
  const atEnd = useRef(caretAtEnd);

  useEffect(() => {
    const field = ref.current;
    if (field === null) return;
    field.value = shown.current;
    field.focus();
    if (atEnd.current) {
      field.setSelectionRange(field.value.length, field.value.length);
    } else {
      field.select();
    }
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
      className={`scene-object scene-${object.type} scene-editor ${className}`.trim()}
      aria-label={label}
      data-canvas-ignore=""
      style={style ?? objectStyle(object)}
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
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Escape") onDone();
      }}
      onBlur={onDone}
    />
  );
}
