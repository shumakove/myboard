import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { boundsOf, type Frame } from "./geometry";
import {
  isConnectable,
  pointsBounds,
  readLineData,
  resolveLine,
  routeOf,
  type LineData,
  type LineShape,
} from "./connectors";
import type { DeltaOp } from "../richtext/delta";
import { readDrawing, type DrawingShape } from "./drawingShape";
import {
  FRAME_TYPE,
  readFrameFields,
  type FrameFields,
  type FrameOptions,
} from "./frameOptions";
import {
  cellRect,
  readTable,
  resizeTable,
  TABLE_TYPE,
  type TableShape,
} from "./tableData";
import {
  columnRect,
  KANBAN_TYPE,
  readKanban,
  type KanbanShape,
} from "./kanbanData";
import { MINDMAP_TYPE, readMindmap, type MindmapShape } from "./mindmapData";
import { DICE_TYPE, readDice, type DiceShape } from "./diceData";
import { FLIP_TYPE, readFlip, type FlipShape } from "./flipData";
import { IMAGE_TYPE, readImage, type ImageShape } from "./imageData";
import {
  REACTION_TYPE,
  readReaction,
  type ReactionShape,
} from "./reactionData";
import {
  GROUP_TYPE,
  isRichText,
  OBJECT_TYPES,
  STYLE_KEYS,
  TAGGED_TYPES,
  type ObjectType,
  type StyleKey,
} from "./objectTypes";

export { GROUP_TYPE };

/** CVS-22: кто и когда создал объект и изменил его последним (ISO 8601). */
export interface ObjectMeta {
  createdBy?: string;
  createdAt?: string;
  updatedBy?: string;
  updatedAt?: string;
}

/**
 * Объект сцены в `objects` документа (ARCHITECTURE.md, раздел 6): `Y.Map` с полями
 * `type`, `parent`, `x`, `y` (относительно родителя), `width`, `height`, `rotation`
 * (градусы), `z` (порядок слоёв среди объектов того же родителя, целое), свойствами
 * оформления, текстом `text` — `Y.Text`, чтобы одновременные правки текста сливались
 * по символам (COL-01), признаком `locked` (CVS-19) и полями автора и дат (CVS-22).
 * Каждое поле — свой ключ `Y.Map`: правки разных полей одного объекта не затирают друг друга.
 */
export interface SceneObject extends Frame {
  id: string;
  type: string;
  parent: string | null;
  z: number;
  text: string;
  /**
   * Текст и документ (TXT-01…TXT-08): содержимое `Y.Text` с форматированием — дельта;
   * у остальных типов `null`.
   */
  rich: DeltaOp[] | null;
  /** Теги объекта (STK-03, KBN-02) — ищутся вместе с текстом (CVS-08). */
  tags: string[];
  /** STK-03: имя автора показано на стикере (поле `showAuthor`, по умолчанию — да). */
  showAuthor: boolean;
  style: Partial<Record<StyleKey, string | number>>;
  /** Начало координат родителя на доске; `x`, `y` рамки — уже в координатах доски. */
  origin: Point;
  /**
   * Сдвиг рамки от записанного положения. У группы рамка вычисляется по её объектам,
   * а `x`, `y` в документе — только начало координат детей; у остальных объектов — 0.
   */
  offset: Point;
  /** CVS-19: заблокирован сам объект или его группа. */
  locked: boolean;
  meta: ObjectMeta;
  /**
   * Соединительная линия (T6.4): концы, точки изгиба и подписи, положение на доске;
   * у остальных типов `null`. Рамка линии — описанный прямоугольник её точек.
   */
  line: LineShape | null;
  /**
   * Рисунок (T6.5): кисть и точки штриха в координатах рамки, растянутые под её размер
   * (DRW-06); у остальных типов `null`.
   */
  drawing: DrawingShape | null;
  /** Фрейм (T6.6): пропорции, скрытие и блокировка содержимого; у остальных `null`. */
  frameOptions: FrameOptions | null;
  /** FRM-04: объект внутри фрейма со скрытым содержимым — не показывается на холсте. */
  hidden: boolean;
  /** Таблица (T6.7): столбцы, строки и ячейки; у остальных типов `null`. */
  table: TableShape | null;
  /** Канбан (T6.8): столбцы и их названия; у остальных типов `null`. */
  kanban: KanbanShape | null;
  /**
   * Интеллект-карта (T6.9): узлы и их раскладка; у остальных типов `null`. Записанные
   * `x`, `y` карты — середина левого края корня, рамка начинается выше на `anchorY`.
   */
  mindmap: MindmapShape | null;
  /** Реакция (T6.11): изображение из набора (RCT-04); у остальных типов `null`. */
  reaction: ReactionShape | null;
  /** Флип-карточка (T6.11): стороны и переворот (FLP-01…FLP-03); у остальных `null`. */
  flip: FlipShape | null;
  /** Кубик (T6.11): грани и последнее значение (DICE-01, DICE-02); у остальных `null`. */
  dice: DiceShape | null;
  /** Изображение (T7.1): файл, обрезка, маска, отражение (IMG-01…IMG-07); иначе `null`. */
  image: ImageShape | null;
  /**
   * TBL-05: ячейка таблицы-родителя («строка:столбец»), в которой лежит объект; KBN-02: id
   * столбца канбана-родителя, в котором лежит карточка. `x`, `y` объекта в документе —
   * относительно левого верхнего угла ячейки или столбца. Вне таблицы и канбана — `null`.
   */
  cell: string | null;
}

