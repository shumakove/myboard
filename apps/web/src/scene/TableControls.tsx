import { useState } from "react";
import { COLORS, STYLE_KEYS, type StyleOption } from "./objectTypes";
import type { CellStyleKey } from "./tableData";
import { Button, SelectField, TextField } from "../ui";

/** Действия с одной выделенной незаблокированной таблицей (T6.7); `null` — нельзя. */
export interface TableActions {
  /** Сколько ячеек выделено; 0 — ячейки не выбраны, действия — над краями таблицы. */
  cells: number;
  /** Значения оформления, общие для выделенных ячеек; разные — `undefined`. */
  style: Partial<Record<CellStyleKey, string>>;
  /** TBL-02, TBL-03: оформление выделенных ячеек. */
  setStyle: (key: CellStyleKey, value: string) => void;
  /** TBL-03: объединить и разъединить выделенные ячейки. */
  merge: (() => void) | null;
  unmerge: (() => void) | null;
  /** TBL-04: ввод текста в активной ячейке. */
  editCell: (() => void) | null;
  /** TBL-01: строки и столбцы — рядом с активной ячейкой или у края таблицы. */
  addRow: (below: boolean) => void;
  addColumn: (right: boolean) => void;
  deleteRow: (() => void) | null;
  deleteColumn: (() => void) | null;
  /** TBL-01: ширина столбца и высота строки активной ячейки; без ячейки — `null`. */
  size: {
    width: number;
    height: number;
    setWidth: (value: number) => void;
    setHeight: (value: number) => void;
  } | null;
}

/** Значения оформления ячейки в панели (TBL-02, TBL-03). */
const CELL_OPTIONS: Record<
  CellStyleKey,
  { label: string; options: StyleOption[] }
> = {
  color: { label: "Text color", options: COLORS },
  fontStyle: { label: "Style", options: STYLE_KEYS.fontStyle.options },
  align: {
    label: "Align",
    options: STYLE_KEYS.align.options.filter((o) => o.value !== "justify"),
  },
  valign: {
    label: "Vertical align",
    options: [
      { value: "top", label: "Top" },
      { value: "middle", label: "Middle" },
      { value: "bottom", label: "Bottom" },
    ],
  },
  fill: {
    label: "Cell fill",
    options: [{ value: "transparent", label: "None" }, ...COLORS],
  },
};

/**
 * Панель таблицы (T6.7) в панели выделения: оформление выделенных ячеек (TBL-02, TBL-03),
 * объединение (TBL-03), ввод текста (TBL-04), строки и столбцы с их размером (TBL-01).
 */
export function TableControls({ table }: { table: TableActions }) {
  const [linesOpen, setLinesOpen] = useState(false);
  return (
    <>
      {table.cells > 0 && (
        <span role="group" aria-label="Cells" className="selection-cells">
          <span className="selection-count">
            {table.cells} {table.cells === 1 ? "cell" : "cells"}
          </span>
          {(Object.keys(CELL_OPTIONS) as CellStyleKey[]).map((key) => (
            <CellSelect key={key} styleKey={key} table={table} />
          ))}
        </span>
      )}
      {table.editCell && (
        <Button variant="ghost" onClick={table.editCell}>
          Edit cell
        </Button>
      )}
      {table.merge && (
        <Button variant="ghost" onClick={table.merge}>
          Merge cells
        </Button>
      )}
      {table.unmerge && (
        <Button variant="ghost" onClick={table.unmerge}>
          Unmerge cells
        </Button>
      )}
      <Button
        variant="ghost"
        aria-expanded={linesOpen}
        onClick={() => {
          setLinesOpen((open) => !open);
        }}
      >
        Rows & columns
      </Button>
      {linesOpen && <LineEditor table={table} />}
    </>
  );
}

function CellSelect({
  styleKey: key,
  table,
}: {
  styleKey: CellStyleKey;
  table: TableActions;
}) {
  const { label, options } = CELL_OPTIONS[key];
  const current = table.style[key] ?? "";
  // Свой цвет (не из списка) тоже виден в списке.
  const listed =
    current === "" || options.some((o) => o.value === current)
      ? options
      : [...options, { value: current, label: current }];
  return (
    <SelectField
      label={label}
      className="selection-style"
      value={current}
      onChange={(event) => {
        table.setStyle(key, event.target.value);
      }}
    >
      {current === "" && (
        <option value="" disabled>
          Mixed
        </option>
      )}
      {listed.map((option) => (
        <option key={String(option.value)} value={String(option.value)}>
          {option.label}
        </option>
      ))}
    </SelectField>
  );
}

/** TBL-01: добавить и удалить строки и столбцы, размер активной ячейки. */
function LineEditor({ table }: { table: TableActions }) {
  const lineButton = (label: string, action: (() => void) | null) =>
    action && (
      <Button variant="ghost" onClick={action}>
        {label}
      </Button>
    );
  return (
    <span role="group" aria-label="Rows and columns" className="selection-more">
      {lineButton("Add row above", () => {
        table.addRow(false);
      })}
      {lineButton("Add row below", () => {
        table.addRow(true);
      })}
      {lineButton("Add column left", () => {
        table.addColumn(false);
      })}
      {lineButton("Add column right", () => {
        table.addColumn(true);
      })}
      {lineButton("Delete row", table.deleteRow)}
      {lineButton("Delete column", table.deleteColumn)}
      {table.size && (
        <>
          <SizeField
            label="Column width"
            value={table.size.width}
            onCommit={table.size.setWidth}
          />
          <SizeField
            label="Row height"
            value={table.size.height}
            onCommit={table.size.setHeight}
          />
        </>
      )}
    </span>
  );
}

/** Размер числом: применяется по Enter и при уходе из поля. */
function SizeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const parsed = Number(draft);
    if (draft !== null && Number.isFinite(parsed) && parsed > 0) {
      onCommit(parsed);
    }
    setDraft(null);
  };
  return (
    <TextField
      label={label}
      className="ui-field--inline selection-size"
      type="number"
      min={1}
      value={draft ?? String(Math.round(value))}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
    />
  );
}
