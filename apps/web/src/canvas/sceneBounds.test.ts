import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { sceneRects } from "./sceneBounds";

describe("CVS-04: объекты доски для миникарты", () => {
  it("берёт объекты верхнего уровня с размерами — JSON и Y.Map", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    objects.set("a", { type: "sticky", x: 10, y: 20, width: 100, height: 50 });
    const shape = new Y.Map<unknown>();
    objects.set("b", shape);
    shape.set("type", "shape");
    shape.set("x", -5_000_000);
    shape.set("y", 0);
    shape.set("width", 40);
    shape.set("height", 40);
    objects.set("child", {
      type: "sticky",
      parent: "frame",
      x: 1,
      y: 1,
      width: 1,
      height: 1,
    });
    objects.set("broken", { type: "line", x: "1" });

    expect(sceneRects(objects)).toEqual([
      { x: 10, y: 20, width: 100, height: 50 },
      { x: -5_000_000, y: 0, width: 40, height: 40 },
    ]);
  });
});
