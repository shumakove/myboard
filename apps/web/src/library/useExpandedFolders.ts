import { useCallback, useState } from "react";

const STORAGE_KEY = "myboard.expandedFolders";

function load(): Set<string> {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(saved)
        ? saved.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function save(ids: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Хранилище недоступно (приватный режим): состояние живёт до перезагрузки.
  }
}

/**
 * BRD-11: какие папки бокового списка развёрнуты. Новая папка свёрнута; выбор
 * запоминается в браузере, чтобы переживать перезагрузку.
 */
export function useExpandedFolders() {
  const [expanded, setExpanded] = useState(load);

  const update = useCallback((change: (next: Set<string>) => void) => {
    setExpanded((current) => {
      const next = new Set(current);
      change(next);
      save(next);
      return next;
    });
  }, []);

  const toggle = useCallback(
    (id: string) => {
      update((next) => {
        if (!next.delete(id)) next.add(id);
      });
    },
    [update],
  );

  const expand = useCallback(
    (ids: string[]) => {
      update((next) => {
        ids.forEach((id) => next.add(id));
      });
    },
    [update],
  );

  return { expanded, toggle, expand };
}
