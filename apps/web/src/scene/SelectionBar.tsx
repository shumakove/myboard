import {
  STYLE_KEYS,
  styleKeysOf,
  typeSpec,
  type StyleKey,
} from "./objectTypes";
import type { SceneObject } from "./sceneObjects";

/** Значение, которое показывает список, если у выделенных оно разное. */
const MIXED = "";

/**
 * Панель выделения:
 * - CVS-11: при смешанном выделении — оставить только объекты одного типа; свойства,
 *   общие для всех выделенных типов, меняются у всех разом;
 * - CVS-21: удаление выделенного.
 */
export function SelectionBar({
  selected,
  onFilter,
  onStyle,
  onEditText,
  onDelete,
}: {
  selected: readonly SceneObject[];
  onFilter: (type: string) => void;
  onStyle: (key: StyleKey, value: string | number) => void;
  onEditText: (() => void) | null;
  onDelete: () => void;
}) {
  if (selected.length === 0) return null;
  const counts = new Map<string, number>();
  for (const object of selected) {
    counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
  }
  const types = [...counts.keys()];
  const shared = (Object.keys(STYLE_KEYS) as StyleKey[]).filter((key) =>
    types.every((type) => styleKeysOf(type).includes(key)),
  );

  return (
    <div
      className="selection-bar"
      role="toolbar"
      aria-label="Selection"
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <span className="selection-count">{selected.length} selected</span>
      {types.length > 1 && (
        <span role="group" aria-label="Keep only" className="selection-filter">
          {types.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => {
                onFilter(type);
              }}
            >
              Only {typeSpec(type)?.plural ?? type} ({counts.get(type)})
            </button>
          ))}
        </span>
      )}
      {shared.map((key) => {
        const values = new Set(selected.map((o) => o.style[key]));
        const [only] = values;
        const current =
          values.size === 1 && only !== undefined ? String(only) : MIXED;
        const { label, options } = STYLE_KEYS[key];
        return (
          <label key={key} className="selection-style">
            {label}
            <select
              value={current}
              onChange={(event) => {
                const option = options.find(
                  (o) => String(o.value) === event.target.value,
                );
                if (option) onStyle(key, option.value);
              }}
            >
              {current === MIXED && (
                <option value={MIXED} disabled>
                  Mixed
                </option>
              )}
              {options.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      {onEditText && (
        <button type="button" onClick={onEditText}>
          Edit text
        </button>
      )}
      <button type="button" onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
