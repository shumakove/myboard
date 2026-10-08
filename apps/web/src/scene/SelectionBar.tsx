import {
  STYLE_KEYS,
  styleKeysOf,
  typeName,
  type StyleKey,
} from "./objectTypes";
import type { ObjectMeta, SceneObject } from "./sceneObjects";

/** Значение, которое показывает список, если у выделенных оно разное. */
const MIXED = "";

/** Кнопка панели: подпись и действие; `null` — кнопки нет. */
export type BarAction = (() => void) | null;

/**
 * Панель выделения:
 * - CVS-11: при смешанном выделении — оставить только объекты одного типа; свойства,
 *   общие для всех выделенных типов, меняются у всех разом;
 * - CVS-15, CVS-18: меню Arrange — выравнивание, распределение, порядок слоёв;
 * - CVS-17: группировка и разгруппировка; CVS-19: блокировка;
 * - CVS-20: меню More — копирование, вырезание, дублирование (и на телефоне, где нет
 *   контекстного меню);
 * - CVS-21: удаление выделенного;
 * - CVS-22: автор и даты одного выделенного объекта.
 */
export function SelectionBar({
  selected,
  onFilter,
  onStyle,
  onEditText,
  onDelete,
  onLock,
  onUnlock,
  onGroup,
  onUngroup,
  onArrange,
  onMore,
}: {
  selected: readonly SceneObject[];
  onFilter: (type: string) => void;
  onStyle: (key: StyleKey, value: string | number) => void;
  onEditText: BarAction;
  onDelete: BarAction;
  onLock: BarAction;
  onUnlock: BarAction;
  onGroup: BarAction;
  onUngroup: BarAction;
  /** Открыть меню у кнопки (элемент — для положения меню). */
  onArrange: ((button: HTMLElement) => void) | null;
  onMore: (button: HTMLElement) => void;
}) {
  if (selected.length === 0) return null;
  const counts = new Map<string, number>();
  for (const object of selected) {
    counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
  }
  const types = [...counts.keys()];
  const editable = selected.filter((o) => !o.locked);
  const shared =
    editable.length === 0
      ? []
      : (Object.keys(STYLE_KEYS) as StyleKey[]).filter((key) =>
          types.every((type) => styleKeysOf(type).includes(key)),
        );
  const [single] = selected;

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
              Only {typeName(type, true)} ({counts.get(type)})
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
      <Button label="Edit text" action={onEditText} />
      {onArrange && (
        <button
          type="button"
          aria-haspopup="menu"
          onClick={(event) => {
            onArrange(event.currentTarget);
          }}
        >
          Arrange
        </button>
      )}
      <Button label="Group" action={onGroup} />
      <Button label="Ungroup" action={onUngroup} />
      <Button label="Lock" action={onLock} />
      <Button label="Unlock" action={onUnlock} />
      <Button label="Delete" action={onDelete} />
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(event) => {
          onMore(event.currentTarget);
        }}
      >
        More
      </button>
      {selected.length === 1 && single && <ObjectInfo meta={single.meta} />}
    </div>
  );
}

function Button({ label, action }: { label: string; action: BarAction }) {
  if (action === null) return null;
  return (
    <button type="button" onClick={action}>
      {label}
    </button>
  );
}

/** CVS-22: кто и когда создал объект и изменил его последним. */
export function ObjectInfo({ meta }: { meta: ObjectMeta }) {
  return (
    <dl className="object-info" aria-label="Object info">
      <InfoRow
        term="Created"
        name={meta.createdBy}
        at={meta.createdAt}
        testId="object-created"
      />
      <InfoRow
        term="Modified"
        name={meta.updatedBy}
        at={meta.updatedAt}
        testId="object-modified"
      />
    </dl>
  );
}

function InfoRow({
  term,
  name,
  at,
  testId,
}: {
  term: string;
  name: string | undefined;
  at: string | undefined;
  testId: string;
}) {
  const date = at === undefined ? null : new Date(at);
  const valid = date !== null && !Number.isNaN(date.getTime());
  return (
    <div data-testid={testId}>
      <dt>{term}</dt>
      <dd>
        {name ? <span className="object-author">{name}</span> : "Unknown"}
        {valid && at !== undefined && (
          <>
            {", "}
            <time dateTime={at}>
              {date.toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </time>
          </>
        )}
      </dd>
    </div>
  );
}
