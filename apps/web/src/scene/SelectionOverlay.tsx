import { boundsOf, type Corner, type Frame } from "./geometry";
import { typeSpec } from "./objectTypes";
import { frameStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";
import { LineHandles } from "./LineView";

const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

/**
 * Рамка выделения (CVS-10) с маркерами размера по углам (CVS-14), маркером поворота —
 * только если поворот предусмотрен у всех выделенных типов, и маркерами промежутка
 * у нескольких объектов (CVS-15). У одного объекта рамка повёрнута вместе с ним,
 * у нескольких — общая рамка по осям. У заблокированного маркеров нет (CVS-19).
 * У одной линии вместо рамки — маркеры концов и точек изгиба (T6.4). У одной
 * интеллект-карты маркеров размера нет: её размер задают узлы (T6.9).
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
  if (selected.length === 1 && single.line !== null && !locked) {
    return <LineHandles line={single} />;
  }
  const rotatable = selected.every((o) => typeSpec(o.type)?.rotatable === true);
  const resizable = !(selected.length === 1 && single.mindmap !== null);
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
          resizable &&
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
