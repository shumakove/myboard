import { useEffect, useState } from "react";
import {
  errorMessage,
  listBoards,
  listFolders,
  type Board,
  type Folder,
} from "./libraryApi";

export interface LibraryTree {
  folders: Folder[];
  boards: Board[];
}

/** Все папки и доски пользователя для бокового списка; `version` — перезагрузка после правок. */
export function useLibraryTree(version: number) {
  const [tree, setTree] = useState<LibraryTree | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listFolders(),
      listBoards({ search: "", sort: "title", modifiedSince: null }),
    ])
      .then(([folders, boards]) => {
        if (!active) return;
        setTree({ folders, boards });
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [version]);

  return { tree, error };
}
