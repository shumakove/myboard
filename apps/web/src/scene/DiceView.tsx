import { isDark } from "./boardSettings";
import type { SceneObject } from "./sceneObjects";

/** Очертание кубика по числу граней — многоугольник `clip-path`; у d6 — квадрат. */
const OUTLINES: Record<number, string | undefined> = {
  4: "polygon(50% 2%, 98% 96%, 2% 96%)",
  8: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  10: "polygon(50% 0, 100% 40%, 50% 100%, 0 40%)",
  12: "polygon(50% 0, 98% 36%, 80% 98%, 20% 98%, 2% 36%)",
  20: "polygon(50% 0, 96% 25%, 96% 75%, 50% 100%, 4% 75%, 4% 25%)",
};

/**
 * DICE-01: кубик своего цвета с очертанием по числу граней и подписью `d<N>`; DICE-02:
 * последнее выпавшее значение (до первого броска — «–»), каждый бросок встряхивает его.
 */
export function DiceView({ object }: { object: SceneObject }) {
  if (object.dice === null) return null;
  const { faces, value, roll } = object.dice;
  const fill = typeof object.style.fill === "string" ? object.style.fill : "";
  const dark = /^#[0-9a-f]{6}$/i.test(fill) && isDark(fill);
  const size = Math.min(object.width, object.height);
  return (
    <div
      className="dice-body"
      data-faces={faces}
      style={{
        background: fill || undefined,
        color: dark ? "#ffffff" : "#1f2937",
        clipPath: OUTLINES[faces],
        borderRadius: faces === 6 ? size * 0.16 : undefined,
      }}
    >
      <span
        key={roll}
        className="dice-value"
        data-testid="dice-value"
        data-rolling={roll > 0 ? "true" : undefined}
        style={{ fontSize: size * (faces === 4 ? 0.3 : 0.4) }}
      >
        {value ?? "–"}
      </span>
      <span className="dice-faces" style={{ fontSize: size * 0.14 }}>
        d{faces}
      </span>
    </div>
  );
}
