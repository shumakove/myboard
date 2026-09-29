import {
  pointerWithin,
  useDroppable,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { createContext, useContext } from "react";
import type { DragData } from "./DragHandle";
import {
  zoneAt,
  type DropTarget,
  type DropZone,
  type Move,
} from "./folderTree";
import { moveBoard, moveFolder } from "./libraryApi";

export const ROOT_DROP_ID = "root";

type DropData = { kind: "folder"; id: string } | { kind: "root" };

export interface Indicator {
  overId: string;
  zone: DropZone | null;
}

export const IndicatorContext = createContext<Indicator | null>(null);

/** Строка папки как цель перетаскивания; `zone` — куда встанет элемент, если отпустить. */
export function useFolderDrop(folderId: string) {
  const id = `folder:${folderId}`;
  const data: DropData = { kind: "folder", id: folderId };
  const { setNodeRef } = useDroppable({ id, data });
  const indicator = useContext(IndicatorContext);
  return {
    setNodeRef,
    zone: indicator?.overId === id ? indicator.zone : null,
  };
}

/** Верхний уровень списка папок как цель перетаскивания. */
export function useRootDrop() {
  const data: DropData = { kind: "root" };
  const { setNodeRef } = useDroppable({ id: ROOT_DROP_ID, data });
  const indicator = useContext(IndicatorContext);
  return { setNodeRef, isOver: indicator?.overId === ROOT_DROP_ID };
}

// Строки папок лежат внутри области верхнего уровня: попадание в строку важнее.
export const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const folderHits = hits.filter((hit) => hit.id !== ROOT_DROP_ID);
  return folderHits.length ? folderHits : hits;
};

function pointerY(event: Event): number {
  return event instanceof MouseEvent ? event.clientY : 0;
}

export function targetOf(
  event: DragMoveEvent | DragEndEvent,
): DropTarget | null {
  const drop = event.over?.data.current as DropData | undefined;
  const drag = event.active.data.current as DragData | undefined;
  if (!event.over || !drop || !drag) return null;
  if (drop.kind === "root") return { kind: "root" };
  const y = pointerY(event.activatorEvent) + event.delta.y;
  return {
    kind: "folder",
    id: drop.id,
    zone: zoneAt(y, event.over.rect, drag.item),
  };
}

/** Выполняет перенос на сервере (BRD-10). */
export async function executeMove(move: Move): Promise<void> {
  if (move.kind === "board") await moveBoard(move.id, move.folderId);
  else await moveFolder(move.id, move.parentId, move.position);
}
