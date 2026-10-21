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
 * Группа — невидимая рамка своих объектов; заблокированный объект помечен замком (CVS-19).
 */
export function SceneLayer({
  objects,
  selected,
  editing,
  rich,
}: {
  objects: readonly SceneObject[];
  selected: ReadonlySet<string>;
  editing: string | null;
  rich: RichTextHandlers;
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
}: {
  object: SceneObject;
  selected: boolean;
  editing: boolean;
  rich: RichTextHandlers;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const group = object.type === GROUP_TYPE;
  const known = group || typeSpec(object.type) !== undefined;
  const sticky = object.type === "sticky";
  // STK-02: автоподгон шрифта стикера под его размер; правки текста видит наблюдатель.
  const autoFit =
    sticky && (object.style.fontSize ?? AUTO_FONT_SIZE) === AUTO_FONT_SIZE;
  useFitFont(ref, autoFit && !editing, [object.width, object.height]);
  return (
    <div
      ref={ref}
      className={`scene-object scene-${known ? object.type : "unknown"}`}
      data-object-id={object.id}
      data-type={object.type}
      data-locked={object.locked ? "true" : undefined}
      data-font-fit={autoFit ? "auto" : undefined}
      aria-label={typeName(object.type)}
      aria-selected={selected}
      style={group ? frameStyle(object) : objectStyle(object)}
    >
      {!group && !editing && <ObjectContent object={object} rich={rich} />}
      {(sticky || object.type === "stack") && <StickyFooter object={object} />}
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

/** STK-03: теги стикера и стопки, имя автора стикера — строкой внизу. */
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
