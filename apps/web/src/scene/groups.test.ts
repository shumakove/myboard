import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  enterGroup,
  groupObjects,
  removalSet,
  selectionTarget,
  ungroupObjects,
} from "./groups";
import { setLocked } from "./lock";
import {
  createObject,
  patchObjects,
  readScene,
  type SceneObject,
} from "./sceneObjects";

function setup() {
  const objects = new Y.Doc().getMap<unknown>("objects");
  const a = createObject(objects, "sticky", { x: 100, y: 100 });
  const b = createObject(objects, "shape", { x: 400, y: 200 });
  const c = createObject(objects, "text", { x: 0, y: 600 });
  return { objects, a, b, c };
}

function find(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

function units(objects: Y.Map<unknown>, ids: string[]): SceneObject[] {
  return readScene(objects).filter((o) => ids.includes(o.id));
}

describe("CVS-17: группы", () => {
  it("группа — объект документа; объекты остаются на месте, координаты — относительно группы", () => {
    const { objects, a, b, c } = setup();
    const group = groupObjects(
      objects,
      readScene(objects),
      units(objects, [a, b]),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");

    expect(find(objects, a)).toMatchObject({ x: 100, y: 100, parent: group });
    expect(find(objects, b)).toMatchObject({ x: 400, y: 200, parent: group });
    expect((objects.get(a) as Y.Map<unknown>).get("x")).toBe(0);
    // Рамка группы — по её объектам; группа встаёт на место верхнего (b, z = 2).
    expect(find(objects, group)).toMatchObject({
      type: "group",
      x: 100,
      y: 100,
      width: 500,
      height: 220,
      z: 2,
      meta: { createdBy: "Alice" },
    });
    // Порядок отрисовки: c выше группы по z, группа — перед своими объектами.
    expect(readScene(objects).map((o) => o.id)).toEqual([group, a, b, c]);

    // Сдвиг группы двигает её объекты; размер у группы не записывается.
    patchObjects(
      objects,
      new Map([[find(objects, group), { x: 150, width: 10 }]]),
      "Bob",
    );
    expect(find(objects, group)).toMatchObject({ x: 150, width: 500 });
    expect(find(objects, a).x).toBe(150);
    expect(find(objects, b).x).toBe(450);
  });

  it("разгруппировка возвращает объекты на верхний уровень на прежние места и в прежнем порядке", () => {
    const { objects, a, b, c } = setup();
    const group = groupObjects(
      objects,
      readScene(objects),
      units(objects, [a, b]),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");
    const freed = ungroupObjects(
      objects,
      readScene(objects),
      units(objects, [group]),
      "Bob",
    );
    expect(freed.sort()).toEqual([a, b].sort());
    expect(objects.has(group)).toBe(false);
    expect(find(objects, a)).toMatchObject({ x: 100, y: 100, parent: null });
    expect(find(objects, b)).toMatchObject({ x: 400, y: 200, parent: null });
    expect(readScene(objects).map((o) => o.id)).toEqual([a, b, c]);
  });

  it("группировать можно только объекты одного родителя и без блокировки", () => {
    const { objects, a, b } = setup();
    setLocked(objects, [a], true, "Alice");
    expect(
      groupObjects(objects, readScene(objects), units(objects, [a, b]), "A"),
    ).toBeNull();
    expect(
      groupObjects(objects, readScene(objects), units(objects, [b]), "A"),
    ).toBeNull();
  });

  it("щелчок по объекту группы выделяет группу, двойной — входит в неё", () => {
    const { objects, a, b } = setup();
    const group = groupObjects(
      objects,
      readScene(objects),
      units(objects, [a, b]),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");
    const scene = readScene(objects);
    expect(selectionTarget(scene, a, [])).toBe(group);
    expect(selectionTarget(scene, a, [group])).toBe(group);
    expect(enterGroup(scene, a, [group])).toBe(a);
    // Внутри группы щелчок выделяет соседний объект, а не группу.
    expect(selectionTarget(scene, b, [a])).toBe(b);
  });

  it("CVS-21: удаление группы забирает её объекты; опустевшая группа удаляется", () => {
    const { objects, a, b } = setup();
    const group = groupObjects(
      objects,
      readScene(objects),
      units(objects, [a, b]),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");
    const scene = readScene(objects);
    expect(removalSet(scene, [group]).sort()).toEqual([group, a, b].sort());
    expect(removalSet(scene, [a])).toEqual([a]);
    expect(removalSet(scene, [a, b]).sort()).toEqual([group, a, b].sort());
  });

  it("CVS-19: заблокированное не удаляется, группа с заблокированным объектом — тоже", () => {
    const { objects, a, b, c } = setup();
    const group = groupObjects(
      objects,
      readScene(objects),
      units(objects, [a, b]),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");
    setLocked(objects, [a, c], true, "Alice");
    const scene = readScene(objects);
    expect(removalSet(scene, [group, c])).toEqual([]);
    expect(removalSet(scene, [b])).toEqual([b]);
  });
});
