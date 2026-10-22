import {
  LABEL_PLACES,
  type LabelOrientation,
  type LineLabel,
} from "./connectors";
import type { LabelFields } from "./lineEdits";
import {
  COLORS,
  FONT_SIZES,
  STYLE_KEYS,
  type StyleOption,
} from "./objectTypes";
import { Button, SelectField } from "../ui";

/** Подпись линии, выбранная в панели выделения (CON-03, CON-04). */
export interface LabelActions {
  value: LineLabel;
  set: (fields: LabelFields) => void;
  edit: () => void;
  remove: () => void;
}

/** Действия одной выделенной линии. */
export interface LineActions {
  /** CON-02: поменять начало и конец местами. */
  swap: () => void;
  /** CVS-26: отвязать концы от объектов; `null` — привязанных концов нет. */
  detach: (() => void) | null;
  /** CON-03: новая подпись посередине линии. */
  addLabel: () => void;
  label: LabelActions | null;
}

const ALIGNS: StyleOption[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const ORIENTATIONS: StyleOption[] = [
  { value: "horizontal", label: "Horizontal" },
  { value: "along", label: "Along line" },
];

const PLACES = [
  ["start", "Start"],
  ["center", "Center"],
  ["end", "End"],
] as const;

/** Кнопки линии в панели выделения: Swap ends, Detach, Add label и оформление подписи. */
export function LineControls({ line }: { line: LineActions }) {
  return (
    <>
      <Button variant="ghost" onClick={line.swap}>
        Swap ends
      </Button>
      {line.detach && (
        <Button variant="ghost" onClick={line.detach}>
          Detach
        </Button>
      )}
      <Button variant="ghost" onClick={line.addLabel}>
        Add label
      </Button>
      {line.label && <LabelControls label={line.label} />}
    </>
  );
}

/**
 * CON-03: положение подписи у начала, по центру или у конца линии, ориентация текста;
 * CON-04: шрифт, размер, цвет и выравнивание строк.
 */
function LabelControls({ label }: { label: LabelActions }) {
  const { value, set } = label;
  return (
    <span role="group" aria-label="Label" className="selection-more">
      <Choice
        label="Label font"
        value={value.fontFamily}
        options={STYLE_KEYS.fontFamily.options}
        onChange={(fontFamily) => {
          set({ fontFamily: String(fontFamily) });
        }}
      />
      <Choice
        label="Label size"
        value={value.fontSize}
        options={FONT_SIZES}
        onChange={(fontSize) => {
          set({ fontSize: Number(fontSize) });
        }}
      />
      <Choice
        label="Label color"
        value={value.color}
        options={COLORS}
        onChange={(color) => {
          set({ color: String(color) });
        }}
      />
      <Choice
        label="Label align"
        value={value.align}
        options={ALIGNS}
        onChange={(align) => {
          set({ align: align as LineLabel["align"] });
        }}
      />
      <Choice
        label="Label direction"
        value={value.orientation}
        options={ORIENTATIONS}
        onChange={(orientation) => {
          set({ orientation: orientation as LabelOrientation });
        }}
      />
      <span
        role="group"
        aria-label="Label position"
        className="selection-filter"
      >
        {PLACES.map(([place, text]) => (
          <Button
            key={place}
            variant="ghost"
            aria-pressed={value.position === LABEL_PLACES[place]}
            onClick={() => {
              set({ position: LABEL_PLACES[place] });
            }}
          >
            {text}
          </Button>
        ))}
      </span>
      <Button variant="ghost" onClick={label.edit}>
        Edit label
      </Button>
      <Button variant="ghost" onClick={label.remove}>
        Delete label
      </Button>
    </span>
  );
}

function Choice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | number;
  options: readonly StyleOption[];
  onChange: (value: string | number) => void;
}) {
  const listed = options.some((o) => String(o.value) === String(value))
    ? options
    : [...options, { value, label: String(value) }];
  return (
    <SelectField
      label={label}
      className="selection-style"
      value={String(value)}
      onChange={(event) => {
        const option = listed.find(
          (o) => String(o.value) === event.target.value,
        );
        if (option) onChange(option.value);
      }}
    >
      {listed.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </SelectField>
  );
}
