import { useEffect, useState } from "react";
import { pathTo } from "./folderTree";
import { errorMessage, listFolders, type Folder } from "./libraryApi";

/** BRD-06: папки, найденные по названию; нажатие раскрывает папку в боковом списке. */
export function FolderSearchResults({
  search,
  allFolders,
  version,
  onReveal,
}: {
  search: string;
  allFolders: Folder[];
  version: number;
  onReveal: (folderId: string) => void;
}) {
  const [found, setFound] = useState<Folder[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listFolders(search)
      .then((folders) => {
        if (!active) return;
        setFound(folders);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [search, version]);

  if (error) {
    return (
      <p className="account-error" role="alert">
        {error}
      </p>
    );
  }
  if (found.length === 0) return null;
  return (
    <section aria-labelledby="folder-results-title">
      <h3 id="folder-results-title">Folders</h3>
      <ul className="library-list" aria-label="Matching folders">
        {found.map((folder) => {
          const path = pathTo(allFolders, folder.id).map((f) => f.title);
          return (
            <li
              key={folder.id}
              aria-label={folder.title}
              className="library-row"
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
              {path.length > 1 && (
                <span className="library-meta">{path.join(" / ")}</span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
