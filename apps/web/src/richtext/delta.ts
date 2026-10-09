/**
 * Содержимое текста и документа — `Y.Text` с атрибутами форматирования в модели Quill
 * (TXT-01, TXT-02, TXT-06): атрибуты строки (`header`, `list`, `indent`) лежат на её
 * переводе строки, атрибуты символов (`bold`, `italic`, `underline`, `strike`, `link`) —
 * на символах. Блоки документа — разделитель `{ divider: true }` и ссылка на объект доски
 * `{ objectLink: id }` — вставки (embed) того же `Y.Text`.
 *
 * Модуль переводит дельту `Y.Text` в блоки для показа и обратно в текст, не доверяя
 * данным: документ пишут все участники, неизвестные и испорченные атрибуты отбрасываются.
 */

export type Attributes = Record<string, unknown>;

/** Операция дельты `Y.Text.toDelta()` / Quill. */
export interface DeltaOp {
  insert?: unknown;
  delete?: number;
  retain?: number;
  attributes?: Attributes;
}

export type ListKind = "bullet" | "ordered" | "checked" | "unchecked";

const LIST_KINDS: readonly string[] = [
  "bullet",
  "ordered",
  "checked",
  "unchecked",
];

/** Самый глубокий уровень вложенного списка (как у Quill). */
export const MAX_INDENT = 8;

/** Начертание участка текста. */
export interface Marks {
  bold?: true;
  italic?: true;
  underline?: true;
  strike?: true;
  /** Только безопасные адреса: http(s), mailto, tel. */
  link?: string;
}

export type Inline =
  | { kind: "text"; text: string; marks: Marks }
  | { kind: "object"; id: string; marks: Marks };

export type Block =
  | {
      kind: "line";
      inlines: Inline[];
      /** 0 — обычный абзац, 1…3 — заголовок. */
      header: 0 | 1 | 2 | 3;
      list: ListKind | null;
      indent: number;
      /** Позиция перевода строки в `Y.Text`; `null` — последняя строка без него. */
      end: number | null;
    }
  | { kind: "divider"; index: number };

/** Адрес ссылки, который можно открыть; остальное (javascript: и пр.) — `null`. */
export function safeLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const href = value.trim();
  if (href === "") return null;
  try {
    const url = new URL(href, window.location.href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol)
      ? href
      : null;
  } catch {
    return null;
  }
}

function marksOf(attributes: Attributes | undefined): Marks {
  const marks: Marks = {};
  if (attributes === undefined) return marks;
  if (attributes.bold === true) marks.bold = true;
  if (attributes.italic === true) marks.italic = true;
  if (attributes.underline === true) marks.underline = true;
  if (attributes.strike === true) marks.strike = true;
  const link = safeLink(attributes.link);
  if (link !== null) marks.link = link;
  return marks;
}

function lineFormat(attributes: Attributes | undefined): {
  header: 0 | 1 | 2 | 3;
  list: ListKind | null;
  indent: number;
} {
  const header = Number(attributes?.header);
  const list = attributes?.list;
  const indent = Number(attributes?.indent);
  return {
    // Заголовки 4…6 (вставка из другого редактора) показываются третьим уровнем.
    header:
      Number.isInteger(header) && header >= 1
        ? (Math.min(header, 3) as 1 | 2 | 3)
        : 0,
    list:
      typeof list === "string" && LIST_KINDS.includes(list)
        ? (list as ListKind)
        : null,
    indent:
      Number.isInteger(indent) && indent > 0 ? Math.min(indent, MAX_INDENT) : 0,
  };
}

