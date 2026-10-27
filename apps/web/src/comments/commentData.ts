import * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { center, rotateVector } from "../scene/geometry";
import { newObjectId, type SceneObject } from "../scene/sceneObjects";

/**
 * Комментарии доски (T6.10) — корень `comments` документа Yjs: id → ветка (`Y.Map`).
 * Ветка хранит привязку к объекту или к точке холста (CMT-01), сообщения (`Y.Array`),
 * признак «решено» (CMT-02) и цвет (CMT-03). Непрочитанные документ не хранит — они свои
 * у каждого участника (`commentReads.ts`).
 */

/**
 * CMT-01: привязка ветки. К объекту — доля ширины и высоты его рамки (`u`, `v`) без
 * поворота: метка едет, тянется и поворачивается вместе с объектом. К точке — координаты
 * доски.
 */
export type CommentAnchor =
  | { object: string; u: number; v: number }
  | { object: null; x: number; y: number };

export interface CommentMessage {
  id: string;
  /** Имя автора из сессии: владелец — имя учётки, участник — введённое имя. */
  author: string;
  text: string;
  /** Момент отправки, ISO 8601. */
  at: string;
}

export interface CommentThread {
  id: string;
  anchor: CommentAnchor;
  color: string;
  resolved: boolean;
  messages: CommentMessage[];
  createdAt: string;
}

/** CMT-03: цвета меток комментариев. */
export const COMMENT_COLORS: readonly { name: string; value: string }[] = [
  { name: "Yellow", value: "#f9a825" },
  { name: "Orange", value: "#ef6c00" },
  { name: "Red", value: "#e53935" },
  { name: "Pink", value: "#d81b60" },
  { name: "Purple", value: "#8e24aa" },
  { name: "Blue", value: "#1e88e5" },
  { name: "Green", value: "#43a047" },
  { name: "Gray", value: "#757575" },
];

export const DEFAULT_COMMENT_COLOR = COMMENT_COLORS[0]?.value ?? "#f9a825";

/** Ветки документа по времени создания; неверные записи пропускаются. */
export function readThreads(comments: Y.Map<unknown>): CommentThread[] {
  const threads: CommentThread[] = [];
  comments.forEach((value, id) => {
    const thread = value instanceof Y.Map ? readThread(id, value) : null;
    if (thread !== null) threads.push(thread);
  });
  return threads.sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function readThread(id: string, map: Y.Map<unknown>): CommentThread | null {
  const anchor = readAnchor(map.get("anchor"));
  const messages = map.get("messages");
  if (anchor === null || !(messages instanceof Y.Array)) return null;
  const color = map.get("color");
  const createdAt = map.get("createdAt");
  return {
    id,
    anchor,
    color: typeof color === "string" ? color : DEFAULT_COMMENT_COLOR,
    resolved: map.get("resolved") === true,
    messages: messages.toArray().flatMap((m) => readMessage(m) ?? []),
    createdAt: typeof createdAt === "string" ? createdAt : "",
  };
}

function readAnchor(value: unknown): CommentAnchor | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.object === "string" && isFinite(raw.u) && isFinite(raw.v)) {
    return { object: raw.object, u: raw.u, v: raw.v };
  }
  if (raw.object == null && isFinite(raw.x) && isFinite(raw.y)) {
    return { object: null, x: raw.x, y: raw.y };
  }
  return null;
}

function readMessage(value: unknown): CommentMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  const { id, author, text, at } = raw;
  return typeof id === "string" &&
    typeof author === "string" &&
    typeof text === "string" &&
    typeof at === "string"
    ? { id, author, text, at }
    : null;
}

function isFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function threadMap(
  comments: Y.Map<unknown>,
  id: string,
): Y.Map<unknown> | null {
  const map = comments.get(id);
  return map instanceof Y.Map ? map : null;
}

function message(author: string, text: string, now: Date): CommentMessage {
  return { id: newObjectId(), author, text, at: now.toISOString() };
}

/** CMT-01: новая ветка с первым сообщением. Возвращает id ветки и id сообщения. */
export function createThread(
  comments: Y.Map<unknown>,
  anchor: CommentAnchor,
  color: string,
  author: string,
  text: string,
  now: Date = new Date(),
): { thread: string; message: string } {
  const id = newObjectId();
  const first = message(author, text, now);
  const thread = new Y.Map<unknown>();
  const messages = new Y.Array<unknown>();
  messages.push([first]);
  thread.set("anchor", anchor);
  thread.set("color", color);
  thread.set("resolved", false);
  thread.set("createdAt", first.at);
  thread.set("createdBy", author);
  thread.set("messages", messages);
  comments.set(id, thread);
  return { thread: id, message: first.id };
}

/** CMT-02: ответ в ветке. Возвращает id сообщения; ветки нет — `null`. */
export function addReply(
  comments: Y.Map<unknown>,
  id: string,
  author: string,
  text: string,
  now: Date = new Date(),
): string | null {
  const messages = threadMap(comments, id)?.get("messages");
  if (!(messages instanceof Y.Array)) return null;
  const reply = message(author, text, now);
  messages.push([reply]);
  return reply.id;
}

/** CMT-02: отметить ветку решённой или вернуть в работу. */
export function setResolved(
  comments: Y.Map<unknown>,
  id: string,
  resolved: boolean,
): void {
  threadMap(comments, id)?.set("resolved", resolved);
}

/** CMT-03: цвет ветки. */
export function setThreadColor(
  comments: Y.Map<unknown>,
  id: string,
  color: string,
): void {
  threadMap(comments, id)?.set("color", color);
}

/**
 * CMT-01: привязка для точки доски — к объекту `object` (точка в долях его рамки, в
 * системе объекта без поворота) или, без объекта, к самой точке.
 */
export function anchorAt(object: SceneObject | null, at: Point): CommentAnchor {
  if (object === null || object.width <= 0 || object.height <= 0) {
    return { object: null, x: at.x, y: at.y };
  }
  const middle = center(object);
  const local = rotateVector(
    { x: at.x - middle.x, y: at.y - middle.y },
    -object.rotation,
  );
  return {
    object: object.id,
    u: clamp01(local.x / object.width + 0.5),
    v: clamp01(local.y / object.height + 0.5),
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * CMT-01: точка метки на доске. У привязки к объекту — по его текущей рамке; объекта нет
 * на холсте (удалён, скрыт во фрейме) — `null`.
 */
export function pinPoint(
  anchor: CommentAnchor,
  scene: readonly SceneObject[],
): Point | null {
  if (anchor.object === null) return { x: anchor.x, y: anchor.y };
  const object = scene.find((o) => o.id === anchor.object);
  if (object === undefined) return null;
  const middle = center(object);
  const offset = rotateVector(
    {
      x: (anchor.u - 0.5) * object.width,
      y: (anchor.v - 0.5) * object.height,
    },
    object.rotation,
  );
  return { x: middle.x + offset.x, y: middle.y + offset.y };
}

/** CMT-04: участники обсуждений — авторы сообщений, по алфавиту. */
export function participants(threads: readonly CommentThread[]): string[] {
  const names = new Set(
    threads.flatMap((t) => t.messages.map((m) => m.author)),
  );
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * CMT-04: ветки, в обсуждении которых участвовал хотя бы один из `people`; пустой
 * список — все ветки. `hideResolved` убирает решённые.
 */
export function filterThreads(
  threads: readonly CommentThread[],
  people: readonly string[],
  hideResolved = false,
): CommentThread[] {
  return threads.filter(
    (t) =>
      !(hideResolved && t.resolved) &&
      (people.length === 0 ||
        t.messages.some((m) => people.includes(m.author))),
  );
}
