import type { CameraView } from "../realtime/messages";
import { MAX_ZOOM, MIN_ZOOM } from "./camera";

const PREFIX = "myboard.camera.";

/**
 * CVS-05: последний вид доски в этом браузере — `localStorage` по id доски
 * (ARCHITECTURE.md, раздел 7). Другой браузер своего вида не получает.
 */
export function loadCamera(boardId: string): CameraView | null {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem(PREFIX + boardId) ?? "null",
    );
    return isStoredCamera(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveCamera(boardId: string, camera: CameraView): void {
  try {
    localStorage.setItem(PREFIX + boardId, JSON.stringify(camera));
  } catch {
    // Хранилище недоступно (приватный режим): вид не переживёт перезагрузку.
  }
}

function isStoredCamera(value: unknown): value is CameraView {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, zoom } = value as Record<string, unknown>;
  return (
    typeof x === "number" &&
    Number.isFinite(x) &&
    typeof y === "number" &&
    Number.isFinite(y) &&
    typeof zoom === "number" &&
    zoom >= MIN_ZOOM &&
    zoom <= MAX_ZOOM
  );
}
