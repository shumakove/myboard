import { RichText, type RichTextActions } from "../richtext/RichText";
import type { AreaDraft } from "./gestures";
import type { Guide } from "./guides";
import { GROUP_TYPE, isRichText, typeName, typeSpec } from "./objectTypes";
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
 * в редакторе. Текст и документ — с форматированием (TXT-01…TXT-06). Группа — невидимая
 * рамка своих объектов; заблокированный объект помечен замком (CVS-19).
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
      {objects.map((object) => {
        const group = object.type === GROUP_TYPE;
        const known = group || typeSpec(object.type) !== undefined;
        return (
          <div
            key={object.id}
            className={`scene-object scene-${known ? object.type : "unknown"}`}
            data-object-id={object.id}
            data-type={object.type}
            data-locked={object.locked ? "true" : undefined}
            aria-label={typeName(object.type)}
            aria-selected={selected.has(object.id)}
            style={group ? frameStyle(object) : objectStyle(object)}
          >
            {!group &&
              editing !== object.id &&
              (isRichText(object.type) ? (
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
              ) : (
                <span className="scene-label">{object.text}</span>
              ))}
            {!group && object.locked && <LockBadge />}
          </div>
        );
      })}
    </>
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
