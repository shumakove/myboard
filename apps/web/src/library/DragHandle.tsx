import { useDraggable } from "@dnd-kit/core";
import type { DragItem } from "./folderTree";
import { IconButton } from "../ui";

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
    <IconButton
      ref={setNodeRef}
      className={isDragging ? "library-drag is-dragging" : "library-drag"}
      {...attributes}
      {...listeners}
      label={`Drag ${title}`}
    >
      ⠿
    </IconButton>
  );
}
