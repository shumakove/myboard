import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import { DEFAULT_FACES, DICE_FACES, DICE_TYPE } from "./diceData";
import {
  createObject,
  objectMap,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

/** Кубик (T6.11): постановка, бросок, число граней и сумма (DICE-01…DICE-03). */

/** DICE-01: новый кубик с левым верхним углом в `at`; возвращает id. */
export function createDice(
  objects: Y.Map<unknown>,
  at: Point,
  actor: string,
  faces = DEFAULT_FACES,
): string {
  let id = "";
  transact(objects, () => {
    id = createObject(objects, DICE_TYPE, at, "", actor);
    const map = objectMap(objects, id);
    if (map === null) return;
    map.delete("text"); // своего текста нет
    map.set("faces", faces);
    map.set("value", null);
    map.set("roll", 0);
  });
  return id;
}

/** Источник случайного числа: целое от 0 до 2^32 − 1. */
export type RandomSource = () => number;

/** Криптостойкий генератор браузера: равномерные 32 бита. */
export const cryptoRandom: RandomSource = () =>
  crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;

const RANGE = 2 ** 32;

/**
 * DICE-02: равномерное значение от 1 до `faces`. Хвост диапазона, который не делится на
 * число граней нацело, отбрасывается — иначе младшие грани выпадали бы чаще.
 */
export function rollValue(faces: number, random: RandomSource): number {
  const limit = RANGE - (RANGE % faces);
  for (;;) {
    const sample = random();
    if (sample < limit) return (sample % faces) + 1;
  }
}

/** DICE-02: бросить кубики одной транзакцией; заблокированные не бросаются (CVS-19). */
export function rollDice(
  objects: Y.Map<unknown>,
  dice: readonly SceneObject[],
  actor: string,
  random: RandomSource = cryptoRandom,
): void {
  transact(objects, () => {
    for (const object of dice) {
      if (object.dice === null || object.locked) continue;
      const map = objectMap(objects, object.id);
      if (map === null) continue;
      map.set("value", rollValue(object.dice.faces, random));
      map.set("roll", object.dice.roll + 1);
      touch(map, actor);
    }
  });
}

/**
 * DICE-01: число граней кубиков; прежнее значение сбрасывается — оно могло не
 * поместиться в новые грани.
 */
export function setFaces(
  objects: Y.Map<unknown>,
  dice: readonly SceneObject[],
  faces: number,
  actor: string,
): void {
  if (!DICE_FACES.includes(faces)) return;
  transact(objects, () => {
    for (const object of dice) {
      if (object.dice === null || object.locked) continue;
      if (object.dice.faces === faces) continue;
      const map = objectMap(objects, object.id);
      if (map === null) continue;
      map.set("faces", faces);
      map.set("value", null);
      touch(map, actor);
    }
  });
}

/** DICE-03: сумма последних значений кубиков; ещё не брошенный считается нулём. */
export function diceSum(dice: readonly SceneObject[]): number {
  return dice.reduce((sum, object) => sum + (object.dice?.value ?? 0), 0);
}