/** Изменение рамки и оформления объекта; рамка — в координатах доски. */
export type ObjectPatch = Partial<Frame & Record<StyleKey, string | number>>;

const META_KEYS = ["createdBy", "createdAt", "updatedBy", "updatedAt"] as const;

/** Id объекта: 16 случайных байт. `crypto.randomUUID` недоступен без HTTPS (LAN по http). */
export function newObjectId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type RawObject = Omit<
  SceneObject,
  "origin" | "offset" | "locked" | "line" | "frameOptions" | "hidden"
> & {
  lockedSelf: boolean;
  lineData: LineData | null;
  frameFields: FrameFields | null;
};

/**
 * Все объекты сцены в координатах доски в порядке отрисовки: соседи снизу вверх по `z`,
 * группа и фрейм — перед своими объектами (CVS-17, FRM-01). Неверные записи и пустые
 * группы пропускаются. Блокировка родителя переходит на детей, кроме фрейма,
 * заблокированного без содержимого (FRM-05); дети фрейма со скрытым содержимым —
 * `hidden` (FRM-04).
 */
export function readScene(objects: Y.Map<unknown>): SceneObject[] {
  const raw = new Map<string, RawObject>();
  for (const [id, value] of objects.entries()) {
    const object = readObject(id, value);
    if (object !== null) raw.set(id, object);
  }
  const children = new Map<string | null, RawObject[]>();
  const parents = new Map<string, string | null>();
  for (const object of raw.values()) {
    const key = hasValidParent(object, raw) ? object.parent : null;
    parents.set(object.id, key);
    const list = children.get(key) ?? [];
    list.push(object);
    children.set(key, list);
  }
  const targets = connectableFrames(raw, parents);

  const scene: SceneObject[] = [];
  const visit = (
    object: RawObject,
    origin: Point,
    locked: boolean,
    hidden: boolean,
  ): void => {
    const position = { x: object.x + origin.x, y: object.y + origin.y };
    const lockedNow = locked || object.lockedSelf;
    const { frameFields } = object;
    const kidsLocked =
      locked || (object.lockedSelf && (frameFields?.lockContent ?? true));
    const kidsHidden = hidden || frameFields?.contentHidden === true;
    const at = scene.length;
    const kids: SceneObject[] = [];
    for (const child of sorted(children.get(object.id))) {
      const before = scene.length;
      const shift = slotOffset(object, child.cell);
      visit(
        child,
        { x: position.x + shift.x, y: position.y + shift.y },
        kidsLocked,
        kidsHidden,
      );
      const placed = scene[before];
      if (placed?.id === child.id) kids.push(placed);
    }
    let frame: Frame = {
      ...position,
      width: object.width,
      height: object.height,
      rotation: object.rotation,
    };
    if (object.type === GROUP_TYPE) {
      const bounds = boundsOf(kids);
      if (bounds === null) return; // пустая группа не рисуется
      frame = { ...bounds, rotation: 0 };
    }
    // TBL-01: рамка таблицы — сумма ширин столбцов и высот строк.
    const { table, kanban, mindmap } = object;
    if (table !== null) {
      frame = { ...frame, width: table.width, height: table.height };
    }
    // KBN-01: ширина канбана — по числу столбцов.
    if (kanban !== null) {
      frame = { ...frame, width: kanban.width, height: kanban.height };
    }
    // MAP-01: рамка карты — по раскладке узлов, корень стоит в записанной точке.
    if (mindmap !== null) {
      frame = {
        ...frame,
        y: frame.y - mindmap.anchorY,
        width: mindmap.width,
        height: mindmap.height,
        rotation: 0,
      };
    }
    // CVS-26: привязанный конец линии — в точке привязки объекта, где бы тот ни был.
    const line =
      object.lineData === null
        ? null
        : resolveLine(
            object.lineData,
            position,
            targets,
            object.style.lineStyle,
          );
    if (line !== null) frame = { ...pointsBounds(routeOf(line)), rotation: 0 };
    const {
      id,
      type,
      parent,
      z,
      rich,
      tags,
      showAuthor,
      style,
      meta,
      drawing,
      cell,
      reaction,
      flip,
      dice,
      image,
    } = object;
    // CVS-08: линию находят по тексту её подписей, таблицу — по тексту ячеек, канбан —
    // по названиям столбцов, интеллект-карту — по названиям узлов, флип-карточку — по
    // тексту обеих сторон (T6.11).
    const text =
      line !== null
        ? line.labels.map((l) => l.text).join("\n")
        : table !== null
          ? [...table.cells.values()].map((c) => c.text).join("\n")
          : kanban !== null
            ? kanban.columns.map((c) => c.title).join("\n")
            : mindmap !== null
              ? [...mindmap.byId.values()].map((n) => n.text).join("\n")
              : flip !== null
                ? [flip.front.text, flip.back.text].join("\n")
                : object.text;
    scene.splice(at, 0, {
      id,
      type,
      parent,
      z,
      text,
      rich,
      tags,
      showAuthor,
      style,
      meta,
      ...frame,
      origin,
      offset: { x: frame.x - position.x, y: frame.y - position.y },
      locked: lockedNow,
      line,
      drawing,
      frameOptions:
        frameFields === null
          ? null
          : { ...frameFields, contentLocked: kidsLocked },
      hidden,
      table,
      kanban,
      mindmap,
      reaction,
      flip,
      dice,
      image,
      cell,
    });
  };
  for (const root of sorted(children.get(null))) {
    visit(root, { x: 0, y: 0 }, false, false);
  }
  return scene;
}

