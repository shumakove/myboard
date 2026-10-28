import type { SceneObject } from "./sceneObjects";

/**
 * Кубик (T6.11) в документе — поля `Y.Map` объекта `type: "dice"`:
 * - `faces` — число граней (DICE-01);
 * - `value` — последнее выпавшее значение, `null` — ещё не бросали (DICE-02);
 * - `roll` — номер броска: меняется с каждым броском, чтобы участники увидели бросок,
 *   даже если выпало прежнее значение;
 * - цвет — общее свойство оформления `fill` (DICE-01).
 * Бросок — одна запись `value` и `roll`: одновременные броски двух участников Yjs сводит
 * к одной записи, и у всех на кубике одно значение.
 */

export const DICE_TYPE = "dice";

/** DICE-01: допустимое число граней. */
export const DICE_FACES: readonly number[] = [4, 6, 8, 10, 12, 20];

export const DEFAULT_FACES = 6;

export interface DiceShape {
  faces: number;
  /** Последнее выпавшее значение; `null` — кубик ещё не бросали. */
  value: number | null;
  roll: number;
}

export function readDice(record: Record<string, unknown>): DiceShape {
  const faces = DICE_FACES.includes(record.faces as number)
    ? (record.faces as number)
    : DEFAULT_FACES;
  const { value } = record;
  return {
    faces,
    // Значение вне граней (число граней сменили одновременно с броском) не показывается.
    value:
      isNumber(value) && Number.isInteger(value) && value >= 1 && value <= faces
        ? value
        : null,
    roll: isNumber(record.roll) ? record.roll : 0,
  };
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Подпись кубика для чтения с экрана: грани и значение. */
export function diceTitle(object: SceneObject): string {
  if (object.dice === null) return "Dice";
  const { faces, value } = object.dice;
  return `Dice d${String(faces)}: ${value === null ? "not rolled" : String(value)}`;
}
