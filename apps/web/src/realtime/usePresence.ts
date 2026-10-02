import { useSyncExternalStore } from "react";
import type { BoardPresence, PresenceSnapshot } from "./boardPresence";

/** Кто сейчас на доске и их состояния; перерисовка при каждом изменении. */
export function usePresence(presence: BoardPresence): PresenceSnapshot {
  return useSyncExternalStore(presence.subscribe, presence.getSnapshot);
}
