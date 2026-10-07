import { MAX_ZOOM, MIN_ZOOM } from "./camera";
import type { WheelMode } from "./wheel";

/**
 * Панель вида: масштаб кнопками (CVS-02), текущий масштаб и выбор поведения колеса
 * мыши (CVS-03).
 */
export function CameraControls({
  zoom,
  onZoomIn,
  onZoomOut,
  wheelMode,
  onWheelMode,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  wheelMode: WheelMode;
  onWheelMode: (mode: WheelMode) => void;
}) {
  return (
    <div className="camera-controls" role="toolbar" aria-label="View">
      <button
        type="button"
        aria-label="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={onZoomOut}
      >
        −
      </button>
      {/* Не <output>: его роль status уже занята состоянием связи на странице. */}
      <span className="camera-zoom" aria-label="Zoom level">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={onZoomIn}
      >
        +
      </button>
      <label className="camera-wheel">
        Mouse wheel
        <select
          value={wheelMode}
          onChange={(event) => {
            onWheelMode(event.target.value === "scroll" ? "scroll" : "zoom");
          }}
        >
          <option value="zoom">Zooms</option>
          <option value="scroll">Scrolls (Ctrl/⌘ + wheel zooms)</option>
        </select>
      </label>
    </div>
  );
}
