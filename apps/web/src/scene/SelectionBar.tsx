import { useEffect, useRef, useState } from "react";
import {
  MORE_TEXT_KEYS,
  STYLE_KEYS,
  typeName,
  typeSpec,
  type StyleKey,
  type StyleOption,
} from "./objectTypes";
import type { RecentColors } from "./recentColors";
import type { ObjectMeta, SceneObject } from "./sceneObjects";
import { shapeKind, shapeMarker } from "./shapes";
import { COLOR_KEYS, sharedStyleKeys, styleOptions } from "./styleOptions";
import {
  Button,
  FloatingPanel,
  IconButton,
  SelectField,
  Switch,
  TextField,
} from "../ui";

/** Значение, которое показывает список, если у выделенных оно разное. */
const MIXED = "";

/** Кнопка панели: подпись и действие; `null` — кнопки нет. */
export type BarAction = (() => void) | null;

/** STK-03: теги одного выделенного стикера или стопки. */
export interface TagActions {
  values: readonly string[];
  /** `false` — тег пустой, не добавлен. */
  add: (tag: string) => boolean;
  remove: (tag: string) => void;
}

/** SHP-04: недавние пользовательские цвета и выбор своего цвета. */
export interface ColorActions {
  recent: RecentColors;
  /** Выбран пользовательский цвет свойства `key`. */
  pick: (key: StyleKey, color: string) => void;
}

/** STK-03: показ имени автора на стикере. */
export interface AuthorToggle {
  shown: boolean;
  set: (shown: boolean) => void;
}

/**
 * Панель выделения:
 * - CVS-11: при смешанном выделении — оставить только объекты одного типа; свойства,
 *   общие для всех выделенных типов, меняются у всех разом;
 * - CVS-15, CVS-18: меню Arrange — выравнивание, распределение, порядок слоёв;
 * - CVS-17: группировка и разгруппировка; CVS-19: блокировка;
 * - CVS-20: меню More — копирование, вырезание, дублирование (и на телефоне, где нет
 *   контекстного меню);
 * - CVS-21: удаление выделенного;
 * - CVS-22: автор и даты одного выделенного объекта;
 * - TXT-01: у текста и документа шрифт, начертание, выравнивание, интервал и фон —
 *   под кнопкой Text style (панель остаётся в одну строку);
 * - STK-02: размер шрифта стикера — число или Auto (подгон под стикер);
 * - STK-03: теги стикера и стопки — под кнопкой Tags, показ автора — переключатель;
 * - SHP-01…SHP-03: вид фигуры, маркер BPMN, заливка, обводка, скругление, текст;
 * - SHP-04: свой цвет — под кнопкой Custom color, недавние свои цвета — в списках цветов.
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
  tags = null,
  author = null,
  colors,
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
  tags?: TagActions | null;
  author?: AuthorToggle | null;
  colors?: ColorActions;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  if (selected.length === 0) return null;
  const counts = new Map<string, number>();
  for (const object of selected) {
    counts.set(object.type, (counts.get(object.type) ?? 0) + 1);
  }
  const types = [...counts.keys()];
  const editable = selected.filter((o) => !o.locked);
  const recent = colors?.recent;
  const shared = editable.length === 0 ? [] : sharedStyleKeys(selected, recent);
  const colorKeys = shared.filter((key) => COLOR_KEYS.includes(key));
  const [single] = selected;

  return (
    <FloatingPanel
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
            <Button
              key={type}
              variant="ghost"
              onClick={() => {
                onFilter(type);
              }}
            >
              Only {typeName(type, true)} ({counts.get(type)})
            </Button>
          ))}
        </span>
      )}
      {shared
        .filter((key) => !MORE_TEXT_KEYS.includes(key))
        .map((key) => (
          <StyleSelect
            key={key}
            styleKey={key}
            selected={selected}
            recent={recent}
            onStyle={onStyle}
          />
        ))}
      {colors && colorKeys.length > 0 && (
        <Button
          variant="ghost"
          aria-expanded={customOpen}
          onClick={() => {
            setCustomOpen((open) => !open);
          }}
        >
          Custom color
        </Button>
      )}
      {colors && customOpen && colorKeys.length > 0 && (
        <span
          role="group"
          aria-label="Custom color"
          className="selection-more selection-custom"
        >
          {colorKeys.map((key) => (
            <CustomColor
              key={key}
              styleKey={key}
              selected={selected}
              onPick={colors.pick}
            />
          ))}
        </span>
      )}
      {shared.some((key) => MORE_TEXT_KEYS.includes(key)) && (
        <Button
          variant="ghost"
          aria-expanded={moreOpen}
          onClick={() => {
            setMoreOpen((open) => !open);
          }}
        >
          Text style
        </Button>
      )}
      {moreOpen && (
        <span role="group" aria-label="Text style" className="selection-more">
          {shared
            .filter((key) => MORE_TEXT_KEYS.includes(key))
            .map((key) => (
              <StyleSelect
                key={key}
                styleKey={key}
                selected={selected}
                recent={recent}
                onStyle={onStyle}
              />
            ))}
        </span>
      )}
      {author && (
        <Switch
          label="Show author"
          className="selection-switch"
          checked={author.shown}
          onChange={(event) => {
            author.set(event.target.checked);
          }}
        />
      )}
      {tags && (
        <Button
          variant="ghost"
          aria-expanded={tagsOpen}
          onClick={() => {
            setTagsOpen((open) => !open);
          }}
        >
          Tags{tags.values.length > 0 ? ` (${String(tags.values.length)})` : ""}
        </Button>
      )}
      {tags && tagsOpen && <TagEditor tags={tags} />}
      <BarButton label="Edit text" action={onEditText} />
      {onArrange && (
        <Button
          variant="ghost"
          aria-haspopup="menu"
          onClick={(event) => {
            onArrange(event.currentTarget);
          }}
        >
          Arrange
        </Button>
      )}
      <BarButton label="Group" action={onGroup} />
      <BarButton label="Ungroup" action={onUngroup} />
      <BarButton label="Lock" action={onLock} />
      <BarButton label="Unlock" action={onUnlock} />
      <BarButton label="Delete" action={onDelete} />
      <Button
        variant="ghost"
        aria-haspopup="menu"
        onClick={(event) => {
          onMore(event.currentTarget);
        }}
      >
        More
      </Button>
      {selected.length === 1 && single && <ObjectInfo meta={single.meta} />}
    </FloatingPanel>
  );
}

/**
 * CVS-11: список значений свойства у всех выделенных; разные значения — Mixed. У объекта
 * без записанного значения показывается значение его типа.
 */
