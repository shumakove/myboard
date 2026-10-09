import { useMemo, useState } from "react";
import { Button, FloatingPanel, Input } from "../ui";
import { typeName } from "./objectTypes";
import { searchScene } from "./search";
import type { SceneObject } from "./sceneObjects";

/**
 * CVS-08: поиск по тексту и тегам объектов доски. Щелчок по результату (или Enter —
 * следующий результат) переводит вид к объекту и выделяет его; панель остаётся открытой.
 * Escape закрывает панель, где бы в ней ни был фокус (BUG-010, UI-03).
 */
export function BoardSearch({
  scene,
  onGoTo,
  onClose,
}: {
  scene: readonly SceneObject[];
  onGoTo: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  const hits = useMemo(() => searchScene(scene, query), [scene, query]);

  function goTo(id: string) {
    setCurrent(id);
    onGoTo(id);
  }

  /** Enter: следующий результат после текущего (по кругу). */
  function next() {
    if (hits.length === 0) return;
    const at = hits.findIndex((hit) => hit.object.id === current);
    const hit = hits[(at + 1) % hits.length];
    if (hit) goTo(hit.object.id);
  }

  return (
    <FloatingPanel
      role="search"
      aria-label="Search board"
      className="board-search"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Escape панели не снимает выделение на доске.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="board-search-row">
        <Input
          type="search"
          aria-label="Search text and tags"
          placeholder="Search text and #tags"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              next();
            }
          }}
        />
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {query.trim() !== "" && (
        <p role="status" className="board-search-count">
          {hits.length === 0
            ? "Nothing found."
            : `${String(hits.length)} ${hits.length === 1 ? "result" : "results"}`}
        </p>
      )}
      {hits.length > 0 && (
        <ul className="board-search-results" aria-label="Search results">
          {hits.map(({ object, snippet, tags }) => (
            <li key={object.id}>
              <Button
                variant="ghost"
                className="board-search-hit"
                aria-current={object.id === current ? "true" : undefined}
                onClick={() => {
                  goTo(object.id);
                }}
              >
                <span className="board-search-type">
                  {typeName(object.type)}
                </span>
                {snippet !== "" && (
                  <span className="board-search-text">{snippet}</span>
                )}
                {tags.length > 0 && (
                  <span className="board-search-tags">
                    {tags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </FloatingPanel>
  );
}
