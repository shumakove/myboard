import { useState } from "react";
import { useLocation } from "wouter";
import { signOut } from "../account/accountApi";
import { useCurrentAccount } from "../account/accountContext";
import { BoardList } from "../library/BoardList";
import { FolderSidebar } from "../library/FolderSidebar";
import type { FolderTreeActions } from "../library/FolderItem";
import { pathTo, type Move } from "../library/folderTree";
import { LibraryDnd } from "../library/LibraryDnd";
import type { Folder } from "../library/libraryApi";
import { NewBoardButton } from "../library/NewBoardButton";
import { RecentBoards } from "../library/RecentBoards";
import { useExpandedFolders } from "../library/useExpandedFolders";
import { useLibraryTree } from "../library/useLibraryTree";
import "../library/library.css";
import { Button, FloatingPanel } from "../ui";

/**
 * `/` — доски вошедшего пользователя (ACC-04): создание (BRD-01), недавние и полный
 * список (BRD-04) с поиском, сортировкой и фильтром (BRD-05, BRD-06); боковой список
 * с избранным и папками (BRD-07, BRD-09…BRD-11). Вход проверяет RequireAccount.
 */
export function BoardsPage() {
  const session = useCurrentAccount();
  const [, navigate] = useLocation();
  // Растёт после любой правки: списки и боковое дерево загружаются заново.
  const [version, setVersion] = useState(0);
  const { tree, error } = useLibraryTree(version);
  const { expanded, toggle, expand } = useExpandedFolders();
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const folders = tree?.folders ?? [];

  function changed() {
    setSidebarError(null);
    setVersion((v) => v + 1);
  }

  /** Раскрывает в дереве папки на пути к `folderId` (сама папка остаётся как была). */
  function showInside(all: Folder[], folderId: string, withSelf: boolean) {
    const path = pathTo(all, folderId).map((f) => f.id);
    expand(withSelf ? path : path.slice(0, -1));
  }

  function reveal(folderId: string) {
    showInside(folders, folderId, false);
    setHighlightedId(folderId);
  }

  function moved(move: Move) {
    // Куда перенесли — то и раскрываем, чтобы результат был виден.
    const parentId = move.kind === "board" ? move.folderId : move.parentId;
    if (parentId) showInside(folders, parentId, true);
    changed();
  }

  const actions: FolderTreeActions = {
    expanded,
    highlightedId,
    toggle,
    onCreated: (folder) => {
      if (folder.parent_id) showInside(folders, folder.parent_id, true);
      changed();
    },
    onChange: changed,
    onError: setSidebarError,
  };

  async function leave() {
    try {
      await signOut();
    } finally {
      navigate("/login", { replace: true });
    }
  }

  return (
    <main className="page library-page">
      <FloatingPanel className="page-header">
        <h1>Boards</h1>
        {session.status === "signedIn" && (
          <div className="page-user">
            <span>{session.name}</span>
            <Button onClick={() => void leave()}>Sign out</Button>
          </div>
        )}
      </FloatingPanel>
      {session.status === "loading" && <p>Loading…</p>}
      {session.status === "signedIn" && (
        <LibraryDnd folders={folders} onMoved={moved} onError={setSidebarError}>
          <div className="library-layout">
            <FolderSidebar
              tree={tree}
              error={sidebarError ?? error}
              actions={actions}
              onReveal={reveal}
            />
            <div className="library-content ui-panel">
              <NewBoardButton />
              <RecentBoards version={version} />
              <BoardList
                version={version}
                folders={folders}
                onChange={changed}
                onRevealFolder={reveal}
              />
            </div>
          </div>
        </LibraryDnd>
      )}
    </main>
  );
}
