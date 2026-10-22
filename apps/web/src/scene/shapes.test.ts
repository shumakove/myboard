import { describe, expect, it } from "vitest";
import { shapeIcons } from "./bpmnMarkers";
import { polygon, shapeParts } from "./shapeGeometry";
import {
  newShapeFields,
  SHAPE_KINDS,
  SHAPE_SETS,
  shapeKind,
  shapeMarker,
} from "./shapes";

const kindsOf = (set: string) =>
  SHAPE_KINDS.filter((kind) => kind.set === set).map((kind) => kind.id);

describe("SHP-01: наборы фигур", () => {
  it("есть базовые фигуры, выноски и фигуры блок-схем", () => {
    expect(SHAPE_SETS.map((set) => set.label)).toEqual([
      "Basic",
      "Callouts",
      "Flowchart",
      "BPMN",
    ]);
    expect(kindsOf("basic")).toEqual(
      expect.arrayContaining(["rectangle", "ellipse", "triangle", "diamond"]),
    );
    expect(kindsOf("callout")).toEqual(
      expect.arrayContaining(["callout-rect", "callout-oval", "callout-cloud"]),
    );
    expect(kindsOf("flowchart")).toEqual(
      expect.arrayContaining([
        "process",
        "decision",
        "terminator",
        "data",
        "document",
        "database",
      ]),
    );
  });

  it("у каждого вида — контур из конечных координат при любом размере и скруглении", () => {
    for (const kind of SHAPE_KINDS) {
      for (const [w, h, r] of [
        [200, 120, 0],
        [10, 10, 48],
        [0, 0, 8],
      ] as const) {
        const parts = shapeParts(kind, w, h, r);
        expect(parts.length, kind.id).toBeGreaterThan(0);
        expect(parts[0]?.filled, kind.id).toBe(true);
        for (const part of parts) {
          expect(part.d, kind.id).toMatch(/^M/);
          expect(part.d, kind.id).not.toMatch(/NaN|Infinity|undefined/);
        }
      }
    }
  });

  it("неизвестный или пустой вид — прямоугольник (фигуры, созданные до T6.3)", () => {
    expect(shapeKind(undefined).id).toBe("rectangle");
    expect(shapeKind("no-such-shape").id).toBe("rectangle");
    expect(shapeKind("diamond").label).toBe("Diamond");
  });

  it("новая фигура — размера и оформления своего вида", () => {
    expect(newShapeFields(shapeKind("connector"))).toEqual({
      width: 70,
      height: 70,
      style: { shape: "connector" },
    });
    expect(newShapeFields(shapeKind("bpmn-end"))).toEqual({
      width: 60,
      height: 60,
      style: { shape: "bpmn-end", strokeWidth: 4, marker: "none" },
    });
  });
});

describe("SHP-02: фигуры BPMN и их маркеры", () => {
  it("набор BPMN: задача, подпроцесс, события, шлюз, данные, пул", () => {
    expect(kindsOf("bpmn")).toEqual(
      expect.arrayContaining([
        "bpmn-task",
        "bpmn-subprocess",
        "bpmn-start",
        "bpmn-intermediate",
        "bpmn-end",
        "bpmn-gateway",
        "bpmn-data-object",
        "bpmn-data-store",
        "bpmn-pool",
      ]),
    );
  });

  it("маркер — записанный, если он есть у вида, иначе первый маркер вида", () => {
    const gateway = shapeKind("bpmn-gateway");
    expect(shapeMarker(gateway, undefined)).toBe("exclusive");
    expect(shapeMarker(gateway, "parallel")).toBe("parallel");
    expect(shapeMarker(gateway, "timer")).toBe("exclusive");
    expect(shapeMarker(shapeKind("rectangle"), "parallel")).toBeNull();
  });

  it("у каждого маркера фигуры BPMN есть значок, у «None» — нет", () => {
    for (const kind of SHAPE_KINDS.filter((k) => k.markers)) {
      for (const marker of kind.markers ?? []) {
        const icons = shapeIcons(kind, marker.id, 100, 80);
        const own = kind.id === "bpmn-subprocess" ? icons.slice(1) : icons;
        expect(own.length, `${kind.id}/${marker.id}`).toBe(
          marker.id === "none" ? 0 : 1,
        );
      }
    }
  });

  it("свёрнутый подпроцесс всегда со знаком «+»", () => {
    expect(
      shapeIcons(shapeKind("bpmn-subprocess"), "none", 180, 110),
    ).toHaveLength(1);
  });
});

describe("SHP-03: скругление углов", () => {
  const square = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ] as const;

  it("без скругления — ломаная, со скруглением — дуги в углах", () => {
    expect(polygon(square, 100, 50)).toBe("M0,0L100,0L100,50L0,50Z");
    const rounded = polygon(square, 100, 50, 10);
    expect(rounded.match(/Q/g)).toHaveLength(4);
    expect(rounded.startsWith("M0,10Q0,0 10,0")).toBe(true);
  });

  it("радиус не больше половины короткой стороны", () => {
    expect(polygon(square, 100, 20, 50).startsWith("M0,10Q0,0 10,0")).toBe(
      true,
    );
  });

  it("у видов без углов скругление не меняет контур", () => {
    const ellipse = shapeKind("ellipse");
    expect(shapeParts(ellipse, 100, 60, 24)).toEqual(
      shapeParts(ellipse, 100, 60, 0),
    );
  });
});
