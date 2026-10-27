import { Button, Dialog, SelectField } from "../ui";
import { COLORS } from "./objectTypes";

/** Действия с одной выделенной незаблокированной интеллект-картой (T6.9). */
export interface MindmapActions {
  /** Выбранный узел (щелчок по узлу); `null` — не выбран. */
  node: {
    id: string;
    text: string;
    color: string;
    root: boolean;
    /** У узла есть дети; `collapsed` — его ветка свёрнута. */
    branch: boolean;
    collapsed: boolean;
  } | null;
  /** MAP-02: новый дочерний узел выбранного (без выбора — корня). */
  addChild: () => void;
  /** MAP-02: новый узел рядом с выбранным; у корня — `null`. */
  addSibling: (() => void) | null;
  /** MAP-02: правка названия выбранного узла. */
  rename: (() => void) | null;
  /** MAP-02, MAP-04: перекраска выбранного узла (вопрос о потомках — в диалоге). */
  recolor: ((color: string) => void) | null;
  /** MAP-03: свернуть или развернуть ветку выбранного узла. */
  toggle: (() => void) | null;
  /** MAP-02: удалить выбранный узел с веткой; у корня — `null`. */
  remove: (() => void) | null;
}

/**
 * Панель интеллект-карты (T6.9) в панели выделения: выбранный узел, новые узлы, правка
 * названия, цвет, сворачивание ветки и удаление узла (MAP-02…MAP-04).
 */
export function MindmapControls({ mindmap }: { mindmap: MindmapActions }) {
  const { node } = mindmap;
  return (
    <span role="group" aria-label="Mind map" className="selection-mindmap">
      <span className="selection-count">
        {node === null
          ? "Click a node to select it"
          : `Node: ${node.text || "New idea"}`}
      </span>
      <Button variant="ghost" onClick={mindmap.addChild}>
        Add child
      </Button>
      {mindmap.addSibling && (
        <Button variant="ghost" onClick={mindmap.addSibling}>
          Add sibling
        </Button>
      )}
      {mindmap.rename && (
        <Button variant="ghost" onClick={mindmap.rename}>
          Rename
        </Button>
      )}
      {node && mindmap.recolor && (
        <SelectField
          label="Node color"
          value={node.color}
          onChange={(event) => {
            mindmap.recolor?.(event.target.value);
          }}
        >
          {!COLORS.some((c) => c.value === node.color) && (
            <option value={node.color}>{node.color}</option>
          )}
          {COLORS.map((color) => (
            <option key={color.value} value={color.value}>
              {color.label}
            </option>
          ))}
        </SelectField>
      )}
      {node?.branch && mindmap.toggle && (
        <Button variant="ghost" onClick={mindmap.toggle}>
          {node.collapsed ? "Expand" : "Collapse"}
        </Button>
      )}
      {mindmap.remove && (
        <Button variant="ghost" onClick={mindmap.remove}>
          Delete node
        </Button>
      )}
    </span>
  );
}

/** MAP-04: при перекраске узла с детьми — перекрасить ли и все дочерние узлы. */
export function RecolorDialog({
  text,
  count,
  onAnswer,
  onCancel,
}: {
  text: string;
  /** Сколько узлов под перекрашиваемым. */
  count: number;
  onAnswer: (withChildren: boolean) => void;
  onCancel: () => void;
}) {
  return (
    <Dialog
      title="Recolor child nodes too?"
      onClose={onCancel}
      className="mindmap-recolor-dialog"
    >
      <p>
        “{text || "New idea"}” has {count}{" "}
        {count === 1 ? "child node" : "child nodes"}. Recolor them with the same
        color?
      </p>
      <div className="mindmap-dialog-actions">
        <Button
          variant="primary"
          autoFocus
          onClick={() => {
            onAnswer(true);
          }}
        >
          Recolor all
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            onAnswer(false);
          }}
        >
          Only this node
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
