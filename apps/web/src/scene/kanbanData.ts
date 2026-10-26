import * as Y from "yjs";
import type { Point } from "../realtime/messages";

/**
 * Канбан (T6.8, KBN-01…KBN-03) в документе — поля `Y.Map` объекта `type: "kanban"`:
 * - `columns` — `Y.Array` id столбцов по порядку (добавления двух участников сливаются);
 * - `titles` — `Y.Map` id столбца → `Y.Text` названия (правки названия сливаются по символам);
 * - `height` — высота доски канбана; ширина — число столбцов × `COLUMN_WIDTH`.
 * Карточка (`type: "card"`, KBN-02) в столбце: `parent` — id канбана, `cell` — id столбца,
 * `x`, `y` — относительно левого верхнего угла столбца (как объект в ячейке таблицы).
 */

export const KANBAN_TYPE = "kanban";
export const CARD_TYPE = "card";

/** Ширина столбца, единицы доски. */
export const COLUMN_WIDTH = 280;
/** Высота заголовка столбца: под ним начинаются карточки. */
export const HEADER_HEIGHT = 48;
/** Отступ карточек от края столбца и промежуток между ними. */
export const CARD_PADDING = 20;
export const CARD_GAP = 12;
/** Высота новой доски канбана. */
export const KANBAN_HEIGHT = 480;
/** Столбцы новой доски канбана (KBN-01). */
export const DEFAULT_COLUMNS: readonly string[] = [
  "To do",
  "In progress",
  "Done",
];

export interface KanbanColumn {
  id: string;
  title: string;
  /** Отступ от левого края канбана. */
  start: number;
}

/** Канбан на сцене: столбцы слева направо и размер рамки. */
export interface KanbanShape {
  columns: KanbanColumn[];
  width: number;
  height: number;
}

export interface ColumnRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Id нового столбца. */
export function columnId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Канбан из полей объекта (JSON `Y.Map`); без столбцов — `null`. */
export function readKanban(
  record: Record<string, unknown>,
): KanbanShape | null {
  const list = Array.isArray(record.columns) ? record.columns : [];
  const ids = [
    ...new Set(list.filter((id): id is string => typeof id === "string")),
  ].filter((id) => id !== "");
  if (ids.length === 0) return null;
  const titles = asRecord(record.titles);
  const columns = ids.map((id, index) => {
    const title = titles[id];
    return {
      id,
      title: typeof title === "string" ? title : "",
      start: index * COLUMN_WIDTH,
    };
  });
  const height =
    typeof record.height === "number" && Number.isFinite(record.height)
      ? Math.max(HEADER_HEIGHT, record.height)
      : KANBAN_HEIGHT;
  return { columns, width: columns.length * COLUMN_WIDTH, height };
}

/** Прямоугольник столбца относительно канбана; столбца нет — `null`. */
export function columnRect(kanban: KanbanShape, id: string): ColumnRect | null {
  const column = kanban.columns.find((c) => c.id === id);
  if (column === undefined) return null;
  return {
    x: column.start,
    y: 0,
    width: COLUMN_WIDTH,
    height: kanban.height,
  };
}

/** Столбец под точкой (относительно канбана); вне столбцов — `null`. */
export function columnAt(kanban: KanbanShape, point: Point): string | null {
  if (point.y < 0 || point.y > kanban.height) return null;
  const column = kanban.columns.find(
    (c) => point.x >= c.start && point.x < c.start + COLUMN_WIDTH,
  );
  return column?.id ?? null;
}

/** Название столбца для правки (`Y.Text`); поле создаётся, если его не было. */
export function columnTitle(kanban: Y.Map<unknown>, id: string): Y.Text {
  const titles = titleMap(kanban);
  const title = titles.get(id);
  if (title instanceof Y.Text) return title;
  const created = new Y.Text(typeof title === "string" ? title : "");
  titles.set(id, created);
  return created;
}

/** Названия столбцов как `Y.Map`; JSON-запись переводится в него. */
export function titleMap(kanban: Y.Map<unknown>): Y.Map<unknown> {
  const value = kanban.get("titles");
  if (value instanceof Y.Map) return value as Y.Map<unknown>;
  const map = kanbanFieldValue("titles", value) as Y.Map<unknown>;
  kanban.set("titles", map);
  return map;
}

/** Порядок столбцов как `Y.Array`; JSON-запись переводится в него. */
export function columnList(kanban: Y.Map<unknown>): Y.Array<string> {
  const value = kanban.get("columns");
  if (value instanceof Y.Array) return value as Y.Array<string>;
  const list = kanbanFieldValue("columns", value) as Y.Array<string>;
  kanban.set("columns", list);
  return list;
}

/**
 * Поле канбана из JSON (вставка копии, CVS-20): `columns` — `Y.Array`, `titles` — `Y.Map`
 * с `Y.Text`. Другое поле — `undefined`.
 */
export function kanbanFieldValue(key: string, value: unknown): unknown {
  if (key === "columns") {
    const list = new Y.Array<string>();
    const ids = Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string")
      : [];
    list.push([...new Set(ids)]);
    return list;
  }
  if (key === "titles") {
    const titles = new Y.Map<unknown>();
    for (const [id, title] of Object.entries(asRecord(value))) {
      titles.set(id, new Y.Text(typeof title === "string" ? title : ""));
    }
    return titles;
  }
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
