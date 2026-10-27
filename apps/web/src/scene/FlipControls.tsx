import { useRef, useState } from "react";
import { Button, SelectField } from "../ui";
import {
  FLIP_DIRECTIONS,
  type FlipDirection,
  type FlipSideName,
  type FlipSideStyle,
} from "./flipData";
import { imageToDataUrl } from "./imageFile";
import {
  COLORS,
  FONT_SIZES,
  STYLE_KEYS,
  type StyleOption,
} from "./objectTypes";

/** Показанная сторона одной выделенной флип-карточки и её свойства. */
export interface FlipSideActions {
  name: FlipSideName;
  style: FlipSideStyle;
  direction: FlipDirection;
  /** FLP-01, FLP-03: свойства стороны. */
  set: (fields: Partial<FlipSideStyle>) => void;
  /** FLP-01: направление переворота. */
  setDirection: (direction: FlipDirection) => void;
}

/** Действия с выделенными флип-карточками (T6.11). */
export interface FlipActions {
  /** Сколько незаблокированных карточек выделено. */
  count: number;
  /** FLP-02: перевернуть все выделенные карточки разом. */
  flip: () => void;
  /** Одна выделенная карточка — её показанная сторона; иначе `null`. */
  side: FlipSideActions | null;
}

/**
 * Панель флип-карточки в панели выделения: Flip — одну или все выделенные (FLP-02);
 * у одной карточки — направление переворота, картинка стороны (FLP-01), цвет стороны,
 * размер и форматирование текста стороны (FLP-03).
 */
export function FlipControls({ flip }: { flip: FlipActions }) {
  const { side } = flip;
  return (
    <span role="group" aria-label="Flip card" className="selection-mindmap">
      <Button variant="ghost" onClick={flip.flip}>
        {flip.count > 1 ? `Flip all (${String(flip.count)})` : "Flip"}
      </Button>
      {side && <SideControls side={side} />}
    </span>
  );
}

function SideControls({ side }: { side: FlipSideActions }) {
  const file = useRef<HTMLInputElement>(null);
  const [failed, setFailed] = useState(false);
  const { style } = side;
  return (
    <>
      <span className="selection-count">
        {side.name === "front" ? "Front side" : "Back side"}
      </span>
      <SelectField
        label="Flip direction"
        value={side.direction}
        onChange={(event) => {
          side.setDirection(event.target.value as FlipDirection);
        }}
      >
        {FLIP_DIRECTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </SelectField>
      <OptionSelect
        label="Side color"
        value={style.fill}
        options={COLORS}
        onChange={(fill) => {
          side.set({ fill });
        }}
      />
      <OptionSelect
        label="Font size"
        value={style.fontSize}
        options={FONT_SIZES}
        onChange={(value) => {
          side.set({ fontSize: Number(value) });
        }}
      />
      <OptionSelect
        label="Style"
        value={style.fontStyle}
        options={STYLE_KEYS.fontStyle.options}
        onChange={(fontStyle) => {
          side.set({ fontStyle });
        }}
      />
      <OptionSelect
        label="Text color"
        value={style.color}
        options={COLORS}
        onChange={(color) => {
          side.set({ color });
        }}
      />
      <OptionSelect
        label="Align"
        value={style.align}
        options={STYLE_KEYS.align.options}
        onChange={(align) => {
          side.set({ align });
        }}
      />
      <Button
        variant="ghost"
        onClick={() => {
          file.current?.click();
        }}
      >
        {style.image === null ? "Add image" : "Replace image"}
      </Button>
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        aria-label="Side image"
        onChange={(event) => {
          const input = event.currentTarget;
          const picked = input.files?.[0];
          input.value = "";
          if (picked === undefined) return;
          imageToDataUrl(picked).then(
            (image) => {
              setFailed(false);
              side.set({ image });
            },
            () => {
              setFailed(true);
            },
          );
        }}
      />
      {style.image !== null && (
        <Button
          variant="ghost"
          onClick={() => {
            side.set({ image: null });
          }}
        >
          Remove image
        </Button>
      )}
      {failed && (
        <span role="alert" className="selection-count">
          This file is not an image that can be shown.
        </span>
      )}
    </>
  );
}

/** Список значений; значение не из списка (свой цвет) показано отдельной строкой. */
function OptionSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: readonly StyleOption[];
  onChange: (value: string) => void;
}) {
  const known = options.some((o) => String(o.value) === String(value));
  return (
    <SelectField
      label={label}
      value={String(value)}
      onChange={(event) => {
        onChange(event.target.value);
      }}
    >
      {!known && <option value={String(value)}>{String(value)}</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </SelectField>
  );
}
