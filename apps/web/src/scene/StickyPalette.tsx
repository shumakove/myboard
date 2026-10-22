import { useEffect, useRef } from "react";
import type { Point } from "../realtime/messages";
import { STICKY_COLORS, type StyleOption } from "./objectTypes";
import { useDragToBoard } from "./useDragToBoard";
import { FloatingPanel, IconButton } from "../ui";

/**
 * STK-01: цвет стикера (и стопки, STK-05) до постановки. Панель видна, пока выбран
 * инструмент: щелчок по образцу задаёт цвет следующего объекта, образец можно перетащить
 * на холст — там сразу встанет стикер этого цвета. SHP-04: после палитры — недавние свои
 * цвета стикера и поле выбора своего цвета.
 */
export function StickyPalette({
  color,
  recent,
  onColor,
  onCustom,
  onDrop,
}: {
  color: string;
  /** SHP-04: недавние свои цвета стикера. */
  recent: readonly string[];
  onColor: (color: string) => void;
  /** SHP-04: выбран свой цвет. */
  onCustom: (color: string) => void;
  /** Образец отпустили над точкой окна. */
  onDrop: (color: string, client: Point) => void;
}) {
  const drag = useDragToBoard(onDrop);
  const custom = useRef<HTMLInputElement>(null);
  const pick = useRef(onCustom);
  useEffect(() => {
    pick.current = onCustom;
  });
  useEffect(() => {
    const input = custom.current;
    if (input === null) return;
    // Цвет выбран, когда окно выбора закрыто (`change`), а не на каждом шаге.
    const changed = () => {
      pick.current(input.value);
    };
    input.addEventListener("change", changed);
    return () => {
      input.removeEventListener("change", changed);
    };
  }, []);
  const swatches: StyleOption[] = [
    ...STICKY_COLORS,
    ...recent
      .filter((value) => !STICKY_COLORS.some((c) => c.value === value))
      .map((value) => ({ value, label: `Custom ${value}` })),
  ];
  return (
    <FloatingPanel
      className="sticky-palette"
      role="toolbar"
      aria-label="Sticky note color"
    >
      {swatches.map((option) => {
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
      <label className="ui-field ui-field--inline selection-color">
        Custom color
        <input ref={custom} type="color" defaultValue={color} />
      </label>
      {drag.ghost}
    </FloatingPanel>
  );
}
