import type { AreaDraft } from "./gestures";
import { typeSpec } from "./objectTypes";
import { frameStyle, objectStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";

/** Объекты сцены снизу вверх по `z` (CVS-09); текст редактируемого объекта — в редакторе. */
export function SceneLayer({
  objects,
  selected,
  editing,
}: {
  objects: readonly SceneObject[];
  selected: ReadonlySet<string>;
  editing: string | null;
}) {
  return (
    <>
      {objects.map((object) => {
        const spec = typeSpec(object.type);
        const label = spec?.label ?? "Object";
        return (
          <div
            key={object.id}
            className={`scene-object scene-${spec ? object.type : "unknown"}`}
            data-object-id={object.id}
            data-type={object.type}
            aria-label={label}
            aria-selected={selected.has(object.id)}
            style={objectStyle(object)}
          >
            {editing !== object.id && (
              <span className="scene-label">
                {object.text ||
                  (object.type === "text" ? (
                    <span className="scene-placeholder">Text</span>
                  ) : null)}
              </span>
            )}
          </div>
        );
      })}
    </>
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
