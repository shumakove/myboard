import { describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { applyLocalFits, type LocalFit } from "./localFit";
import { createObject, readScene } from "./sceneObjects";

function sceneWith(size: { width: number; height: number }) {
  const { objects } = createBoardDocument();
  const id = createObject(
    objects,
    "sticky",
    { x: 10, y: 20 },
    "",
    "Alice",
    {},
    size,
  );
  return { id, scene: readScene(objects) };
}

const FIT: LocalFit = {
  stored: { width: 480, height: 382 },
  shown: { width: 280, height: 192 },
};

describe("applyLocalFits: BUG-032", () => {
  it("объект с размером из документа показывается по виду, положение то же", () => {
    const { id, scene } = sceneWith(FIT.stored);
    const [object] = applyLocalFits(scene, new Map([[id, FIT]]));
    expect(object).toMatchObject({ x: 10, y: 20, width: 280, height: 192 });
  });

  it("размер в документе изменился — показывается он", () => {
    const { id, scene } = sceneWith({ width: 500, height: 382 });
    const [object] = applyLocalFits(scene, new Map([[id, FIT]]));
    expect(object).toMatchObject({ width: 500, height: 382 });
  });

  it("без размеров по виду сцена не копируется", () => {
    const { scene } = sceneWith(FIT.stored);
    expect(applyLocalFits(scene, new Map())).toBe(scene);
  });
});
