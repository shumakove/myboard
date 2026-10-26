import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { findAttachment, isConnectable } from "./connectors";
import {
  adoptContained,
  frameResizeGesture,
  lockWithFrames,
  placeInFrames,
  resizeKeepingRatio,
  setContentHidden,
} from "./frames";
import { moveGesture } from "./gestures";
import { groupObjects, removalSet } from "./groups";
import { createObject, readScene, type SceneObject } from "./sceneObjects";

// T6.6: фреймы (FRM-01…FRM-05) — модель документа.

function setup() {
  const objects = new Y.Doc().getMap<unknown>("objects");
  // Фрейм 640×480 в (0, 0), стикер 200×200 снаружи в (1000, 0).
  const frame = createObject(objects, "frame", { x: 0, y: 0 });
  const sticky = createObject(objects, "sticky", { x: 1000, y: 0 });
  return { objects, frame, sticky };
}

function find(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

/** Перенос объекта на (dx, dy) жестом перемещения и попадание во фрейм. */
function moveBy(objects: Y.Map<unknown>, id: string, dx: number, dy: number) {
  const gesture = moveGesture(
    objects,
    [find(objects, id)],
    { x: 0, y: 0 },
    {
      gridStep: 0,
      neighbors: [],
      threshold: 0,
      onGuides: () => undefined,
      actor: "Alice",
    },
  );
  gesture.end({ board: { x: dx, y: dy }, shiftKey: false, altKey: true });
  placeInFrames(objects, readScene(objects), [id], "Alice");
}

function raw(objects: Y.Map<unknown>, id: string, key: string): unknown {
  return (objects.get(id) as Y.Map<unknown>).get(key);
}

describe("FRM-01: объекты внутри фрейма", () => {
  it("перенесённый во фрейм объект становится его ребёнком и остаётся на месте", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);

    expect(find(objects, sticky)).toMatchObject({
      parent: frame,
      x: 100,
      y: 100,
    });
    expect(raw(objects, sticky, "x")).toBe(100);
  });

  it("объект во фрейме двигается вместе с фреймом", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    moveBy(objects, frame, 300, 50);

    expect(find(objects, frame)).toMatchObject({ x: 300, y: 50 });
    expect(find(objects, sticky)).toMatchObject({ x: 400, y: 150 });
  });

  it("вынесенный за фрейм объект выходит из него и больше за ним не едет", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    moveBy(objects, sticky, 900, 0);
    expect(find(objects, sticky)).toMatchObject({
      parent: null,
      x: 1000,
      y: 100,
    });

    moveBy(objects, frame, 300, 0);
    expect(find(objects, sticky)).toMatchObject({ x: 1000, y: 100 });
  });

  it("решает центр объекта: край внутри, центр снаружи — не во фрейме", () => {
    const { objects, sticky } = setup();
    // Стикер 200×200 в (560, 0): центр (660, 100) правее фрейма шириной 640.
    moveBy(objects, sticky, -440, 0);
    expect(find(objects, sticky).parent).toBeNull();
  });

  it("новый фрейм забирает объекты, лежащие в нём целиком", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    const inside = createObject(objects, "sticky", { x: 100, y: 100 });
    const across = createObject(objects, "sticky", { x: 500, y: 100 });
    const frame = createObject(objects, "frame", { x: 0, y: 0 });
    adoptContained(objects, readScene(objects), frame, "Alice");

    expect(find(objects, inside).parent).toBe(frame);
    expect(find(objects, across).parent).toBeNull();
    // Фрейм рисуется перед своими объектами.
    const order = readScene(objects).map((o) => o.id);
    expect(order.indexOf(frame)).toBeLessThan(order.indexOf(inside));
  });

  it("группа попадает во фрейм целиком, объекты группы остаются в группе", () => {
    const { objects, frame } = setup();
    const a = createObject(objects, "sticky", { x: 1000, y: 300 });
    const b = createObject(objects, "sticky", { x: 1300, y: 300 });
    const group = groupObjects(
      objects,
      readScene(objects),
      readScene(objects).filter((o) => o.id === a || o.id === b),
      "Alice",
    );
    if (group === null) throw new Error("группа не создана");
    moveBy(objects, group, -1000, -250);

    expect(find(objects, group).parent).toBe(frame);
    expect(find(objects, a)).toMatchObject({ parent: group, x: 0, y: 50 });
  });

  it("к фрейму можно привязать линию; объект внутри перекрывает фрейм", () => {
    const { objects, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    const scene = readScene(objects);

    expect(isConnectable("frame")).toBe(true);
    expect(findAttachment(scene, { x: 600, y: 400 }, 0)?.object).toBe(
      scene.find((o) => o.type === "frame")?.id,
    );
    expect(findAttachment(scene, { x: 200, y: 200 }, 0)?.object).toBe(sticky);
  });

  it("удаление фрейма удаляет и его содержимое", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    expect(removalSet(readScene(objects), [frame]).sort()).toEqual(
      [frame, sticky].sort(),
    );
  });
});

