import type { Point } from "../realtime/messages";
import { STICKY_COLORS } from "./objectTypes";
import { useDragToBoard } from "./useDragToBoard";
import { FloatingPanel, IconButton } from "../ui";

/**
 * STK-01: цвет стикера (и стопки, STK-05) до постановки. Панель видна, пока выбран
 * инструмент: щелчок по образцу задаёт цвет следующего объекта, образец можно перетащить
 * на холст — там сразу встанет стикер этого цвета.
 */
export function StickyPalette({
  color,
  onColor,
  onDrop,
}: {
  color: string;
  onColor: (color: string) => void;
  /** Образец отпустили над точкой окна. */
  onDrop: (color: string, client: Point) => void;
}) {
  const drag = useDragToBoard(onDrop);
  return (
    <FloatingPanel
      className="sticky-palette"
      role="toolbar"
      aria-label="Sticky note color"
    >
      {STICKY_COLORS.map((option) => {
        const value = String(option.value);
        return (
          <IconButton
            key={value}
            label={option.label}
            className="sticky-swatch"
            title={`${option.label}: click to use for new sticky notes or drag onto the board.`}
            aria-pressed={value === color}
            onClick={() => {
              if (!drag.consumeClick()) onColor(value);
            }}
            {...drag.handlers(value, `${option.label} sticky note`)}
          >
            <span
              className="sticky-swatch-color"
              aria-hidden="true"
              style={{ background: value }}
            />
          </IconButton>
        );
      })}
      {drag.ghost}
    </FloatingPanel>
  );
}
