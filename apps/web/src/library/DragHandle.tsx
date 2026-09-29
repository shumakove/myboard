import { useDraggable } from "@dnd-kit/core";
import type { DragItem } from "./folderTree";

/** Данные перетаскиваемого элемента для LibraryDnd. */
export interface DragData {
  item: DragItem;
  title: string;
}

/**
 * BRD-10: ручка перетаскивания доски или папки. `dragId` уникален на странице:
 * одна доска может быть и в полном списке, и в боковом.
 */
export function DragHandle({
  dragId,
  item,
  title,
}: {
  dragId: string;
  item: DragItem;
  title: string;
}) {
  const data: DragData = { item, title };
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      className={isDragging ? "library-drag is-dragging" : "library-drag"}
      {...attributes}
      {...listeners}
      aria-label={`Drag ${title}`}
    >
      ⠿
    </button>
  );
}