/**
 * Рамки на доске объектов, к которым привязывают линии (CVS-26): положение — сумма
 * координат по цепочке родителей.
 */
function connectableFrames(
  raw: ReadonlyMap<string, RawObject>,
  parents: ReadonlyMap<string, string | null>,
): Map<string, Frame> {
  const positions = new Map<string, { x: number; y: number }>();
  const positionOf = (object: RawObject): { x: number; y: number } => {
    const known = positions.get(object.id);
    if (known !== undefined) return known;
    const parentId = parents.get(object.id) ?? null;
    const parent = parentId === null ? undefined : raw.get(parentId);
    const base = parent === undefined ? { x: 0, y: 0 } : positionOf(parent);
    const shift =
      parent === undefined ? ORIGIN : slotOffset(parent, object.cell);
    const position = {
      x: base.x + shift.x + object.x,
      y: base.y + shift.y + object.y,
    };
    positions.set(object.id, position);
    return position;
  };
  const frames = new Map<string, Frame>();
  for (const object of raw.values()) {
    if (!isConnectable(object.type)) continue;
    const { rotation, table, kanban, mindmap } = object;
    const width =
      table?.width ?? kanban?.width ?? mindmap?.width ?? object.width;
    const height =
      table?.height ?? kanban?.height ?? mindmap?.height ?? object.height;
    const { x, y } = positionOf(object);
    const top = mindmap === null ? y : y - mindmap.anchorY;
    frames.set(object.id, { x, y: top, width, height, rotation });
  }
  return frames;
}

