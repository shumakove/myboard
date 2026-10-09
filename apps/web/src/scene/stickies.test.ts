import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import { createObject, objectMap, readScene } from "./sceneObjects";
import {
  createNextSticky,
  loadStickyColor,
  NEXT_STICKY_GAP,
  pullSticky,
  rememberStickyColor,
} from "./stickies";
import { addTag } from "./tags";

afterEach(() => {
  sessionStorage.clear();
});

function find(objects: Y.Map<unknown>, id: string) {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

describe("STK-01: цвет до постановки", () => {
  it("выбор запоминается в сессии вкладки; чужое значение — жёлтый", () => {
    expect(loadStickyColor()).toBe("#fff176");
    rememberStickyColor("#f48fb1");
    expect(loadStickyColor()).toBe("#f48fb1");
    sessionStorage.setItem("myboard.stickyColor", "red; background: url(x)");
    expect(loadStickyColor()).toBe("#fff176");
  });
});

describe("STK-04: следующий стикер", () => {
  it("справа с промежутком, того же размера, цвета и размера шрифта; автор — создавший", () => {
    const { objects } = createBoardDocument();
    const first = createObject(objects, "sticky", { x: 40, y: 60 }, "One");
    objectMap(objects, first)?.set("fill", "#81d4fa");
    objectMap(objects, first)?.set("fontSize", 32);
    objectMap(objects, first)?.set("width", 300);
    const id = createNextSticky(objects, find(objects, first), "Kate");
    expect(find(objects, id)).toMatchObject({
      type: "sticky",
      x: 40 + 300 + NEXT_STICKY_GAP,
      y: 60,
      width: 300,
      height: 200,
      text: "",
      style: { fill: "#81d4fa", fontSize: 32 },
      meta: { createdBy: "Kate" },
    });
    expect(find(objects, id).z).toBeGreaterThan(find(objects, first).z);
  });

  it("скрытый автор остаётся скрытым и у следующего", () => {
    const { objects } = createBoardDocument();
    const first = createObject(objects, "sticky", { x: 0, y: 0 });
    objectMap(objects, first)?.set("showAuthor", false);
    const id = createNextSticky(objects, find(objects, first), "Kate");
    expect(find(objects, id).showAuthor).toBe(false);
  });
});

describe("STK-05: стикер из стопки", () => {
  it("цвета стопки, с её тегами (Y.Array), центром в точке; стопка остаётся", () => {
    const { objects } = createBoardDocument();
    const stack = createObject(objects, "stack", { x: 0, y: 0 }, "", "Alice", {
      fill: "#a5d6a7",
    });
    addTag(objects, stack, "idea", "Alice");
    addTag(objects, stack, "q3", "Alice");
    const id = pullSticky(
      objects,
      find(objects, stack),
      { x: 500, y: 300 },
      "Bob",
    );
    expect(find(objects, id)).toMatchObject({
      type: "sticky",
      x: 400,
      y: 200,
      width: 200,
      height: 200,
      tags: ["idea", "q3"],
      style: { fill: "#a5d6a7" },
      meta: { createdBy: "Bob" },
    });
    expect(objectMap(objects, id)?.get("tags")).toBeInstanceOf(Y.Array);
    expect(find(objects, stack).type).toBe("stack");
    // Теги стикера — свои: правка у стикера не меняет стопку.
    addTag(objects, id, "mine", "Bob");
    expect(find(objects, stack).tags).toEqual(["idea", "q3"]);
  });
});
