import { useEffect, useId, useState } from "react";
import { BoardRow } from "./BoardRow";
import { FolderSearchResults } from "./FolderSearchResults";
import {
  errorMessage,
  listBoards,
  type Board,
  type BoardSort,
  type Folder,
} from "./libraryApi";
import { Input, Select } from "../ui";

/** Пауза после ввода в поиск перед запросом к серверу. */
export const SEARCH_DELAY_MS = 300;

const DAY_MS = 24 * 60 * 60 * 1000;

const SORTS: { value: BoardSort; label: string }[] = [
  { value: "updated", label: "Last modified" },
  { value: "created", label: "Date created" },
  { value: "title", label: "Name" },
];

// BRD-05: фильтр по давности последнего изменения, 0 — без фильтра.
const PERIODS: { days: number; label: string }[] = [
  { days: 0, label: "Any time" },
  { days: 1, label: "Last 24 hours" },
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
];

function modifiedSince(days: number): string | null {
  return days ? new Date(Date.now() - days * DAY_MS).toISOString() : null;
}

/**
 * Полный список досок пользователя (ACC-04, BRD-04) с поиском по названию досок и
 * папок (BRD-06), сортировкой и фильтром (BRD-05). Всё выполняет сервер.
 */
export function BoardList({
  version,
  folders,
  onChange,
  onRevealFolder,
}: {
  version: number;
  /** Все папки пользователя — для пути найденной папки. */
  folders: Folder[];
  onChange: () => void;
  onRevealFolder: (folderId: string) => void;
}) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<BoardSort>("updated");
  const [periodDays, setPeriodDays] = useState(0);
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sortId = useId();
  const periodId = useId();

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput);
    }, SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [searchInput]);

  useEffect(() => {
    let active = true;
    listBoards({ search, sort, modifiedSince: modifiedSince(periodDays) })
      .then((list) => {
        if (!active) return;
        setBoards(list);
        setError(null);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, [search, sort, periodDays, version]);

  const searching = search.trim() !== "";
  const narrowed = searching || periodDays !== 0;

  return (
    <section aria-labelledby="all-boards-title">
      <h2 id="all-boards-title">All boards</h2>
      <div className="library-controls">
        <Input
          type="search"
          aria-label="Search boards"
          placeholder="Search boards and folders"
          value={searchInput}
          onChange={(event) => {
            setSearchInput(event.target.value);
          }}
        />
        <div className="library-control">
          <label htmlFor={sortId}>Sort by</label>
          <Select
            id={sortId}
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as BoardSort);
            }}
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="library-control">
          <label htmlFor={periodId}>Modified</label>
          <Select
            id={periodId}
            value={periodDays}
            onChange={(event) => {
              setPeriodDays(Number(event.target.value));
            }}
          >
            {PERIODS.map((option) => (
              <option key={option.days} value={option.days}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {searching && (
        <FolderSearchResults
          search={search}
          allFolders={folders}
          version={version}
          onReveal={onRevealFolder}
        />
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
      {boards === null && !error && <p>Loading…</p>}
      {boards?.length === 0 && (
        <p>
          {narrowed
            ? "No boards match."
            : "No boards yet. Create your first board."}
        </p>
      )}
      {boards && boards.length > 0 && (
        <ul className="library-list" aria-label="All boards">
          {boards.map((board) => (
            <BoardRow key={board.id} board={board} onChange={onChange} />
          ))}
        </ul>
      )}
    </section>
  );
}
