import { TOGGLE_SIZE, type DropPlace, type MindmapNode } from "./mindmapData";
import type { SceneObject } from "./sceneObjects";

/** Перетаскиваемый узел карты: куда его сдвинули и куда он упадёт (MAP-02). */
export interface NodeDragState {
  node: string;
  dx: number;
  dy: number;
  target: string | null;
  place: DropPlace | null;
}

/** Узлы карты на холсте: выбранный, тот, название которого правят, и перетаскиваемый. */
export interface MindmapNodesState {
  active: string | null;
  editing: string | null;
  drag: NodeDragState | null;
}

/** Тёмная заливка — светлый текст. */
const DARK_FILLS: readonly string[] = ["#1f2937"];

/** Цвет ветки к узлу: цвет узла, у белого — серый, чтобы ветку было видно. */
function branchColor(node: MindmapNode): string {
  return node.color.toLowerCase() === "#ffffff" ? "#94a3b8" : node.color;
}

/**
 * Интеллект-карта на холсте (T6.9): ветки — кривые SVG от родителя к детям, узлы —
 * подписанные блоки своего цвета (MAP-01, MAP-02). У узла с детьми справа кнопка
 * сворачивания: «−» у раскрытой ветки, число скрытых узлов — у свёрнутой (MAP-03).
 * Щелчок по узлу выбирает его, двойной — открывает название для правки.
 */
export function MindmapView({
  object,
  nodes,
}: {
  object: SceneObject;
  nodes: MindmapNodesState | null;
}) {
  const shape = object.mindmap;
  if (shape === null) return null;
  const drag = nodes?.drag ?? null;
  return (
    <>
      <svg
        className="mindmap-branches"
        width={shape.width}
        height={shape.height}
        aria-hidden="true"
      >
        {shape.nodes.map((node) => {
          const parent =
            node.parent === null ? undefined : shape.byId.get(node.parent);
          if (parent === undefined) return null;
          const x1 = parent.x + parent.width;
          const y1 = parent.y + parent.height / 2;
          const x2 = node.x;
          const y2 = node.y + node.height / 2;
          const mid = (x1 + x2) / 2;
          const path = [x1, y1, mid, y1, mid, y2, x2, y2].map(String);
          return (
            <path
              key={node.id}
              d={`M ${path.slice(0, 2).join(" ")} C ${path.slice(2).join(" ")}`}
              stroke={branchColor(node)}
            />
          );
        })}
      </svg>
      {shape.nodes.map((node) => {
        const dragged = drag?.node === node.id;
        return (
          <div
            key={node.id}
            className="mindmap-node"
            data-node={node.id}
            data-root={node.parent === null ? "true" : undefined}
            data-active={nodes?.active === node.id ? "true" : undefined}
            data-dragging={dragged ? "true" : undefined}
            data-drop={drag?.target === node.id ? drag.place : undefined}
            title={node.text}
            style={{
              left: node.x,
              top: node.y,
              width: node.width,
              height: node.height,
              background: node.color,
              color: DARK_FILLS.includes(node.color) ? "#ffffff" : undefined,
              transform: dragged
                ? `translate(${String(drag.dx)}px, ${String(drag.dy)}px)`
                : undefined,
            }}
          >
            {nodes?.editing !== node.id && (
              <span
                className="mindmap-node-text"
                data-placeholder={node.text === "" ? "true" : undefined}
              >
                {node.text === "" ? "New idea" : node.text}
              </span>
            )}
          </div>
        );
      })}
      {shape.nodes
        .filter((node) => node.children.length > 0)
        .map((node) => (
          <button
            key={node.id}
            type="button"
            className="mindmap-toggle"
            data-node-toggle={node.id}
            aria-label={
              node.collapsed
                ? `Expand “${node.text}”`
                : `Collapse “${node.text}”`
            }
            aria-expanded={!node.collapsed}
            tabIndex={-1}
            style={{
              left: node.x + node.width + 4,
              top: node.y + (node.height - TOGGLE_SIZE) / 2,
              width: TOGGLE_SIZE,
              height: TOGGLE_SIZE,
              borderColor: branchColor(node),
            }}
          >
            {node.collapsed ? String(node.descendants) : "−"}
          </button>
        ))}
    </>
  );
}
