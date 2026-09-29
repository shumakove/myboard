import type { Board, Folder } from "./libraryApi";

/** Узел бокового списка: папка, её подпапки по `position` и доски по названию. */
export interface FolderNode {
  folder: Folder;
  children: FolderNode[];
  boards: Board[];
}

const byPosition = (a: Folder, b: Folder) =>
  a.position - b.position || a.created_at.localeCompare(b.created_at);

const byTitle = (a: Board, b: Board) =>
  a.title.toLowerCase().localeCompare(b.title.toLowerCase());

/** Папки родителя `parentId` в порядке показа. */
export function siblingsOf(
  folders: Folder[],
  parentId: string | null,
): Folder[] {
  return folders.filter((f) => f.parent_id === parentId).sort(byPosition);
}

/** BRD-09: дерево папок верхнего уровня с вложенными папками и досками. */
export function buildTree(folders: Folder[], boards: Board[]): FolderNode[] {
  const build = (parentId: string | null): FolderNode[] =>
    siblingsOf(folders, parentId).map((folder) => ({
      folder,
      children: build(folder.id),
      boards: boards.filter((b) => b.folder_id === folder.id).sort(byTitle),
    }));
  return build(null);
}

/** Цепочка папок от верхнего уровня до `folderId` включительно. */
export function pathTo(folders: Folder[], folderId: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: Folder[] = [];
  let current = byId.get(folderId);
  while (current && !path.includes(current)) {
    path.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return path;
}

/** Лежит ли `folderId` внутри `ancestorId` или совпадает с ней. */
export function isWithin(
  folders: Folder[],
  folderId: string | null,
  ancestorId: string,
): boolean {
  if (folderId === null) return false;
  return pathTo(folders, folderId).some((f) => f.id === ancestorId);
}

export type DropZone = "before" | "inside" | "after";

/** Что перетаскивается: доска (с текущей папкой) или папка. */
export type DragItem =
  | { kind: "board"; id: string; folderId: string | null }
  | { kind: "folder"; id: string };

/** Куда отпущено: на строку папки (с зоной) или на верхний уровень списка папок. */
export type DropTarget =
  { kind: "folder"; id: string; zone: DropZone } | { kind: "root" };

export type Move =
  | { kind: "board"; id: string; folderId: string | null }
  | { kind: "folder"; id: string; parentId: string | null; position: number };

/** Зона строки папки под указателем: края — вставить рядом, середина — внутрь. */
export function zoneAt(
  pointerY: number,
  rect: { top: number; height: number },
  item: DragItem,
): DropZone {
  if (item.kind === "board") return "inside";
  const offset = (pointerY - rect.top) / rect.height;
  if (offset < 0.25) return "before";
  if (offset > 0.75) return "after";
  return "inside";
}

/**
 * BRD-10: во что превращается перетаскивание. `null` — ничего не меняется,
 * `"cycle"` — папку пытаются вложить в неё саму или в её дочернюю.
 */
export function planMove(
  folders: Folder[],
  item: DragItem,
  target: DropTarget,
): Move | "cycle" | null {
  if (item.kind === "board") {
    const folderId = target.kind === "root" ? null : target.id;
    return folderId === item.folderId
      ? null
      : { kind: "board", id: item.id, folderId };
  }
  const place = (parentId: string | null, index: number): Move | "cycle" =>
    isWithin(folders, parentId, item.id)
      ? "cycle"
      : { kind: "folder", id: item.id, parentId, position: index };
  const others = (parentId: string | null) =>
    siblingsOf(folders, parentId).filter((f) => f.id !== item.id);

  if (target.kind === "root") return place(null, others(null).length);
  if (target.id === item.id) return target.zone === "inside" ? "cycle" : null;
  if (target.zone === "inside") {
    return place(target.id, others(target.id).length);
  }
  const over = folders.find((f) => f.id === target.id);
  if (!over) return null;
  const siblings = others(over.parent_id);
  const index = siblings.findIndex((f) => f.id === over.id);
  return place(over.parent_id, target.zone === "before" ? index : index + 1);
}
