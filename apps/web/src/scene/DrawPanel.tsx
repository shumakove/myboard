import { useEffect, useRef } from "react";
import { FloatingPanel, IconButton, SelectField, Switch, Button } from "../ui";
import type { Brush } from "./drawingShape";
import {
  brushWidth,
  setPresetWidth,
  THICKNESSES,
  type BrushSettings,
  type DrawSettings,
} from "./drawSettings";
import { COLORS, type StyleOption } from "./objectTypes";
import { toolById, type DrawToolId } from "./tools";

const DRAW_TOOLS: readonly DrawToolId[] = ["pen", "marker", "eraser", "laser"];

/**
 * Панель рисования — видна, пока выбран инструмент рисования (T6.5):
 * - выбор пера, маркера, ластика и лазера (DRW-01, DRW-03, DRW-05);
 * - DRW-01: цвет пера или маркера из палитры, недавних своих цветов или свой;
 * - DRW-02: три пресета толщины; список Thickness меняет значение выбранного пресета;
 * - MOB-05: переключатель «стилус сразу рисует».
 */
export function DrawPanel({
  tool,
  settings,
  recent,
  onTool,
  onBrush,
  onCustomColor,
  onStylusDraws,
}: {
  tool: DrawToolId;
  settings: DrawSettings;
  /** Недавние свои цвета рисунков. */
  recent: readonly string[];
  onTool: (tool: DrawToolId) => void;
  onBrush: (
    brush: Brush,
    change: (current: BrushSettings) => BrushSettings,
  ) => void;
  /** Свой цвет выбран в поле выбора цвета. */
  onCustomColor: (brush: Brush, color: string) => void;
  onStylusDraws: (on: boolean) => void;
}) {
  const brush: Brush | null = tool === "pen" || tool === "marker" ? tool : null;
  return (
    <FloatingPanel className="draw-panel" role="toolbar" aria-label="Drawing">
      <span role="group" aria-label="Drawing tool" className="draw-row">
        {DRAW_TOOLS.map((id) => (
          <Button
            key={id}
            variant="ghost"
            aria-pressed={tool === id}
            title={toolById(id).hint}
            onClick={() => {
              onTool(id);
            }}
          >
            {toolById(id).label}
          </Button>
        ))}
      </span>
      {brush && (
        <BrushControls
          key={brush}
          brush={brush}
          settings={settings[brush]}
          recent={recent}
          onBrush={(change) => {
            onBrush(brush, change);
          }}
          onCustomColor={(color) => {
            onCustomColor(brush, color);
          }}
        />
      )}
      <Switch
        className="draw-row"
        label="Stylus draws"
        title="A stylus draws with the pen right away, while fingers pan and select."
        checked={settings.stylusDraws}
        onChange={(event) => {
          onStylusDraws(event.currentTarget.checked);
        }}
      />
    </FloatingPanel>
  );
}

function BrushControls({
  brush,
  settings,
  recent,
  onBrush,
  onCustomColor,
}: {
  brush: Brush;
  settings: BrushSettings;
  recent: readonly string[];
  onBrush: (change: (current: BrushSettings) => BrushSettings) => void;
  onCustomColor: (color: string) => void;
}) {
  const name = brush === "pen" ? "Pen" : "Marker";
  const swatches: StyleOption[] = [
    ...COLORS,
    ...recent
      .filter((value) => !COLORS.some((c) => c.value === value))
      .map((value) => ({ value, label: `Custom ${value}` })),
  ];
  return (
    <>
      <span role="group" aria-label={`${name} color`} className="draw-row">
        {swatches.map((option) => {
          const value = String(option.value);
          return (
            <IconButton
              key={value}
              label={option.label}
              className="sticky-swatch"
              aria-pressed={value === settings.color}
              onClick={() => {
                onBrush((current) => ({ ...current, color: value }));
              }}
            >
              <span
                className="sticky-swatch-color"
                aria-hidden="true"
                style={{ background: value }}
              />
            </IconButton>
          );
        })}
        <CustomColor color={settings.color} onPick={onCustomColor} />
      </span>
      <span role="group" aria-label={`${name} presets`} className="draw-row">
        {settings.presets.map((width, index) => (
          <Button
            key={index}
            variant="ghost"
            className="draw-preset"
            aria-label={`Preset ${String(index + 1)}: ${String(width)}`}
            aria-pressed={settings.preset === index}
            onClick={() => {
              onBrush((current) => ({ ...current, preset: index }));
            }}
          >
            <span
              className="draw-preset-dot"
              aria-hidden="true"
              style={{
                width: Math.min(width, 24),
                height: Math.min(width, 24),
              }}
            />
            {width}
          </Button>
        ))}
        <SelectField
          label="Thickness"
          value={brushWidth(settings)}
          onChange={(event) => {
            const width = Number(event.currentTarget.value);
            onBrush((current) => setPresetWidth(current, width));
          }}
        >
          {THICKNESSES.map((width) => (
            <option key={width} value={width}>
              {width}
            </option>
          ))}
        </SelectField>
      </span>
    </>
  );
}

/** Поле своего цвета: цвет выбран, когда окно выбора закрыто (`change`). */
function CustomColor({
  color,
  onPick,
}: {
  color: string;
  onPick: (color: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const element = input.current;
    if (element === null) return;
    const changed = () => {
      pick.current(element.value);
    };
    element.addEventListener("change", changed);
    return () => {
      element.removeEventListener("change", changed);
    };
  }, []);
  return (
    <label className="ui-field ui-field--inline selection-color">
      Custom color
      <input ref={input} type="color" defaultValue={color} />
    </label>
  );
}