const ORIGIN: Point = { x: 0, y: 0 };

/** Родитель с местами для объектов: ячейки таблицы и столбцы канбана. */
type SlotParent = Pick<SceneObject, "table" | "kanban">;

/**
 * Место объекта в родителе — ячейка таблицы (TBL-05) или столбец канбана (KBN-02),
 * относительно угла родителя; у фрейма и группы мест нет — `null`.
 */
export function slotRect(
  parent: SlotParent,
  cell: string | null,
): { x: number; y: number; width: number; height: number } | null {
  if (cell === null) return null;
  if (parent.table !== null) return cellRect(parent.table, cell);
  if (parent.kanban !== null) return columnRect(parent.kanban, cell);
  return null;
}

/**
 * Сдвиг начала координат объекта в ячейке или столбце от угла родителя. Места, которого
 * больше нет (строку или столбец удалили одновременно), — угол родителя.
 */
function slotOffset(parent: SlotParent, cell: string | null): Point {
  const rect = slotRect(parent, cell);
  return rect === null ? ORIGIN : { x: rect.x, y: rect.y };
}

function sorted(list: RawObject[] | undefined): RawObject[] {
  return [...(list ?? [])].sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : 1));
}

/** Родитель есть в документе и цепочка родителей не замкнута. */
function hasValidParent(
  object: RawObject,
  all: ReadonlyMap<string, RawObject>,
): boolean {
  const seen = new Set([object.id]);
  let parent = object.parent;
  while (parent !== null) {
    const next = all.get(parent);
    if (next === undefined || seen.has(parent)) return false;
    seen.add(parent);
    parent = next.parent;
  }
  return true;
}

function readObject(id: string, value: unknown): RawObject | null {
  const data: unknown = value instanceof Y.Map ? value.toJSON() : value;
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const { type, x, y, width, height } = record;
  if (
    typeof type !== "string" ||
    !isNumber(x) ||
    !isNumber(y) ||
    !isNumber(width) ||
    !isNumber(height)
  ) {
    return null;
  }
  const style: SceneObject["style"] = {};
  for (const key of Object.keys(STYLE_KEYS) as StyleKey[]) {
    const v = record[key];
    if (typeof v === "string" || isNumber(v)) style[key] = v;
  }
  const meta: ObjectMeta = {};
  for (const key of META_KEYS) {
    const v = record[key];
    if (typeof v === "string") meta[key] = v;
  }
  return {
    id,
    type,
    parent: typeof record.parent === "string" ? record.parent : null,
    x,
    y,
    width,
    height,
    rotation: isNumber(record.rotation) ? record.rotation : 0,
    z: isNumber(record.z) ? record.z : 0,
    text: typeof record.text === "string" ? record.text : "",
    rich: isRichText(type) ? richContent(value, record.text) : null,
    tags: readTags(record.tags),
    showAuthor: record.showAuthor !== false,
    style,
    lockedSelf: record.locked === true,
    meta,
    lineData: type === "line" ? readLineData(record) : null,
    drawing: type === "drawing" ? readDrawing(record, width, height) : null,
    frameFields: type === FRAME_TYPE ? readFrameFields(record) : null,
    table: type === TABLE_TYPE ? readTable(record) : null,
    kanban: type === KANBAN_TYPE ? readKanban(record) : null,
    mindmap: type === MINDMAP_TYPE ? readMindmap(record) : null,
    reaction: type === REACTION_TYPE ? readReaction(record) : null,
    flip: type === FLIP_TYPE ? readFlip(record) : null,
    dice: type === DICE_TYPE ? readDice(record) : null,
    image: type === IMAGE_TYPE ? readImage(record) : null,
    cell: typeof record.cell === "string" ? record.cell : null,
  };
}

