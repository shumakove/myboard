import type { ReactNode } from "react";
import { toBlocks, type Block, type DeltaOp, type Inline } from "./delta";
import "./richText.css";

type Line = Extract<Block, { kind: "line" }>;

export interface RichTextActions {
  /** TXT-02: отметка пункта списка дел без режима редактирования; `null` — нельзя. */
  onCheck: ((end: number, checked: boolean) => void) | null;
  /** TXT-06: переход к объекту по ссылке документа. */
  onOpenObject: (id: string) => void;
  /** Подпись ссылки на объект; `null` — объекта на доске нет. */
  objectLabel: (id: string) => string | null;
}

/**
 * Показ форматированного текста на холсте (TXT-01, TXT-02, TXT-06) — та же разметка,
 * что у редактора Quill (`p`, `h1…h3`, `ol > li[data-list]`, `hr`), поэтому оформление
 * одно. Отличия от редактора: флажок списка дел — настоящий `checkbox`, который
 * отмечается без входа в редактирование; ссылки открываются в новой вкладке, ссылка
 * на объект переводит к нему вид. Нажатия на них холст не перехватывает.
 */
export function RichText({
  ops,
  placeholder,
  actions,
}: {
  ops: readonly DeltaOp[];
  placeholder: string;
  actions: RichTextActions;
}) {
  const blocks = toBlocks(ops);
  if (blocks.every(isEmptyLine)) {
    return (
      <div className="rich-text">
        <p className="scene-placeholder">{placeholder}</p>
      </div>
    );
  }
  const out: ReactNode[] = [];
  let list: Line[] = [];
  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    out.push(
      <ol key={`list-${String(out.length)}`}>
        {items.map((line, i) => (
          <ListItem key={i} line={line} actions={actions} />
        ))}
      </ol>,
    );
    list = [];
  };
  blocks.forEach((block, i) => {
    if (block.kind === "line" && block.list !== null) {
      list.push(block);
      return;
    }
    flushList();
    if (block.kind === "divider") {
      out.push(<hr key={i} />);
      return;
    }
    const Tag = (block.header === 0 ? "p" : `h${String(block.header)}`) as
      "p" | "h1" | "h2" | "h3";
    out.push(
      <Tag key={i} className={indentClass(block.indent)}>
        <Inlines line={block} actions={actions} />
      </Tag>,
    );
  });
  flushList();
  return <div className="rich-text">{out}</div>;
}

function isEmptyLine(block: Block): boolean {
  return (
    block.kind === "line" && block.list === null && block.inlines.length === 0
  );
}

function indentClass(indent: number): string | undefined {
  return indent > 0 ? `ql-indent-${String(indent)}` : undefined;
}

function ListItem({ line, actions }: { line: Line; actions: RichTextActions }) {
  const { list, end } = line;
  const check = list === "checked" || list === "unchecked";
  return (
    <li data-list={list ?? undefined} className={indentClass(line.indent)}>
      {check ? (
        <input
          type="checkbox"
          className="rt-check"
          aria-label="Done"
          data-canvas-ignore=""
          checked={list === "checked"}
          disabled={actions.onCheck === null || end === null}
          onChange={(event) => {
            if (end !== null) actions.onCheck?.(end, event.target.checked);
          }}
        />
      ) : (
        <span className="ql-ui" aria-hidden="true" />
      )}
      <Inlines line={line} actions={actions} />
    </li>
  );
}

function Inlines({ line, actions }: { line: Line; actions: RichTextActions }) {
  if (line.inlines.length === 0) return <br />;
  return (
    <>
      {line.inlines.map((inline, i) => (
        <InlineView key={i} inline={inline} actions={actions} />
      ))}
    </>
  );
}

function InlineView({
  inline,
  actions,
}: {
  inline: Inline;
  actions: RichTextActions;
}) {
  const { marks } = inline;
  let node: ReactNode;
  if (inline.kind === "object") {
    const label = actions.objectLabel(inline.id);
    node = (
      <button
        type="button"
        className="rt-object-link"
        data-object={inline.id}
        data-canvas-ignore=""
        disabled={label === null}
        onClick={() => {
          actions.onOpenObject(inline.id);
        }}
      >
        {label ?? "Missing object"}
      </button>
    );
  } else {
    node = inline.text;
  }
  if (marks.bold) node = <strong>{node}</strong>;
  if (marks.italic) node = <em>{node}</em>;
  if (marks.underline) node = <u>{node}</u>;
  if (marks.strike) node = <s>{node}</s>;
  if (marks.link !== undefined && inline.kind === "text") {
    node = (
      <a
        href={marks.link}
        target="_blank"
        rel="noopener noreferrer"
        data-canvas-ignore=""
      >
        {node}
      </a>
    );
  }
  return node;
}
