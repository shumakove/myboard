import { describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { addRecentColor, loadRecentColors } from "./recentColors";
import { createObject, readScene, type SceneObject } from "./sceneObjects";
import { RECENT_GROUP, sharedStyleKeys, styleOptions } from "./styleOptions";
import type { ObjectType } from "./objectTypes";

function objects(
  ...specs: [ObjectType, Record<string, string | number>?][]
): SceneObject[] {
  const board = createBoardDocument();
  for (const [type, style] of specs) {
    createObject(board.objects, type, { x: 0, y: 0 }, "", "", style ?? {});
  }
  return readScene(board.objects);
}

const values = (options: { value: string | number }[]) =>
  options.map((o) => o.value);

describe("SHP-02, SHP-03: свойства фигуры в панели выделения", () => {
  it("у прямоугольника — вид, заливка, обводка, толщина, скругление и текст", () => {
    expect(sharedStyleKeys(objects(["shape"]))).toEqual([
      "shape",
      "fill",
      "stroke",
      "strokeWidth",
      "radius",
      "fontSize",
      "color",
      "align",
      "lineHeight",
    ]);
  });

  it("скругления нет у видов без углов, маркер — только у фигур BPMN с маркерами", () => {
    const ellipse = sharedStyleKeys(objects(["shape", { shape: "ellipse" }]));
    expect(ellipse).not.toContain("radius");
    expect(ellipse).not.toContain("marker");
    const gateway = sharedStyleKeys(
      objects(["shape", { shape: "bpmn-gateway" }]),
    );
    expect(gateway.slice(0, 2)).toEqual(["shape", "marker"]);
  });

  it("маркеры — общего вида; у фигур разных видов маркера нет", () => {
    const start = objects(["shape", { shape: "bpmn-start" }]);
    expect(values(styleOptions("marker", start))).toEqual([
      "none",
      "message",
      "timer",
      "conditional",
      "signal",
    ]);
    const mixed = objects(
      ["shape", { shape: "bpmn-start" }],
      ["shape", { shape: "bpmn-end" }],
    );
    expect(styleOptions("marker", mixed)).toEqual([]);
    expect(sharedStyleKeys(mixed)).not.toContain("marker");
  });

  it("заливка фигуры может быть прозрачной, у стикера — нет", () => {
    expect(values(styleOptions("fill", objects(["shape"])))).toContain(
      "transparent",
    );
    expect(values(styleOptions("fill", objects(["sticky"])))).not.toContain(
      "transparent",
    );
  });

  it("список видов сгруппирован по наборам", () => {
    const groups = new Set(
      styleOptions("shape", objects(["shape"])).map((o) => o.group),
    );
    expect([...groups]).toEqual(["Basic", "Callouts", "Flowchart", "BPMN"]);
  });
});

describe("SHP-04: недавние свои цвета в списках цветов", () => {
  const recent = addRecentColor(
    addRecentColor(loadRecentColors(), ["sticky"], "#123456"),
    ["shape"],
    "#abcdef",
  );

  it("в списке заливки стикера — цвета стикера, у фигуры — цвета фигуры", () => {
    const sticky = styleOptions("fill", objects(["sticky"]), recent);
    expect(sticky.filter((o) => o.group === RECENT_GROUP)).toEqual([
      { value: "#123456", label: "#123456", group: RECENT_GROUP },
    ]);
    const shape = styleOptions("stroke", objects(["shape"]), recent);
    expect(values(shape)).toContain("#abcdef");
    expect(values(shape)).not.toContain("#123456");
  });

  it("цвета стикера не попадают в списки текста и при смешанном выделении", () => {
    expect(
      values(styleOptions("color", objects(["text"]), recent)),
    ).not.toContain("#123456");
    expect(
      values(styleOptions("fill", objects(["sticky"], ["shape"]), recent)),
    ).not.toContain("#123456");
  });
});
