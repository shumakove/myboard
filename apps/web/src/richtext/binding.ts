import type * as Y from "yjs";
import type { DeltaOp } from "./delta";
import { INLINE_FORMATS, type Quill } from "./quill";

/** Атрибуты, которые чужая вставка сбрасывает явно, если у неё их нет. */
const CLEARED: Record<string, null> = Object.fromEntries(
  INLINE_FORMATS.map((name) => [name, null]),
);

/**
 * COL-01: редактор Quill и `Y.Text` объекта правятся вместе. Свои правки поля уходят
 * в `Y.Text` одной транзакцией (origin `null` — их видит отмена доски, CVS-07), вместе
 * с отметкой «изменил» (`onEdit`, CVS-22). Чужие правки того же текста применяются
 * к полю сразу, курсор Quill сдвигает сам. Возвращает отписку.
 */
export function bindQuill(
  quill: Quill,
  text: Y.Text,
  onEdit?: () => void,
): () => void {
  let fromQuill = false;

  const toQuill = (event: Y.YTextEvent) => {
    if (fromQuill) return;
    // Вставка без атрибута не должна стать, например, жирной от соседнего текста.
    const delta = (event.delta as DeltaOp[]).map((op) =>
      op.insert === undefined
        ? op
        : { ...op, attributes: { ...CLEARED, ...op.attributes } },
    );
    quill.updateContents(delta as never, "api");
  };

  const toText = (delta: { ops: DeltaOp[] }, _old: unknown, source: string) => {
    if (source !== "user") return;
    const write = () => {
      text.applyDelta(delta.ops);
      onEdit?.();
    };
    // Наблюдатели `Y.Text` вызываются в конце транзакции — флаг держится до него.
    fromQuill = true;
    try {
      if (text.doc === null) write();
      else text.doc.transact(write);
    } finally {
      fromQuill = false;
    }
  };

  quill.setContents(text.toDelta() as never, "silent");
  quill.history.clear();
  text.observe(toQuill);
  quill.on("text-change", toText);
  return () => {
    text.unobserve(toQuill);
    quill.off("text-change", toText);
  };
}
