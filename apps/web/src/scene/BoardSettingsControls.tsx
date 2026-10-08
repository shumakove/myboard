import type * as Y from "yjs";
import {
  BACKGROUNDS,
  GRID_STEPS,
  updateSettings,
  useBoardSettings,
} from "./boardSettings";

/** CVS-06: фон доски и шаг сетки — общие для всех участников доски. */
export function BoardSettingsControls({
  settings,
}: {
  settings: Y.Map<unknown>;
}) {
  const { background, gridStep } = useBoardSettings(settings);
  return (
    <div className="board-settings" role="group" aria-label="Board settings">
      <label>
        Background
        <select
          value={background}
          onChange={(event) => {
            updateSettings(settings, { background: event.target.value });
          }}
        >
          {/* Значение, выбранное не из списка (например, другим клиентом), тоже видно. */}
          {!BACKGROUNDS.some((b) => b.value === background) && (
            <option value={background}>{background}</option>
          )}
          {BACKGROUNDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Grid
        <select
          value={gridStep}
          onChange={(event) => {
            updateSettings(settings, { gridStep: Number(event.target.value) });
          }}
        >
          {!GRID_STEPS.some((step) => step === gridStep) && (
            <option value={gridStep}>{gridStep} px</option>
          )}
          {GRID_STEPS.map((step) => (
            <option key={step} value={step}>
              {step === 0 ? "Off" : `${String(step)} px`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
