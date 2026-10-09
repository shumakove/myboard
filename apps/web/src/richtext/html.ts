import {
  normalizeDelta,
  toBlocks,
  type Block,
  type DeltaOp,
  type Inline,
} from "./delta";
import {
  createQuill,
  DOCUMENT_FORMATS,
  TEXT_FORMATS,
  type Quill,
} from "./quill";

/**
 * Обмен с внешними редакторами через буфер обмена:
 * - TXT-07: дельта → HTML со стандартной разметкой (`p`, `h1…h3`, вложенные `ul`/`ol`,
 *   `strong`, `em`, `u`, `s`, `a`, `hr`), которую понимают Google Docs, Word и почта;
 * - TXT-08: HTML из внешнего документа → дельта с базовым форматированием (разбирает
 *   модуль буфера Quill: стили Word и Google Docs, вложенные списки).
 */

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineHtml(inline: Inline, label: (id: string) => string): string {
  let html = escape(inline.kind === "text" ? inline.text : label(inline.id));
  const { marks } = inline;
  if (marks.bold) html = `<strong>${html}</strong>`;
  if (marks.italic) html = `<em>${html}</em>`;
  if (marks.underline) html = `<u>${html}</u>`;
  if (marks.strike) html = `<s>${html}</s>`;
  if (marks.link !== undefined) {
    html = `<a href="${escape(marks.link)}">${html}</a>`;
  }
  return html;
}

const CHECK_MARK = { checked: "☑ ", unchecked: "☐ " } as const;

/** TXT-07: блоки текста → HTML. Списки дел — маркированный список с ☐/☑. */
export function deltaToHtml(
  ops: readonly DeltaOp[],
  label: (id: string) => string = () => "",
): string {
  const out: string[] = [];
  // Открытые списки: тег и уровень вложенности.
  const open: { tag: "ul" | "ol"; indent: number }[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) out.push(`</li></${open.pop()?.tag ?? "ul"}>`);
  };
  const lineHtml = (block: Extract<Block, { kind: "line" }>) =>
    block.inlines.map((inline) => inlineHtml(inline, label)).join("");

  for (const block of toBlocks(ops)) {
    if (block.kind === "divider" || block.list === null) {
      closeTo(0);
      if (block.kind === "divider") out.push("<hr>");
      else {
        const tag = block.header === 0 ? "p" : `h${String(block.header)}`;
        out.push(`<${tag}>${lineHtml(block) || "<br>"}</${tag}>`);
      }
      continue;
    }
    const tag = block.list === "ordered" ? "ol" : "ul";
    const mark =
      block.list === "checked" || block.list === "unchecked"
        ? CHECK_MARK[block.list]
        : "";
    // Глубже текущего — новый вложенный список внутри открытого пункта.
    while (open.length > 0 && (open.at(-1)?.indent ?? 0) > block.indent) {
      out.push(`</li></${open.pop()?.tag ?? "ul"}>`);
    }
    const last = open.at(-1);
    if (
      last !== undefined &&
      last.indent === block.indent &&
      last.tag !== tag
    ) {
      out.push(`</li></${last.tag}>`);
      open.pop();
    }
    const current = open.at(-1);
    if (current === undefined || current.indent < block.indent) {
      out.push(`<${tag}>`);
      open.push({ tag, indent: block.indent });
    } else {
      out.push("</li>");
    }
    out.push(`<li>${escape(mark)}${lineHtml(block)}`);
  }
  closeTo(0);
  return out.join("");
}

/** Отдельный редактор вне страницы — только для разбора HTML. */
const converters = new Map<"text" | "document", Quill>();

function converter(kind: "text" | "document"): Quill {
  let quill = converters.get(kind);
  if (quill === undefined) {
    quill = createQuill(
      document.createElement("div"),
      kind === "document" ? DOCUMENT_FORMATS : TEXT_FORMATS,
    );
    converters.set(kind, quill);
  }
  return quill;
}

/**
 * TXT-08: HTML внешнего документа → дельта с базовым форматированием: заголовки, списки
 * (и вложенные), ссылки, жирный, курсив, подчёркнутый, зачёркнутый. Цвета, шрифты и
 * размеры чужого документа не переносятся — у текста на доске свои (TXT-01).
 */
export function htmlToDelta(
  html: string,
  kind: "text" | "document" = "text",
): DeltaOp[] {
  return normalizeDelta(
    converter(kind).clipboard.convert({ html }).ops as DeltaOp[],
  );
}