/** Дельта текста объекта: `Y.Text` с форматированием или простая строка записи JSON. */
function richContent(value: unknown, text: unknown): DeltaOp[] {
  const field: unknown = value instanceof Y.Map ? value.get("text") : undefined;
  if (field instanceof Y.Text) return field.toDelta() as DeltaOp[];
  return typeof text === "string" && text !== "" ? [{ insert: text }] : [];
}

/**
 * Теги — `Y.Array` строк (после `toJSON` — массив) под ключом `tags`; одинаковые и
 * пустые отбрасываются (docs/decisions.md, T5.5).
 */
function readTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag) => tag !== "");
  return [...new Set(tags)];
}

/** Теги объекта — `Y.Array` строк: одновременные добавления разных тегов сливаются. */
export function writeTags(map: Y.Map<unknown>, tags: readonly string[]): void {
  const array = new Y.Array<string>();
  array.push([...tags]);
  map.set("tags", array);
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Следующий `z`: новый объект встаёт поверх остальных. Учитываются и объекты,
 * записанные JSON-значением, а не `Y.Map` (BUG-008).
 */
export function topZ(objects: Y.Map<unknown>): number {
  let top = 0;
  for (const value of objects.values()) {
    const z: unknown =
      value instanceof Y.Map
        ? value.get("z")
        : typeof value === "object" && value !== null
          ? (value as Record<string, unknown>).z
          : undefined;
    if (isNumber(z)) top = Math.max(top, Math.ceil(z));
  }
  return top + 1;
}

/** CVS-22: поля «создал» и «изменил» нового объекта. */
export function creationMeta(
  actor: string,
  now: Date = new Date(),
): Required<ObjectMeta> {
  const at = now.toISOString();
  return { createdBy: actor, createdAt: at, updatedBy: actor, updatedAt: at };
}

/** CVS-22: отметка последнего изменения объекта. */
export function touch(
  map: Y.Map<unknown>,
  actor: string,
  now: Date = new Date(),
): void {
  map.set("updatedBy", actor);
  map.set("updatedAt", now.toISOString());
}

/**
 * CVS-09: новый объект типа `type` с левым верхним углом в точке `at` (верхний уровень).
 * `text` — строка или, у текста и документа, дельта с форматированием (TXT-08);
 * `actor` — имя автора (CVS-22); `style` — оформление поверх значений типа (TXT-05);
 * `size` — размер, если он не размер типа (вид фигуры, SHP-01). Возвращает id объекта.
 */
export function createObject(
  objects: Y.Map<unknown>,
  type: ObjectType,
  at: Point,
  text: string | readonly DeltaOp[] = "",
  actor = "",
  style: Partial<Record<StyleKey, string | number>> = {},
  size: { width: number; height: number } = OBJECT_TYPES[type],
): string {
  const spec = OBJECT_TYPES[type];
  const id = newObjectId();
  transact(objects, () => {
    const object = new Y.Map<unknown>();
    object.set("type", type);
    object.set("parent", null);
    object.set("x", at.x);
    object.set("y", at.y);
    object.set("width", size.width);
    object.set("height", size.height);
    object.set("rotation", 0);
    object.set("z", topZ(objects));
    for (const [key, value] of Object.entries({
      ...spec.style,
      ...style,
    }))
      object.set(key, value);
    const content = new Y.Text(typeof text === "string" ? text : undefined);
    object.set("text", content);
    if (typeof text !== "string") content.applyDelta([...text]);
    // STK-03: пустой список тегов сразу — одновременные первые теги двух участников
    // попадут в один `Y.Array`, а не затрут друг друга.
    if (TAGGED_TYPES.includes(type)) {
      const tags = new Y.Array<string>();
      object.set("tags", tags);
    }
    for (const [key, value] of Object.entries(creationMeta(actor)))
      object.set(key, value);
    objects.set(id, object);
  });
  return id;
}

/** Правки документа одной транзакцией: у других участников они появляются разом. */
export function transact(objects: Y.Map<unknown>, write: () => void): void {
  if (objects.doc === null) write();
  else objects.doc.transact(write);
}

/**
 * Объект как `Y.Map`: запись JSON (например, записанная до T5.2) переводится в `Y.Map`,
 * текст — в `Y.Text`. `null` — объекта нет.
 */
export function objectMap(
  objects: Y.Map<unknown>,
  id: string,
): Y.Map<unknown> | null {
  const value = objects.get(id);
  if (value instanceof Y.Map) return value as Y.Map<unknown>;
  if (typeof value !== "object" || value === null) return null;
  const map = new Y.Map<unknown>();
  for (const [key, field] of Object.entries(value as Record<string, unknown>)) {
    map.set(
      key,
      key === "text" && typeof field === "string" ? new Y.Text(field) : field,
    );
  }
  objects.set(id, map);
  return map;
}

/** Текст объекта для редактирования; поле создаётся, если его не было. */
export function objectText(objects: Y.Map<unknown>, id: string): Y.Text | null {
  const map = objectMap(objects, id);
  if (map === null) return null;
  const text = map.get("text");
  if (text instanceof Y.Text) return text;
  const created = new Y.Text(typeof text === "string" ? text : "");
  map.set("text", created);
  return created;
}

/**
 * Запись полей объектов как есть (`z`, `parent`, `locked`…) одной транзакцией;
 * каждый изменённый объект получает отметку «изменил» (CVS-22).
 */
export function writeFields(
  objects: Y.Map<unknown>,
  changes: ReadonlyMap<string, Record<string, unknown>>,
  actor: string,
): void {
  if (changes.size === 0) return;
  const now = new Date();
  transact(objects, () => {
    for (const [id, fields] of changes) {
      const map = objectMap(objects, id);
      if (map === null) continue;
      for (const [key, value] of Object.entries(fields)) map.set(key, value);
      touch(map, actor, now);
    }
  });
}

/**
 * Изменения рамки и оформления нескольких объектов одной транзакцией. Рамка переводится
 * в координаты относительно родителя; у группы сдвиг рамки двигает начало координат её
 * объектов. `actor` — кто изменил (CVS-22).
 */
export function patchObjects(
  objects: Y.Map<unknown>,
  patches: ReadonlyMap<SceneObject, ObjectPatch>,
  actor = "",
): void {
  const changes = new Map<string, Record<string, unknown>>();
  const tables = new Map<string, { width?: number; height?: number }>();
  for (const [object, patch] of patches) {
    const fields: Record<string, unknown> = {};
    // CVS-14: размер таблицы меняется размерами её столбцов и строк.
    const { width, height } = patch;
    if (object.table !== null && (width ?? height) !== undefined) {
      tables.set(object.id, { width, height });
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === "x" && typeof value === "number") {
        fields.x = value - object.origin.x - object.offset.x;
      } else if (key === "y" && typeof value === "number") {
        fields.y = value - object.origin.y - object.offset.y;
      } else if (!derivedFrame(object.type, key)) {
        fields[key] = value;
      }
    }
    changes.set(object.id, fields);
  }
  transact(objects, () => {
    writeFields(objects, changes, actor);
    for (const [id, size] of tables) {
      const map = objectMap(objects, id);
      if (map !== null) resizeTable(map, size);
    }
  });
}

/**
 * Поле рамки, которое вычисляется, а не хранится: размер группы — по её объектам,
 * размер и поворот линии — по её точкам (T6.4), размер таблицы — по столбцам и строкам,
 * ширина канбана — по числу столбцов (T6.8), размер и поворот интеллект-карты — по её
 * узлам (T6.9).
 */
function derivedFrame(type: string, key: string): boolean {
  if (type === MINDMAP_TYPE) {
    return key === "width" || key === "height" || key === "rotation";
  }
  if (type === GROUP_TYPE || type === TABLE_TYPE) {
    return key === "width" || key === "height";
  }
  if (type === KANBAN_TYPE) return key === "width";

  if (type === "line") {
    return key === "width" || key === "height" || key === "rotation";
  }
  return false;
}
