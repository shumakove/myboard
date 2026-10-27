import { useCallback } from "react";
import type * as Y from "yjs";
import { diceSum, rollDice, setFaces } from "./dice";
import type { DiceActions } from "./DiceControls";
import type { FlipActions } from "./FlipControls";
import { flipCards, setFlipFields } from "./flipCards";
import { shownSide } from "./flipData";
import { readScene, type SceneObject } from "./sceneObjects";

/**
 * T6.11: действия панели выделения с флип-карточками (FLP-01…FLP-03) и кубиками
 * (DICE-01…DICE-03), переворот и бросок одного объекта жестом на холсте.
 */
export function useFlipAndDice({
  objects,
  units,
  actor,
}: {
  objects: Y.Map<unknown>;
  /** Выделенное (верхние объекты выделения). */
  units: readonly SceneObject[];
  actor: string;
}): {
  flip: FlipActions | null;
  dice: DiceActions | null;
  flipOne: (id: string) => void;
  rollOne: (id: string) => void;
} {
  /** Свежий объект документа: его могли изменить другие участники. */
  const fresh = useCallback(
    (id: string) => readScene(objects).find((o) => o.id === id),
    [objects],
  );
  const flipOne = useCallback(
    (id: string) => {
      const card = fresh(id);
      if (card !== undefined) flipCards(objects, [card], actor);
    },
    [objects, actor, fresh],
  );
  const rollOne = useCallback(
    (id: string) => {
      const die = fresh(id);
      if (die !== undefined) rollDice(objects, [die], actor);
    },
    [objects, actor, fresh],
  );

  const cards = units.filter((o) => o.flip !== null && !o.locked);
  const [single] = cards;
  const flip: FlipActions | null =
    cards.length === 0
      ? null
      : {
          count: cards.length,
          flip: () => {
            const ids = new Set(cards.map((o) => o.id));
            const current = readScene(objects).filter((o) => ids.has(o.id));
            flipCards(objects, current, actor);
          },
          side:
            cards.length === 1 && single?.flip != null
              ? {
                  name: shownSide(single.flip),
                  style: single.flip[shownSide(single.flip)],
                  direction: single.flip.direction,
                  set: (fields) => {
                    if (single.flip === null) return;
                    setFlipFields(
                      objects,
                      single,
                      shownSide(single.flip),
                      fields,
                      actor,
                    );
                  },
                  setDirection: (direction) => {
                    setFlipFields(
                      objects,
                      single,
                      "front",
                      { direction },
                      actor,
                    );
                  },
                }
              : null,
        };

  const allDice = units.filter((o) => o.dice !== null);
  const unlocked = allDice.filter((o) => !o.locked);
  const faces = new Set(allDice.map((o) => o.dice?.faces));
  const [onlyFaces] = faces;
  const dice: DiceActions | null =
    allDice.length === 0
      ? null
      : {
          count: allDice.length,
          roll:
            unlocked.length === 0
              ? null
              : () => {
                  const ids = new Set(unlocked.map((o) => o.id));
                  const current = readScene(objects).filter((o) =>
                    ids.has(o.id),
                  );
                  rollDice(objects, current, actor);
                },
          faces: faces.size === 1 ? (onlyFaces ?? null) : null,
          setFaces:
            unlocked.length === 0
              ? null
              : (value) => {
                  setFaces(objects, unlocked, value, actor);
                },
          sum: diceSum(allDice),
        };

  return { flip, dice, flipOne, rollOne };
}
