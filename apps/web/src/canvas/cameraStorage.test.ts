import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ZOOM } from "./camera";
import { loadCamera, saveCamera } from "./cameraStorage";

describe("CVS-05: вид доски в этом браузере", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("запоминается отдельно для каждой доски", () => {
    saveCamera("b1", { x: 1200, y: -40, zoom: 2.5 });
    saveCamera("b2", { x: 0, y: 7, zoom: 0.5 });
    expect(loadCamera("b1")).toEqual({ x: 1200, y: -40, zoom: 2.5 });
    expect(loadCamera("b2")).toEqual({ x: 0, y: 7, zoom: 0.5 });
    expect(loadCamera("b3")).toBeNull();
  });

  it("испорченная запись не ломает доску", () => {
    localStorage.setItem("myboard.camera.b1", "{not json");
    expect(loadCamera("b1")).toBeNull();
    localStorage.setItem(
      "myboard.camera.b1",
      JSON.stringify({ x: 0, y: 0, zoom: MAX_ZOOM * 10 }),
    );
    expect(loadCamera("b1")).toBeNull();
    localStorage.setItem("myboard.camera.b1", JSON.stringify({ x: "1" }));
    expect(loadCamera("b1")).toBeNull();
  });
});
