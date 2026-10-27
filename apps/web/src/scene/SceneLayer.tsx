import { useRef } from "react";
import { useFitFont } from "../richtext/fitFont";
import { RichText, type RichTextActions } from "../richtext/RichText";
import type { AreaDraft } from "./gestures";
import type { Guide } from "./guides";
import {
  AUTO_FONT_SIZE,
  GROUP_TYPE,
  isRichText,
  typeName,
  typeSpec,
} from "./objectTypes";
import { frameStyle, objectStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";
import { shapeKind, shapeMarker } from "./shapes";
import { ShapeView } from "./ShapeView";
import { LineView, type LabelState } from "./LineView";
import { DrawingView } from "./DrawingView";
import { TableView, type TableCellsState } from "./TableView";
import { KanbanView, type KanbanColumnsState } from "./KanbanView";
import { MindmapView, type MindmapNodesState } from "./MindmapView";

/** Таблицы на холсте (T6.7): выделенные ячейки и таблица с маркерами границ. */
export interface TableLayerState {
  /** Таблица с выделенными ячейками и сами ячейки. */
  cells: { table: string; state: TableCellsState } | null;
  /** Таблица, у которой показаны маркеры ширины столбцов и высоты строк (TBL-01). */
  handles: string | null;
}

/** Канбан с выбранным столбцом или правкой названия столбца (T6.8, KBN-03). */
export interface KanbanLayerState {
  kanban: string;
  state: KanbanColumnsState;
}

/** Интеллект-карта с выбранным, редактируемым или перетаскиваемым узлом (T6.9). */
export interface MindmapLayerState {
  mindmap: string;
  state: MindmapNodesState;
}

/** Действия форматированного текста на холсте (TXT-02, TXT-06). */
export interface RichTextHandlers {
  /** Отметить пункт списка дел объекта `id`: `end` — перевод строки пункта. */
  onCheck: (id: string, end: number, checked: boolean) => void;
  onOpenObject: RichTextActions["onOpenObject"];
  objectLabel: RichTextActions["objectLabel"];
}

/**
 * Объекты сцены в порядке отрисовки (CVS-09, CVS-17); текст редактируемого объекта —
 * в редакторе. Текст, документ и стикер — с форматированием (TXT-01…TXT-06). Стикер —
 * с автоподгоном шрифта, тегами и автором (STK-02, STK-03), стопка — с тегами (STK-05).
 * Фигура — контур SVG её вида с маркером BPMN и текстом (SHP-01…SHP-03). Линия —
 * контур SVG с наконечниками и подписями (T6.4, CON-01…CON-04). Рисунок — штрих SVG
 * (T6.5, DRW-01, DRW-06). Фрейм — рамка своего оформления (FRM-02); со скрытым
 * содержимым — с пометкой Content hidden, а его объектов в списке нет (FRM-04).
 * Таблица — ячейки с оформлением и маркеры границ (T6.7, TBL-01…TBL-04). Канбан — столбцы
 * с заголовками, карточка — текст и теги (T6.8, KBN-01…KBN-03). Интеллект-карта — узлы,
 * ветки и кнопки сворачивания (T6.9, MAP-01…MAP-03).
 * Группа — невидимая рамка своих объектов; заблокированный объект помечен замком (CVS-19).
 */
export function SceneLayer({
  objects,
  selected,
  editing,
  rich,
  label = null,
  tables = null,
  kanban = null,
  mindmap = null,
}: {
  objects: readonly SceneObject[];
  selected: ReadonlySet<string>;
  editing: string | null;
  rich: RichTextHandlers;
  /** CON-03: выбранная или редактируемая подпись линии. */
  label?: LabelState | null;
  tables?: TableLayerState | null;
  kanban?: KanbanLayerState | null;
  mindmap?: MindmapLayerState | null;
}) {
  return (
    <>
      {objects.map((object) => (
        <SceneObjectView
          key={object.id}
          object={object}
          selected={selected.has(object.id)}
          editing={editing === object.id}
          rich={rich}
          label={label?.line === object.id ? label : null}
          cells={tables?.cells?.table === object.id ? tables.cells.state : null}
          handles={tables?.handles === object.id}
          columns={kanban?.kanban === object.id ? kanban.state : null}
          nodes={mindmap?.mindmap === object.id ? mindmap.state : null}
        />
      ))}
    </>
  );
}

function SceneObjectView({
  object,
  selected,
  editing,
  rich,
  label,
  cells,
  handles,
  columns,
  nodes,
}: {
  object: SceneObject;
  selected: boolean;
  editing: boolean;
  rich: RichTextHandlers;
  label: LabelState | null;
  cells: TableCellsState | null;
  handles: boolean;
  columns: KanbanColumnsState | null;
  nodes: MindmapNodesState | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const group = object.type === GROUP_TYPE;
  const known = group || typeSpec(object.type) !== undefined;
  const sticky = object.type === "sticky";
  // STK-02: автоподгон шрифта стикера под его размер; правки текста видит наблюдатель.
  const autoFit =
    sticky && (object.style.fontSize ?? AUTO_FONT_SIZE) === AUTO_FONT_SIZE;
  useFitFont(ref, autoFit && !editing, [object.width, object.height]);
  const shape = object.type === "shape" ? shapeKind(object.style.shape) : null;
  return (
    <div
      ref={ref}
      className={`scene-object scene-${known ? object.type : "unknown"}`}
      data-object-id={object.id}
      data-type={object.type}
      data-locked={object.locked ? "true" : undefined}
      data-font-fit={autoFit ? "auto" : undefined}
      data-appearance={
        object.frameOptions
          ? String(object.style.appearance ?? "fill")
          : undefined
      }
      data-content-hidden={
        object.frameOptions?.contentHidden === true ? "true" : undefined
      }
      data-shape={shape?.id}
      data-marker={
        shape
          ? (shapeMarker(shape, object.style.marker) ?? undefined)
          : undefined
      }
      aria-label={typeName(object.type)}
      aria-selected={selected}
      style={group ? frameStyle(object) : objectStyle(object)}
    >
      {shape ? (
        <ShapeView object={object} editing={editing} />
      ) : object.line ? (
        <LineView object={object} label={label} />
      ) : object.drawing ? (
        <DrawingView object={object} />
      ) : object.table ? (
        <TableView object={object} cells={cells} handles={handles} />
      ) : object.kanban ? (
        <KanbanView object={object} columns={columns} />
      ) : object.mindmap ? (
        <MindmapView object={object} nodes={nodes} />
      ) : object.frameOptions ? (
        object.frameOptions.contentHidden && (
          <span className="frame-hidden-note">Content hidden</span>
        )
      ) : (
        !group && !editing && <ObjectContent object={object} rich={rich} />
      )}
      {(sticky || object.type === "stack" || object.type === "card") && (
        <StickyFooter object={object} />
      )}
      {!group && object.locked && <LockBadge />}
    </div>
  );
}

/** Текст объекта на холсте: форматированный или строкой; у стопки — подсказка. */
function ObjectContent({
  object,
  rich,
}: {
  object: SceneObject;
  rich: RichTextHandlers;
}) {
  if (object.type === "stack") {
    return <span className="stack-hint">Drag to add a sticky note</span>;
  }
  if (!isRichText(object.type)) {
    return <span className="scene-label">{object.text}</span>;
  }
  return (
    <RichText
      ops={object.rich ?? []}
      placeholder={typeName(object.type)}
      actions={{
        // CVS-19: у заблокированного объекта пункты не отмечаются.
        onCheck: object.locked
          ? null
          : (end, checked) => {
              rich.onCheck(object.id, end, checked);
            },
        onOpenObject: rich.onOpenObject,
        objectLabel: rich.objectLabel,
      }}
    />
  );
}

/** STK-03, KBN-02: теги стикера, стопки и карточки, имя автора стикера — строкой внизу. */

function StickyFooter({ object }: { object: SceneObject }) {
  const author =
    object.type === "sticky" && object.showAuthor
      ? (object.meta.createdBy ?? "")
      : "";
  if (object.tags.length === 0 && author === "") return null;
  return (
    <div className="sticky-footer">
      {object.tags.length > 0 && (
        <ul className="sticky-tags" aria-label="Tags">
          {object.tags.map((tag) => (
            <li key={tag} className="sticky-tag">
              {tag}
            </li>
          ))}
        </ul>
      )}
      {author !== "" && (
        <span className="sticky-author" data-testid="sticky-author">
          {author}
        </span>
      )}
    </div>
  );
}

/** CVS-19: значок замка в углу заблокированного объекта. */
function LockBadge() {
  return (
    <svg
      className="scene-lock"
      viewBox="0 0 16 16"
      aria-hidden="true"
      data-testid="lock-badge"
    >
      <rect x="3" y="7" width="10" height="8" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" />
    </svg>
  );
}

/** Рамка или лассо, пока выделяют областью (CVS-10). */
export function AreaOverlay({ draft }: { draft: AreaDraft | null }) {
  if (draft === null) return null;
  if (draft.kind === "marquee") {
    return (
      <div
        className="selection-area"
        data-testid="selection-marquee"
        style={frameStyle({ ...draft.rect, rotation: 0 })}
      />
    );
  }
  const points = draft.points.map((p) => `${String(p.x)},${String(p.y)}`);
  return (
    <svg
      className="selection-lasso"
      data-testid="selection-lasso"
      aria-hidden="true"
    >
      <polygon points={points.join(" ")} />
    </svg>
  );
}

/** CVS-16: направляющие выравнивания, пока объект тянут. */
export function GuidesOverlay({ guides }: { guides: readonly Guide[] }) {
  return (
    <>
      {guides.map((guide) => (
        <div
          key={`${guide.axis}:${String(guide.value)}`}
          className={`alignment-guide guide-${guide.axis}`}
          data-testid="alignment-guide"
          data-axis={guide.axis}
          data-value={guide.value}
          aria-hidden="true"
          style={
            guide.axis === "x"
              ? {
                  left: guide.value,
                  top: guide.from,
                  height: guide.to - guide.from,
                }
              : {
                  top: guide.value,
                  left: guide.from,
                  width: guide.to - guide.from,
                }
          }
        />
      ))}
    </>
  );
}
