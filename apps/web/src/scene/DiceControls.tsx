import { Button, SelectField } from "../ui";
import { DICE_FACES } from "./diceData";

/** Действия с выделенными кубиками (T6.11). */
export interface DiceActions {
  /** Сколько кубиков выделено. */
  count: number;
  /** DICE-02: бросить выделенные незаблокированные кубики; `null` — все заблокированы. */
  roll: (() => void) | null;
  /** DICE-01: общее число граней; у разных — `null`. */
  faces: number | null;
  setFaces: ((faces: number) => void) | null;
  /** DICE-03: сумма последних значений выделенных кубиков. */
  sum: number;
}

/**
 * Панель кубика в панели выделения: Roll (DICE-02), число граней (DICE-01) и сумма
 * последних значений нескольких выделенных кубиков (DICE-03). Цвет — общим списком Fill.
 */
export function DiceControls({ dice }: { dice: DiceActions }) {
  return (
    <span role="group" aria-label="Dice" className="selection-mindmap">
      {dice.roll && (
        <Button variant="ghost" onClick={dice.roll}>
          {dice.count > 1 ? `Roll all (${String(dice.count)})` : "Roll"}
        </Button>
      )}
      {dice.setFaces && (
        <SelectField
          label="Faces"
          value={dice.faces === null ? "" : String(dice.faces)}
          onChange={(event) => {
            dice.setFaces?.(Number(event.target.value));
          }}
        >
          {dice.faces === null && <option value="">Mixed</option>}
          {DICE_FACES.map((faces) => (
            <option key={faces} value={faces}>
              {faces}
            </option>
          ))}
        </SelectField>
      )}
      {dice.count > 1 && (
        <output className="selection-count dice-sum" aria-live="polite">
          Sum: {dice.sum}
        </output>
      )}
    </span>
  );
}
