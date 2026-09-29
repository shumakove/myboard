import { useState } from "react";
import { Link } from "wouter";
import { useRootDrop } from "./dropTargets";
import { FavoriteButton } from "./FavoriteButton";
import { FolderItem, type FolderTreeActions } from "./FolderItem";
import { buildTree } from "./folderTree";
import { NewFolderForm } from "./NewFolderForm";
import type { LibraryTree } from "./useLibraryTree";

/** BRD-07: избранные папки и доски; папка по нажатию раскрывается в дереве. */
function Favorites({
  tree,
  actions,
  onReveal,
}: {
  tree: LibraryTree;
  actions: FolderTreeActions;
  onReveal: (folderId: string) => void;
}) {
  const folders = tree.folders.filter((f) => f.favorite);
  const boards = tree.boards.filter((b) => b.favorite);
  if (folders.length === 0 && boards.length === 0) return null;
  return (
    <section aria-labelledby="favorites-title">
      <h2 id="favorites-title">Favorites</h2>
      <ul className="library-tree" aria-label="Favorites">
        {folders.map((folder) => (
          <li
            key={folder.id}
            aria-label={folder.title}
            className="library-tree-board"
          >
            <button
              type="button"
              className="library-link-button"
              onClick={() => {
                onReveal(folder.id);
              }}
            >
              {folder.title}
            </button>
            <FavoriteButton
              kind="folder"
              id={folder.id}
              favorite
              onChange={actions.onChange}
              onError={actions.onError}
            />
          </li>
        ))}
        {boards.map((board) => (
          <li
            key={board.id}
            aria-label={board.title}
            className="library-tree-board"
          >
            <Link href={`/boards/${board.id}`}>{board.title}</Link>
            <FavoriteButton
              kind="board"
              id={board.id}
              favorite
              onChange={actions.onChange}
              onError={actions.onError}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Боковой список: избранное (BRD-07) и дерево папок (BRD-09…BRD-11). Отпущенный на
 * свободное место раздела элемент уходит на верхний уровень (BRD-10).
 */
export function FolderSidebar({
  tree,
  error,
  actions,
  onReveal,
}: {
  tree: LibraryTree | null;
  error: string | null;
  actions: FolderTreeActions;
  onReveal: (folderId: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const { setNodeRef, isOver } = useRootDrop();
  const roots = tree ? buildTree(tree.folders, tree.boards) : [];

  return (
    <aside className="library-sidebar" aria-label="Folders and favorites">
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
      {tree && <Favorites tree={tree} actions={actions} onReveal={onReveal} />}
      <section
        ref={setNodeRef}
        aria-labelledby="folders-title"
        className={isOver ? "library-folders is-drop-root" : "library-folders"}
      >
        <div className="library-folders-header">
          <h2 id="folders-title">Folders</h2>
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
          >
            New folder
          </button>
        </div>
        {adding && (
          <NewFolderForm
            parentId={null}
            onCreated={(folder) => {
              setAdding(false);
              actions.onCreated(folder);
            }}
            onCancel={() => {
              setAdding(false);
            }}
          />
        )}
        {tree === null && !error && <p>Loading…</p>}
        {tree && roots.length === 0 && (
          <p className="library-meta">No folders yet.</p>
        )}
        {roots.length > 0 && (
          <ul className="library-tree" aria-label="Folders">
            {roots.map((node) => (
              <FolderItem key={node.folder.id} node={node} actions={actions} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
