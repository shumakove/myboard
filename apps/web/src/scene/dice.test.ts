import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { createDice, diceSum, rollDice, rollValue, setFaces } from "./dice";
import { DICE_FACES } from "./diceData";
import { readScene, writeFields, type SceneObject } from "./sceneObjects";

// T6.11: кубик — DICE-01…DICE-03.

function board() {
  return new Y.Doc().getMap<unknown>("objects");
}

function die(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error("нет кубика");
  return found;
}

describe("DICE-01: кубик с числом граней и цветом", () => {
  it("новый кубик — 6 граней, цвет, ещё не брошен", () => {
    const objects = board();
    const id = createDice(objects, { x: 10, y: 20 }, "Alice");
    const dice = die(objects, id);
    expect(dice.type).toBe("dice");
    expect(dice.dice).toEqual({ faces: 6, value: null, roll: 0 });
    expect(dice.style.fill).toBe("#ffffff");
    expect(dice.meta.createdBy).toBe("Alice");
  });

  it("число граней — только 4, 6, 8, 10, 12, 20; смена сбрасывает значение", () => {
    const objects = board();
    const id = createDice(objects, { x: 0, y: 0 }, "Alice");
    rollDice(objects, [die(objects, id)], "Alice", () => 4);
    expect(die(objects, id).dice?.value).toBe(5);
    setFaces(objects, [die(objects, id)], 20, "Bob");
    expect(die(objects, id).dice).toMatchObject({ faces: 20, value: null });
    setFaces(objects, [die(objects, id)], 7, "Bob");
    expect(die(objects, id).dice?.faces).toBe(20);
    expect(DICE_FACES).toEqual([4, 6, 8, 10, 12, 20]);
  });

  it("неизвестное число граней в документе читается как 6", () => {
    const objects = board();
    const id = createDice(objects, { x: 0, y: 0 }, "Alice");
    writeFields(objects, new Map([[id, { faces: 3, value: 3 }]]), "Alice");
    expect(die(objects, id).dice).toMatchObject({ faces: 6, value: 3 });
  });

  it("цвет меняется общим свойством fill", () => {
    const objects = board();
    const id = createDice(objects, { x: 0, y: 0 }, "Alice");
    writeFields(objects, new Map([[id, { fill: "#81d4fa" }]]), "Alice");
    expect(die(objects, id).style.fill).toBe("#81d4fa");
  });
});

describe("DICE-02: бросок и значение", () => {
  it("значения только в диапазоне граней и выпадают все грани (много бросков)", () => {
    for (const faces of DICE_FACES) {
      const seen = new Set<number>();
      for (let i = 0; i < 2000; i += 1) {
        seen.add(rollValue(faces, () => Math.floor(Math.random() * 2 ** 32)));
      }
      expect(Math.min(...seen)).toBe(1);
      expect(Math.max(...seen)).toBe(faces);
      expect(seen.size).toBe(faces);
    }
  });

  it("крипто-генератор по умолчанию тоже даёт значения в диапазоне", () => {
    const objects = board();
    const id = createDice(objects, { x: 0, y: 0 }, "Alice");
    setFaces(objects, [die(objects, id)], 20, "Alice");
    for (let i = 0; i < 500; i += 1) {
      rollDice(objects, [die(objects, id)], "Alice");
      const value = die(objects, id).dice?.value ?? 0;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
    }
    expect(die(objects, id).dice?.roll).toBe(500);
  });

  it("хвост диапазона, не кратный граням, отбрасывается — грани равновероятны", () => {
    const samples = [2 ** 32 - 1, 2 ** 32 - 2, 7];
    expect(rollValue(6, () => samples.shift() ?? 0)).toBe(2);
    expect(samples).toEqual([]);
  });

  it("бросок отмечает автора, заблокированный кубик не бросается", () => {
    const objects = board();
    const id = createDice(objects, { x: 0, y: 0 }, "Alice");
    rollDice(objects, [die(objects, id)], "Bob", () => 0);
    expect(die(objects, id).dice?.value).toBe(1);
    expect(die(objects, id).meta.updatedBy).toBe("Bob");
    writeFields(objects, new Map([[id, { locked: true }]]), "Alice");
    rollDice(objects, [die(objects, id)], "Bob", () => 3);
    expect(die(objects, id).dice?.value).toBe(1);
  });

  it("одновременный бросок с двух клиентов — у обоих одно значение", () => {
    const first = new Y.Doc();
    const second = new Y.Doc();
    const a = first.getMap<unknown>("objects");
    const b = second.getMap<unknown>("objects");
    const id = createDice(a, { x: 0, y: 0 }, "Alice");
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    // Оба бросают, не видя броска другого.
    rollDice(a, [die(a, id)], "Alice", () => 0);
    rollDice(b, [die(b, id)], "Bob", () => 5);
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    const left = die(a, id).dice;
    const right = die(b, id).dice;
    expect(left).toEqual(right);
    expect([1, 6]).toContain(left?.value);
  });
});

describe("DICE-03: сумма последних значений", () => {
  it("сумма выделенных кубиков; не брошенный — ноль", () => {
    const objects = board();
    const ids = [0, 1, 2].map((i) =>
      createDice(objects, { x: i * 100, y: 0 }, "Alice"),
    );
    const [first, second] = ids.map((id) => die(objects, id));
    if (first === undefined || second === undefined) throw new Error();
    rollDice(objects, [first], "Alice", () => 2);
    rollDice(objects, [second], "Alice", () => 5);
    expect(diceSum(ids.map((id) => die(objects, id)))).toBe(3 + 6);
    rollDice(objects, [die(objects, ids[0] ?? "")], "Alice", () => 0);
    expect(diceSum(ids.map((id) => die(objects, id)))).toBe(1 + 6);
  });
});
