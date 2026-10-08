import { IconButton, SelectField } from "../ui";
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
      <IconButton
        label="Zoom out"
        disabled={zoom <= MIN_ZOOM}
        onClick={onZoomOut}
      >
        −
      </IconButton>
      {/* Не <output>: его роль status уже занята состоянием связи на странице. */}
      <span className="camera-zoom" aria-label="Zoom level">
        {Math.round(zoom * 100)}%
      </span>
      <IconButton
        label="Zoom in"
        disabled={zoom >= MAX_ZOOM}
        onClick={onZoomIn}
      >
        +
      </IconButton>
      <SelectField
        label="Mouse wheel"
        className="camera-wheel"
        value={wheelMode}
        onChange={(event) => {
          onWheelMode(event.target.value === "scroll" ? "scroll" : "zoom");
        }}
      >
        <option value="zoom">Zooms</option>
        <option value="scroll">Scrolls (Ctrl/⌘ + wheel zooms)</option>
      </SelectField>
    </div>
  );
}
