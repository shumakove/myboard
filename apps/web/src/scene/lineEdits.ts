import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import {
  LABEL_DEFAULTS,
  type Anchor,
  type LineEnd,
  type LineLabel,
} from "./connectors";
import { OBJECT_TYPES, type StyleKey } from "./objectTypes";
import {
  createObject,
  newObjectId,
  objectMap,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

/**
 * Правки соединительных линий в документе (T6.4). Точки линии хранятся относительно
 * её положения; здесь они приходят и уходят в координатах доски.
 */

/** Конец линии на доске: свободная точка или точка привязки объекта (CVS-26). */
export interface BoardEnd {
  point: Point;
  object?: string;
  anchor?: Anchor;
}

export type EndName = "start" | "end";

/** Положение линии на доске — начало координат её точек. */
export function linePosition(line: SceneObject): Point {
  return { x: line.x - line.offset.x, y: line.y - line.offset.y };
}

function relative(line: SceneObject, p: Point): Point {
  const at = linePosition(line);
  return { x: p.x - at.x, y: p.y - at.y };
}

function storedEnd(at: Point, end: BoardEnd): LineEnd {
  const stored: LineEnd = { x: end.point.x - at.x, y: end.point.y - at.y };
  if (end.object !== undefined && end.anchor !== undefined) {
    stored.object = end.object;
    stored.anchor = end.anchor;
  }
  return stored;
}

/** Запись полей одной линии с отметкой «изменил» (CVS-22). */
function writeLine(
  objects: Y.Map<unknown>,
  id: string,
  write: (map: Y.Map<unknown>) => void,
  actor: string,
): void {
  transact(objects, () => {
    const map = objectMap(objects, id);
    if (map === null) return;
    write(map);
    touch(map, actor);
  });
}

/** CON-01: новая линия от `start` до `end` поверх остальных; возвращает её id. */
export function createLine(
  objects: Y.Map<unknown>,
  start: BoardEnd,
  end: BoardEnd,
  actor: string,
  style: Partial<Record<StyleKey, string | number>> = {},
): string {
  let id = "";
  transact(objects, () => {
    id = createObject(objects, "line", start.point, "", actor, style, {
      width: OBJECT_TYPES.line.width,
      height: OBJECT_TYPES.line.height,
    });
    const map = objectMap(objects, id);
    map?.set("start", storedEnd(start.point, start));
    map?.set("end", storedEnd(start.point, end));
    map?.set("points", []);
  });
  return id;
}

/** Конец линии в точку доски — свободный или привязанный к объекту (CVS-26). */
export function setEnd(
  objects: Y.Map<unknown>,
  line: SceneObject,
  name: EndName,
  end: BoardEnd,
  actor: string,
): void {
  writeLine(
    objects,
    line.id,
    (map) => {
      map.set(name, storedEnd(linePosition(line), end));
    },
    actor,
  );
}

function writePoints(
  objects: Y.Map<unknown>,
  line: SceneObject,
  points: readonly Point[],
  actor: string,
): void {
  writeLine(
    objects,
    line.id,
    (map) => {
      map.set(
        "points",
        points.map((p) => relative(line, p)),
      );
    },
    actor,
  );
}

/** Промежуточные точки линии на доске (без концов). */
export function boardPoints(line: SceneObject): Point[] {
  return line.line?.path.slice(1, -1) ?? [];
}

/** Промежуточные точки линии — точками доски (точки изгиба, CON-01). */
export function setPoints(
  objects: Y.Map<unknown>,
  line: SceneObject,
  points: readonly Point[],
  actor: string,
): void {
  writePoints(objects, line, points, actor);
}

/** CON-06: удалить промежуточную точку линии. */
export function removePoint(
  objects: Y.Map<unknown>,
  line: SceneObject,
  index: number,
  actor: string,
): void {
  const points = boardPoints(line);
  if (index < 0 || index >= points.length) return;
  points.splice(index, 1);
  writePoints(objects, line, points, actor);
}

/**
 * CON-02: начало и конец меняются местами вместе с привязками, точки изгиба — в обратном
 * порядке, подписи остаются на своих местах. Наконечники остаются у начала и конца,
 * поэтому стрелка смотрит в другую сторону.
 */
export function swapEnds(
  objects: Y.Map<unknown>,
  line: SceneObject,
  actor: string,
): void {
  const data = line.line;
  if (data === null) return;
  writeLine(
    objects,
    line.id,
    (map) => {
      map.set("start", { ...data.end });
      map.set("end", { ...data.start });
      map.set(
        "points",
        [...data.points].reverse().map((p) => ({ ...p })),
      );
      const labels = labelsMap(map);
      for (const label of data.labels) {
        labelEntry(labels, label.id)?.set("position", 1 - label.position);
      }
    },
    actor,
  );
}

/** Привязан ли хоть один конец линии к объекту. */
export function isAttached(line: SceneObject): boolean {
  const data = line.line;
  return (
    data !== null &&
    (data.start.object !== undefined || data.end.object !== undefined)
  );
}

/** Концы линии, привязанные к объектам `ids` (все — если `ids` нет), становятся свободными. */
function freeEnds(
  map: Y.Map<unknown>,
  line: SceneObject,
  ids: ReadonlySet<string> | null,
): void {
  const data = line.line;
  if (data === null) return;
  const at = linePosition(line);
  const ends: [EndName, LineEnd, Point | undefined][] = [
    ["start", data.start, data.path[0]],
    ["end", data.end, data.path.at(-1)],
  ];
  for (const [name, end, point] of ends) {
    if (end.object === undefined || point === undefined) continue;
    if (ids !== null && !ids.has(end.object)) continue;
    map.set(name, { x: point.x - at.x, y: point.y - at.y });
  }
}

/** CVS-26: отвязать линию — концы остаются там, где были, но больше не следуют за объектами. */
export function detachLine(
  objects: Y.Map<unknown>,
  line: SceneObject,
  actor: string,
): void {
  writeLine(
    objects,
    line.id,
    (map) => {
      freeEnds(map, line, null);
    },
    actor,
  );
}

/**
 * Перед удалением объектов `removed` линии, привязанные к ним, отвязываются на месте:
 * иначе их концы вернулись бы в запасное положение.
 */
export function detachFrom(
  objects: Y.Map<unknown>,
  scene: readonly SceneObject[],
  removed: ReadonlySet<string>,
  actor: string,
): void {
  for (const line of scene) {
    if (line.line === null || removed.has(line.id)) continue;
    const { start, end } = line.line;
    const hit = [start.object, end.object].some(
      (id) => id !== undefined && removed.has(id),
    );
    if (!hit) continue;
    writeLine(
      objects,
      line.id,
      (map) => {
        freeEnds(map, line, removed);
      },
      actor,
    );
  }
}

// --- Подписи (CON-03, CON-04) ----------------------------------------------

/** Подписи линии — `Y.Map` id → `Y.Map` полей с текстом `Y.Text` (COL-01). */
function labelsMap(map: Y.Map<unknown>): Y.Map<unknown> {
  const current = map.get("labels");
  if (current instanceof Y.Map) return current as Y.Map<unknown>;
  const labels = new Y.Map<unknown>();
  if (typeof current === "object" && current !== null) {
    for (const [id, value] of Object.entries(current)) {
      labels.set(id, labelValue(value));
    }
  }
  map.set("labels", labels);
  return labels;
}

/** Подпись из JSON (копия, старая запись) — `Y.Map` с текстом `Y.Text`. */
export function labelValue(value: unknown): Y.Map<unknown> {
  const fields: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const { text } = fields;
  // Новый `Y.Map` не читается до записи в документ — текст ставится по исходным полям.
  const label = new Y.Map<unknown>();
  for (const [key, field] of Object.entries(fields)) {
    if (key !== "text") label.set(key, field);
  }
  label.set("text", new Y.Text(typeof text === "string" ? text : ""));
  return label;
}

/** Все подписи копии — для вставки (CVS-20). */
export function labelsValue(value: unknown): Y.Map<unknown> {
  const labels = new Y.Map<unknown>();
  if (typeof value === "object" && value !== null) {
    for (const [id, label] of Object.entries(value)) {
      labels.set(id, labelValue(label));
    }
  }
  return labels;
}

function labelEntry(labels: Y.Map<unknown>, id: string): Y.Map<unknown> | null {
  const value = labels.get(id);
  if (value instanceof Y.Map) return value as Y.Map<unknown>;
  if (value === undefined) return null;
  const converted = labelValue(value);
  labels.set(id, converted);
  return converted;
}

/** CON-03: новая подпись в доле `position` длины линии; возвращает её id. */
export function addLabel(
  objects: Y.Map<unknown>,
  lineId: string,
  position: number,
  actor: string,
): string {
  const id = newObjectId();
  writeLine(
    objects,
    lineId,
    (map) => {
      const label = labelValue({ ...LABEL_DEFAULTS, position });
      labelsMap(map).set(id, label);
    },
    actor,
  );
  return id;
}

/** Текст подписи для поля правки. */
export function labelText(
  objects: Y.Map<unknown>,
  lineId: string,
  labelId: string,
): Y.Text | null {
  let text: Y.Text | null = null;
  transact(objects, () => {
    const map = objectMap(objects, lineId);
    if (map === null) return;
    const label = labelEntry(labelsMap(map), labelId);
    const value = label?.get("text");
    text = value instanceof Y.Text ? value : null;
  });
  return text;
}

export type LabelFields = Partial<Omit<LineLabel, "id" | "text">>;

/** CON-03, CON-04: положение, ориентация, шрифт, размер, цвет подписи. */
export function setLabel(
  objects: Y.Map<unknown>,
  lineId: string,
  labelId: string,
  fields: LabelFields,
  actor: string,
): void {
  writeLine(
    objects,
    lineId,
    (map) => {
      const label = labelEntry(labelsMap(map), labelId);
      if (label === null) return;
      for (const [key, value] of Object.entries(fields)) label.set(key, value);
    },
    actor,
  );
}

export function removeLabel(
  objects: Y.Map<unknown>,
  lineId: string,
  labelId: string,
  actor: string,
): void {
  writeLine(
    objects,
    lineId,
    (map) => {
      labelsMap(map).delete(labelId);
    },
    actor,
  );
}
