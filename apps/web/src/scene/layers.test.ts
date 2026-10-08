import { describe, expect, it } from "vitest";
import { renumber, reorder, type LayerOp } from "./layers";

const siblings = ["a", "b", "c", "d"].map((id, i) => ({ id, z: i + 1 }));

function order(selected: string[], op: LayerOp): string[] {
  return reorder(siblings, new Set(selected), op).map((o) => o.id);
}

describe("CVS-18: порядок слоёв", () => {
  it("вперёд и назад — на один слой, наверх и вниз — сразу к краю", () => {
    expect(order(["b"], "forward")).toEqual(["a", "c", "b", "d"]);
    expect(order(["b"], "backward")).toEqual(["b", "a", "c", "d"]);
    expect(order(["b"], "front")).toEqual(["a", "c", "d", "b"]);
    expect(order(["c"], "back")).toEqual(["c", "a", "b", "d"]);
    // Верхний вперёд и нижний назад остаются на месте.
    expect(order(["d"], "forward")).toEqual(["a", "b", "c", "d"]);
    expect(order(["a"], "backward")).toEqual(["a", "b", "c", "d"]);
  });

  it("несколько выделенных сохраняют взаимный порядок", () => {
    expect(order(["a", "c"], "front")).toEqual(["b", "d", "a", "c"]);
    expect(order(["a", "b"], "forward")).toEqual(["c", "a", "b", "d"]);
  });

  it("новые z — целые и возрастают; меняются только сдвинутые", () => {
    const front = renumber(reorder(siblings, new Set(["a"]), "front"));
    expect([...front]).toEqual([["a", 5]]);
    const back = renumber(reorder(siblings, new Set(["d"]), "back"));
    expect([...back]).toEqual([["d", 0]]);
    const forward = renumber(reorder(siblings, new Set(["b"]), "forward"));
    expect(Object.fromEntries(forward)).toEqual({ b: 3, c: 2 });
  });

  it("одинаковые z разводятся", () => {
    const tied = [
      { id: "x", z: 1 },
      { id: "y", z: 1 },
    ];
    const changes = renumber(tied);
    const z = (id: string) =>
      changes.get(id) ?? tied.find((o) => o.id === id)?.z;
    expect(z("y")).toBeGreaterThan(z("x") ?? Infinity);
  });
});