function StyleSelect({
  styleKey: key,
  selected,
  recent,
  onStyle,
}: {
  styleKey: StyleKey;
  selected: readonly SceneObject[];
  recent: RecentColors | undefined;
  onStyle: (key: StyleKey, value: string | number) => void;
}) {
  const values = new Set(selected.map((o) => styleValue(o, key)));
  const [only] = values;
  const current =
    values.size === 1 && only !== undefined ? String(only) : MIXED;
  const { label } = STYLE_KEYS[key];
  const listed = styleOptions(key, selected, recent);
  // Значение не из списка (свой цвет) — тоже в списке, чтобы его было видно.
  const options: StyleOption[] =
    current === MIXED || listed.some((o) => String(o.value) === current)
      ? listed
      : [...listed, { value: only ?? current, label: current }];
  return (
    <SelectField
      label={label}
      className="selection-style"
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
      {groupOptions(options).map(([group, items], index) =>
        group === undefined ? (
          items.map(optionView)
        ) : (
          <optgroup key={`${group}-${String(index)}`} label={group}>
            {items.map(optionView)}
          </optgroup>
        ),
      )}
    </SelectField>
  );
}

function optionView(option: StyleOption) {
  return (
    <option key={String(option.value)} value={String(option.value)}>
      {option.label}
    </option>
  );
}

/** Подряд идущие значения одной группы — вместе (наборы фигур, недавние цвета). */
function groupOptions(
  options: readonly StyleOption[],
): [string | undefined, StyleOption[]][] {
  const groups: [string | undefined, StyleOption[]][] = [];
  for (const option of options) {
    const last = groups.at(-1);
    if (last !== undefined && last[0] === option.group) last[1].push(option);
    else groups.push([option.group, [option]]);
  }
  return groups;
}

/**
 * Значение свойства у объекта: записанное или значение типа. SHP-02: маркер — действующий
 * маркер вида фигуры.
 */
function styleValue(
  object: SceneObject,
  key: StyleKey,
): string | number | undefined {
  if (key === "marker") {
    return (
      shapeMarker(shapeKind(object.style.shape), object.style.marker) ??
      undefined
    );
  }
  return object.style[key] ?? typeSpec(object.type)?.style[key];
}

/**
 * SHP-04: свой цвет свойства — поле выбора цвета браузера. Цвет применяется, когда выбор
 * закончен (событие `change`), а не на каждом шаге в окне выбора цвета.
 */
function CustomColor({
  styleKey: key,
  selected,
  onPick,
}: {
  styleKey: StyleKey;
  selected: readonly SceneObject[];
  onPick: (key: StyleKey, color: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    const input = ref.current;
    if (input === null) return;
    const changed = () => {
      pick.current(key, input.value);
    };
    input.addEventListener("change", changed);
    return () => {
      input.removeEventListener("change", changed);
    };
  }, [key]);
  const [first] = selected;
  const value = first === undefined ? undefined : styleValue(first, key);
  const initial =
    typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
      ? value.toLowerCase()
      : "#000000";
  return (
    <label className="ui-field ui-field--inline selection-color">
      {`Custom ${STYLE_KEYS[key].label.toLowerCase()}`}
      <input ref={ref} type="color" defaultValue={initial} />
    </label>
  );
}

/** STK-03: теги объекта — убрать каждый, добавить новый (Enter или Add). */
function TagEditor({ tags }: { tags: TagActions }) {
  const [draft, setDraft] = useState("");
  return (
    <span role="group" aria-label="Tags" className="selection-more">
      {tags.values.length > 0 && (
        <ul className="selection-tags">
          {tags.values.map((tag) => (
            <li key={tag} className="selection-tag">
              {tag}
              <IconButton
                label={`Remove tag ${tag}`}
                title={`Remove tag ${tag}`}
                onClick={() => {
                  tags.remove(tag);
                }}
              >
                ×
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="selection-tag-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (tags.add(draft)) setDraft("");
        }}
      >
        <TextField
          label="Add tag"
          className="ui-field--inline"
          value={draft}
          maxLength={40}
          placeholder="tag"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
        <Button type="submit" disabled={draft.trim().replace(/^#+/, "") === ""}>
          Add
        </Button>
      </form>
    </span>
  );
}

function BarButton({ label, action }: { label: string; action: BarAction }) {
  if (action === null) return null;
  return (
    <Button variant="ghost" onClick={action}>
      {label}
    </Button>
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
