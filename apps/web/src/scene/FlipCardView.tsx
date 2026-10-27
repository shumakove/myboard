import { sideTextStyle } from "./objectStyle";
import type { FlipSide, FlipSideName } from "./flipData";
import type { SceneObject } from "./sceneObjects";

/**
 * FLP-01: флип-карточка — две стороны со своим цветом, картинкой и текстом; переворот —
 * поворот в своём направлении (вокруг вертикальной или горизонтальной оси). FLP-02:
 * кнопка в углу переворачивает карточку. FLP-03: у текста стороны свой размер и
 * форматирование.
 */
export function FlipCardView({
  object,
  editing,
}: {
  object: SceneObject;
  editing: boolean;
}) {
  if (object.flip === null) return null;
  const { flip } = object;
  return (
    <>
      <div
        className="flip-inner"
        data-flipped={flip.flipped ? "true" : undefined}
        data-direction={flip.direction}
      >
        <FlipFace
          name="front"
          side={flip.front}
          hidden={editing && !flip.flipped}
        />
        <FlipFace
          name="back"
          side={flip.back}
          hidden={editing && flip.flipped}
        />
      </div>
      {!object.locked && (
        <button
          type="button"
          className="flip-toggle"
          data-flip-toggle=""
          aria-label="Flip card"
          title="Flip card"
          tabIndex={-1}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 6a5 5 0 0 1 9-2M13 10a5 5 0 0 1-9 2" fill="none" />
            <path d="M12 1v3H9M4 15v-3h3" fill="none" />
          </svg>
        </button>
      )}
    </>
  );
}

function FlipFace({
  name,
  side,
  hidden,
}: {
  name: FlipSideName;
  side: FlipSide;
  /** Текст стороны сейчас в редакторе — на карточке его не дублируют. */
  hidden: boolean;
}) {
  return (
    <div
      className={`flip-face flip-${name}`}
      data-side={name}
      style={{ background: side.fill }}
    >
      {side.image !== null && (
        <img className="flip-image" src={side.image} alt="" draggable={false} />
      )}
      {!hidden && side.text !== "" && (
        <span className="flip-text" style={sideTextStyle(side)}>
          {side.text}
        </span>
      )}
    </div>
  );
}
