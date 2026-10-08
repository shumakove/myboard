import { boundsOf, type Corner, type Frame } from "./geometry";
import { typeSpec } from "./objectTypes";
import { frameStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/**
 * Рамка выделения (CVS-10) с маркерами размера по углам (CVS-14), маркером поворота —
 * только если поворот предусмотрен у всех выделенных типов, и маркерами промежутка
 * у нескольких объектов (CVS-15). У одного объекта рамка повёрнута вместе с ним,
 * у нескольких — общая рамка по осям. У заблокированного маркеров нет (CVS-19).
 */
export function SelectionOverlay({
  selected,
}: {
  selected: readonly SceneObject[];
}) {
  const [single] = selected;
  if (single === undefined) return null;
  const bounds = boundsOf(selected);
  const frame: Frame | null =
    selected.length === 1 ? single : bounds && { ...bounds, rotation: 0 };
  if (frame === null) return null;
  const locked = selected.some((o) => o.locked);
  const rotatable = selected.every((o) => typeSpec(o.type)?.rotatable === true);
  return (
    <>
      {selected.length > 1 &&
        selected.map((object) => (
          <div
            key={object.id}
            className="selection-outline"
            style={frameStyle(object)}
          />
        ))}
      <div
        className={`selection-frame${locked ? " selection-locked" : ""}`}
        data-testid="selection-frame"
        data-locked={locked ? "true" : undefined}
        style={frameStyle(frame)}
      >
        {!locked &&
          CORNERS.map((corner) => (
            <div
              key={corner}
              className={`selection-handle handle-${corner}`}
              data-handle={corner}
              aria-label={`Resize ${corner}`}
            />
          ))}
        {!locked && rotatable && (
          <div
            className="selection-handle handle-rotate"
            data-handle="rotate"
            aria-label="Rotate"
          />
        )}
        {!locked && selected.length > 1 && (
          <>
            <div
              className="selection-handle handle-spacing-x"
              data-handle="spacing-x"
              aria-label="Adjust horizontal spacing"
            />
            <div
              className="selection-handle handle-spacing-y"
              data-handle="spacing-y"
              aria-label="Adjust vertical spacing"
            />
          </>
        )}
      </div>
    </>
  );
}
