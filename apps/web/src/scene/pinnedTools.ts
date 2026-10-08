import { useCallback, useState } from "react";
import { TOOLS, type ToolId } from "./tools";

/** Закреплённые инструменты этого браузера — общие для всех досок (CVS-24). */
export const PINNED_TOOLS_KEY = "myboard.pinnedTools";

const ALL_IDS: readonly ToolId[] = TOOLS.map((tool) => tool.id);

/** По умолчанию закреплены все инструменты в порядке полного списка. */
export const DEFAULT_PINNED: readonly ToolId[] = ALL_IDS;

function isToolId(value: unknown): value is ToolId {
  return ALL_IDS.includes(value as ToolId);
}

/** Сохранённый набор; испорченная запись — набор по умолчанию, неизвестные id — мимо. */
export function loadPinned(storage: Storage | null = safeStorage()): ToolId[] {
  try {
    const raw = storage?.getItem(PINNED_TOOLS_KEY);
    if (raw == null) return [...DEFAULT_PINNED];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED];
    return [...new Set(parsed.filter(isToolId))];
  } catch {
    return [...DEFAULT_PINNED];
  }
}

export function savePinned(
  pinned: readonly ToolId[],
  storage: Storage | null = safeStorage(),
): void {
  try {
    storage?.setItem(PINNED_TOOLS_KEY, JSON.stringify(pinned));
  } catch {
    // Хранилище недоступно (приватный режим): набор живёт до перезагрузки.
  }
}

/** Закрепить в конец панели или открепить. */
export function togglePin(pinned: readonly ToolId[], id: ToolId): ToolId[] {
  return pinned.includes(id)
    ? pinned.filter((item) => item !== id)
    : [...pinned, id];
}

/** Сдвиг закреплённого инструмента на `delta` мест; за краем — без изменений. */
export function movePinned(
  pinned: readonly ToolId[],
  id: ToolId,
  delta: number,
): ToolId[] {
  const from = pinned.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= pinned.length) return [...pinned];
  const next = [...pinned];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/** Полный список: сначала закреплённые в своём порядке, затем остальные. */
export function allTools(pinned: readonly ToolId[]): ToolId[] {
  return [...pinned, ...ALL_IDS.filter((id) => !pinned.includes(id))];
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** CVS-24: набор и порядок закреплённых инструментов, сохраняются в браузере. */
export function usePinnedTools(): {
  pinned: ToolId[];
  update: (change: (pinned: readonly ToolId[]) => ToolId[]) => void;
} {
  const [pinned, setPinned] = useState(() => loadPinned());
  const update = useCallback(
    (change: (pinned: readonly ToolId[]) => ToolId[]) => {
      const next = change(pinned);
      setPinned(next);
      savePinned(next);
    },
    [pinned],
  );
  return { pinned, update };
}
