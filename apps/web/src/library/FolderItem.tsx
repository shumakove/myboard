import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { DragHandle } from "./DragHandle";
import { useFolderDrop } from "./dropTargets";
import { FavoriteButton } from "./FavoriteButton";
import type { FolderNode } from "./folderTree";
import type { Folder } from "./libraryApi";
import { NewFolderForm } from "./NewFolderForm";
import { IconButton } from "../ui";

export interface FolderTreeActions {
  expanded: Set<string>;
  /** Папка, найденная поиском или выбранная в избранном: подсвечивается и получает фокус. */
  highlightedId: string | null;
  toggle: (id: string) => void;
  onCreated: (folder: Folder) => void;
  onChange: () => void;
  onError: (message: string) => void;
}

/** Папка бокового списка: свернуть/развернуть (BRD-11), подпапка (BRD-09), перетаскивание (BRD-10). */
export function FolderItem({
  node,
  actions,
}: {
  node: FolderNode;
  actions: FolderTreeActions;
}) {
  const { folder, children, boards } = node;
  const open = actions.expanded.has(folder.id);
  const highlighted = actions.highlightedId === folder.id;
  const [adding, setAdding] = useState(false);
  const { setNodeRef, zone } = useFolderDrop(folder.id);
  const nameRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!highlighted) return;
    nameRef.current?.scrollIntoView({ block: "nearest" });
    nameRef.current?.focus();
  }, [highlighted]);

  const rowClass = ["library-folder-row", zone && `is-drop-${zone}`]
    .filter(Boolean)
    .join(" ");

  return (
    <li
      aria-label={folder.title}
      className={
        highlighted ? "library-folder is-highlighted" : "library-folder"
      }
    >
      <div ref={setNodeRef} className={rowClass}>
        <DragHandle
          dragId={`tree-folder:${folder.id}`}
          item={{ kind: "folder", id: folder.id }}
          title={folder.title}
        />
        <button
          ref={nameRef}
          type="button"
          className="library-folder-name"
          aria-expanded={open}
          onClick={() => {
            actions.toggle(folder.id);
          }}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span> {folder.title}
        </button>
        <FavoriteButton
          kind="folder"
          id={folder.id}
          favorite={folder.favorite}
          onChange={actions.onChange}
          onError={actions.onError}
        />
        <IconButton
          label={`New folder in ${folder.title}`}
          title="New folder inside"
          onClick={() => {
            setAdding(true);
          }}
        >
          +
        </IconButton>
      </div>
      {adding && (
        <NewFolderForm
          parentId={folder.id}
          onCreated={(created) => {
            setAdding(false);
            actions.onCreated(created);
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      )}
      {open && children.length === 0 && boards.length === 0 && (
        <p className="library-meta library-tree-empty">Empty folder</p>
      )}
      {open && (children.length > 0 || boards.length > 0) && (
        <ul className="library-tree" aria-label={`Contents of ${folder.title}`}>
          {children.map((child) => (
            <FolderItem key={child.folder.id} node={child} actions={actions} />
          ))}
          {boards.map((board) => (
            <li
              key={board.id}
              aria-label={board.title}
              className="library-tree-board"
            >
              <DragHandle
                dragId={`tree-board:${board.id}`}
                item={{
                  kind: "board",
                  id: board.id,
                  folderId: board.folder_id,
                }}
                title={board.title}
              />
              <Link href={`/boards/${board.id}`}>{board.title}</Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