describe("FRM-03: пропорции фрейма", () => {
  it("за любой угол размер меняется в прежнем соотношении сторон", () => {
    const frame = { x: 0, y: 0, width: 400, height: 300, rotation: 0 };
    expect(resizeKeepingRatio(frame, "se", { x: 800, y: 320 })).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
      rotation: 0,
    });
    expect(resizeKeepingRatio(frame, "nw", { x: 200, y: 200 })).toEqual({
      x: 200,
      y: 150,
      width: 200,
      height: 150,
      rotation: 0,
    });
  });

  it("с фиксацией пропорций жест за угол сохраняет соотношение, без неё — нет", () => {
    const { objects, frame } = setup();
    const resize = () => {
      const gesture = frameResizeGesture(
        objects,
        find(objects, frame),
        [],
        "se",
        "Alice",
      );
      gesture.end({
        board: { x: 1280, y: 600 },
        shiftKey: false,
        altKey: false,
      });
    };
    resize();
    expect(find(objects, frame)).toMatchObject({ width: 1280, height: 600 });

    (objects.get(frame) as Y.Map<unknown>).set("width", 640);
    (objects.get(frame) as Y.Map<unknown>).set("height", 480);
    (objects.get(frame) as Y.Map<unknown>).set("keepRatio", true);
    resize();
    expect(find(objects, frame)).toMatchObject({ width: 1280, height: 960 });
  });

  it("при изменении размера за левый верхний угол объекты внутри не сдвигаются", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    const gesture = frameResizeGesture(
      objects,
      find(objects, frame),
      readScene(objects).filter((o) => o.parent === frame),
      "nw",
      "Alice",
    );
    gesture.end({ board: { x: -100, y: -50 }, shiftKey: false, altKey: false });

    expect(find(objects, frame)).toMatchObject({
      x: -100,
      y: -50,
      width: 740,
      height: 530,
    });
    expect(find(objects, sticky)).toMatchObject({ x: 100, y: 100 });
  });
});

describe("FRM-04: скрытие содержимого", () => {
  it("скрытое содержимое помечено hidden, показ возвращает его", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    setContentHidden(objects, [find(objects, frame)], true, "Alice");
    expect(find(objects, sticky).hidden).toBe(true);
    expect(find(objects, frame).hidden).toBe(false);

    setContentHidden(objects, [find(objects, frame)], false, "Alice");
    expect(find(objects, sticky).hidden).toBe(false);
  });

  it("работает и у заблокированного фрейма", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    lockWithFrames(objects, [find(objects, frame)], true, "Alice");
    setContentHidden(objects, [find(objects, frame)], true, "Bob");

    expect(find(objects, frame)).toMatchObject({
      locked: true,
      frameOptions: { contentHidden: true },
    });
    expect(find(objects, sticky).hidden).toBe(true);
  });

  it("во фрейм со скрытым содержимым объекты не попадают", () => {
    const { objects, frame, sticky } = setup();
    setContentHidden(objects, [find(objects, frame)], true, "Alice");
    moveBy(objects, sticky, -900, 100);
    expect(find(objects, sticky).parent).toBeNull();
  });
});

describe("FRM-05: блокировка фрейма", () => {
  it("только рамка: фрейм заблокирован, содержимое — нет", () => {
    const { objects, frame, sticky } = setup();
    moveBy(objects, sticky, -900, 100);
    lockWithFrames(objects, [find(objects, frame)], false, "Alice");

    expect(find(objects, frame).locked).toBe(true);
    expect(find(objects, sticky).locked).toBe(false);
    // Объект внутри по-прежнему двигается и может выйти из фрейма.
    moveBy(objects, sticky, 900, 0);
    expect(find(objects, sticky)).toMatchObject({ parent: null, x: 1000 });
  });

  it("рамка с содержимым: заблокировано и содержимое, новые объекты не попадают", () => {
    const { objects, frame, sticky } = setup();
    const other = createObject(objects, "sticky", { x: 1000, y: 300 });
    moveBy(objects, sticky, -900, 100);
    lockWithFrames(objects, [find(objects, frame)], true, "Alice");

    expect(find(objects, sticky).locked).toBe(true);
    moveBy(objects, other, -900, -200);
    expect(find(objects, other).parent).toBeNull();
  });

  it("в заблокированный только рамкой фрейм объекты попадают", () => {
    const { objects, frame, sticky } = setup();
    lockWithFrames(objects, [find(objects, frame)], false, "Alice");
    moveBy(objects, sticky, -900, 100);
    expect(find(objects, sticky)).toMatchObject({
      parent: frame,
      locked: false,
    });
  });
});