/** Дельта → строки и блоки документа с позициями в `Y.Text`. */
export function toBlocks(ops: readonly DeltaOp[]): Block[] {
  const blocks: Block[] = [];
  let inlines: Inline[] = [];
  let index = 0;
  const closeLine = (end: number | null, attributes?: Attributes) => {
    blocks.push({ kind: "line", inlines, end, ...lineFormat(attributes) });
    inlines = [];
  };
  for (const op of ops) {
    const { insert, attributes } = op;
    if (typeof insert === "string") {
      const parts = insert.split("\n");
      parts.forEach((part, i) => {
        if (part !== "") {
          inlines.push({
            kind: "text",
            text: part,
            marks: marksOf(attributes),
          });
          index += part.length;
        }
        if (i < parts.length - 1) {
          closeLine(index, attributes);
          index += 1;
        }
      });
    } else if (typeof insert === "object" && insert !== null) {
      const embed = insert as Record<string, unknown>;
      if (embed.divider !== undefined) {
        if (inlines.length > 0) closeLine(null);
        blocks.push({ kind: "divider", index });
      } else if (typeof embed.objectLink === "string") {
        inlines.push({
          kind: "object",
          id: embed.objectLink,
          marks: marksOf(attributes),
        });
      }
      index += 1;
    }
  }
  if (inlines.length > 0) closeLine(null);
  return blocks;
}

/**
 * Простой текст дельты: строки через перевод строки, ссылка на объект — его подпись
 * (`label`), разделитель — пустая строка.
 */
export function plainText(
  ops: readonly DeltaOp[],
  label: (id: string) => string = () => "",
): string {
  return toBlocks(ops)
    .map((block) =>
      block.kind === "divider"
        ? ""
        : block.inlines
            .map((inline) =>
              inline.kind === "text" ? inline.text : label(inline.id),
            )
            .join(""),
    )
    .join("\n");
}

/** Есть ли в дельте что-то кроме простого текста (форматирование, блоки). */
export function isRich(ops: readonly DeltaOp[]): boolean {
  return ops.some(
    (op) =>
      typeof op.insert !== "string" ||
      (op.attributes !== undefined && Object.keys(op.attributes).length > 0),
  );
}

/**
 * Дельта из чужих данных (буфер обмена, копия в браузере) или `null`, если это не дельта:
 * остаются вставки текста и известных блоков с атрибутами-объектами.
 */
export function parseDelta(value: unknown): DeltaOp[] | null {
  if (!Array.isArray(value)) return null;
  const ops: DeltaOp[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { insert, attributes } = item as Record<string, unknown>;
    const embed =
      typeof insert === "object" &&
      insert !== null &&
      (("divider" in insert && insert.divider === true) ||
        ("objectLink" in insert && typeof insert.objectLink === "string"));
    if (typeof insert !== "string" && !embed) return null;
    const op: DeltaOp = { insert };
    if (
      typeof attributes === "object" &&
      attributes !== null &&
      !Array.isArray(attributes)
    ) {
      op.attributes = attributes as Attributes;
    }
    ops.push(op);
  }
  return ops;
}

const BLOCK_ATTRIBUTES = ["header", "list", "indent"];

/**
 * Дельта в модели `Y.Text`: атрибуты строки — только на переводах строк, атрибуты
 * символов — только на символах (разбор HTML Quill кладёт формат строки на всю строку).
 */
export function normalizeDelta(ops: readonly DeltaOp[]): DeltaOp[] {
  const out: DeltaOp[] = [];
  const push = (insert: unknown, attributes: Attributes) => {
    const op: DeltaOp = { insert };
    if (Object.keys(attributes).length > 0) op.attributes = attributes;
    out.push(op);
  };
  for (const { insert, attributes = {} } of ops) {
    const block = Object.fromEntries(
      Object.entries(attributes).filter(([k]) => BLOCK_ATTRIBUTES.includes(k)),
    );
    const inline = Object.fromEntries(
      Object.entries(attributes).filter(([k]) => !BLOCK_ATTRIBUTES.includes(k)),
    );
    if (typeof insert !== "string") {
      push(insert, attributes);
      continue;
    }
    insert.split(/(\n)/).forEach((part) => {
      if (part === "\n") push(part, block);
      else if (part !== "") push(part, inline);
    });
  }
  return out;
}
