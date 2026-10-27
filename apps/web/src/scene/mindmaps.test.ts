import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import { copyObjects, pasteObjects } from "./clipboard";
import {
  dropAt,
  nodeMap,
  nodeText,
  type MindmapNode,
  type MindmapShape,
} from "./mindmapData";
import {
  addChild,
  addSibling,
  createMindmap,
  deleteNode,
  moveNode,
  recolorNode,
  toggleNode,
} from "./mindmaps";
import { objectMap, readScene, type SceneObject } from "./sceneObjects";
import { linkedDocs } from "./testDocs";

// T6.9: интеллект-карта (MAP-01…MAP-04) — данные документа и раскладка.

function find(objects: Y.Map<unknown>, id: string): SceneObject {
  const found = readScene(objects).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

function shapeOf(objects: Y.Map<unknown>, id: string): MindmapShape {
  const shape = find(objects, id).mindmap;
  if (shape === null) throw new Error("не интеллект-карта");
  return shape;
}

function nodeOf(objects: Y.Map<unknown>, id: string, node: string) {
  const found = shapeOf(objects, id).byId.get(node);
  if (found === undefined) throw new Error(`нет узла ${node}`);
  return found;
}

/** Названия детей узла по порядку. */
function childTexts(objects: Y.Map<unknown>, id: string, node: string) {
  return nodeOf(objects, id, node).children.map(
    (kid) => nodeOf(objects, id, kid).text,
  );
}

/** Id узла по названию. */
function byText(objects: Y.Map<unknown>, id: string, text: string): string {
  const found = [...shapeOf(objects, id).byId.values()].find(
    (n) => n.text === text,
  );
  if (found === undefined) throw new Error(`нет узла «${text}»`);
  return found.id;
}

function rename(
  objects: Y.Map<unknown>,
  id: string,
  node: string,
  text: string,
) {
  const map = objectMap(objects, id);
  const field = map === null ? null : nodeText(map, node);
  if (field === null) throw new Error("нет названия");
  field.delete(0, field.length);
  field.insert(0, text);
}

/** Середина корня на доске — точка, где корень стоит при любой раскладке. */
function rootCenter(objects: Y.Map<unknown>, id: string) {
  const map = find(objects, id);
  const shape = shapeOf(objects, id);
  const root = shape.byId.get(shape.root) as MindmapNode;
  return { x: map.x + root.x, y: map.y + root.y + root.height / 2 };
}

/** Карта с левым верхним углом в (0, 0): корень Main topic, дети Idea 1, Idea 2. */
function mindmapBoard() {
  const board = createBoardDocument();
  const mindmap = createMindmap(board.objects, { x: 0, y: 0 }, "Alice");
  const root = shapeOf(board.objects, mindmap).root;
  return { board, objects: board.objects, mindmap, root };
}

describe("MAP-01: карта с корнем и дочерними узлами", () => {
  it("новая карта — корень и два дочерних узла, рамка от угла постановки", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const object = find(objects, mindmap);
    expect(object).toMatchObject({ type: "mindmap", x: 0, y: 0, rotation: 0 });
    const shape = shapeOf(objects, mindmap);
    expect(nodeOf(objects, mindmap, root)).toMatchObject({
      text: "Main topic",
      parent: null,
      depth: 0,
    });
    expect(childTexts(objects, mindmap, root)).toEqual(["Idea 1", "Idea 2"]);
    // Дети правее корня, друг под другом; корень — по середине их высоты.
    const [first, second] = shape.nodes.slice(1);
    const rootNode = shape.nodes[0] as MindmapNode;
    expect(first?.x).toBeGreaterThan(rootNode.x + rootNode.width);
    expect(second?.y).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0));
    expect(rootNode.y + rootNode.height / 2).toBe(shape.height / 2);
    expect(object.width).toBe(shape.width);
    expect(object.height).toBe(shape.height);
  });

  it("узлы ищутся по названиям (CVS-08)", () => {
    const { objects, mindmap } = mindmapBoard();
    expect(find(objects, mindmap).text.split("\n").sort()).toEqual([
      "Idea 1",
      "Idea 2",
      "Main topic",
    ]);
  });

  it("копия карты (CVS-20) — те же узлы, правка копии не меняет оригинал", () => {
    const { objects, mindmap } = mindmapBoard();
    const clip = copyObjects(objects, readScene(objects), [mindmap]);
    if (clip === null) throw new Error("нечего копировать");
    const [copy] = pasteObjects(
      objects,
      clip,
      {
        kind: "offset",
        offset: { x: 400, y: 0 },
        parent: null,
        cell: null,
        origin: { x: 0, y: 0 },
      },
      "Bob",
    );
    if (copy === undefined) throw new Error("копия не вставлена");
    expect(find(objects, copy)).toMatchObject({ x: 400, y: 0 });
    rename(objects, copy, byText(objects, copy, "Idea 1"), "Copy");
    expect(childTexts(objects, copy, shapeOf(objects, copy).root)).toEqual([
      "Copy",
      "Idea 2",
    ]);
    expect(
      childTexts(objects, mindmap, shapeOf(objects, mindmap).root),
    ).toEqual(["Idea 1", "Idea 2"]);
  });
});

describe("MAP-02: операции с узлами", () => {
  it("дочерний узел — в конце детей с цветом родителя; корень остаётся на месте", () => {
    const { objects, mindmap } = mindmapBoard();
    const idea = byText(objects, mindmap, "Idea 1");
    recolorNode(objects, mindmap, idea, "#a5d6a7", false, "Alice");
    const before = rootCenter(objects, mindmap);
    const first = addChild(objects, mindmap, idea, "Bob");
    const second = addChild(objects, mindmap, idea, "Bob");
    if (first === null || second === null) throw new Error("узел не добавлен");
    expect(nodeOf(objects, mindmap, idea).children).toEqual([first, second]);
    expect(nodeOf(objects, mindmap, first)).toMatchObject({
      parent: idea,
      color: "#a5d6a7",
      text: "",
      depth: 2,
    });
    expect(rootCenter(objects, mindmap)).toEqual(before);
    expect(find(objects, mindmap).meta.updatedBy).toBe("Bob");
  });

  it("соседний узел встаёт сразу после выбранного; у корня — дочерний", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const sibling = addSibling(
      objects,
      mindmap,
      byText(objects, mindmap, "Idea 1"),
      "Alice",
    );
    if (sibling === null) throw new Error("узел не добавлен");
    rename(objects, mindmap, sibling, "Between");
    expect(childTexts(objects, mindmap, root)).toEqual([
      "Idea 1",
      "Between",
      "Idea 2",
    ]);
    const child = addSibling(objects, mindmap, root, "Alice");
    if (child === null) throw new Error("узел не добавлен");
    expect(nodeOf(objects, mindmap, child).parent).toBe(root);
  });

  it("переименование и перекраска узла", () => {
    const { objects, mindmap } = mindmapBoard();
    const idea = byText(objects, mindmap, "Idea 2");
    rename(objects, mindmap, idea, "Budget");
    recolorNode(objects, mindmap, idea, "#f48fb1", false, "Alice");
    expect(nodeOf(objects, mindmap, idea)).toMatchObject({
      text: "Budget",
      color: "#f48fb1",
    });
  });

  it("удаление узла убирает его ветку; корень не удаляется", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const idea = byText(objects, mindmap, "Idea 1");
    const kid = addChild(objects, mindmap, idea, "Alice") as string;
    deleteNode(objects, mindmap, idea, "Alice");
    const shape = shapeOf(objects, mindmap);
    expect(shape.byId.has(idea)).toBe(false);
    expect(shape.byId.has(kid)).toBe(false);
    expect(childTexts(objects, mindmap, root)).toEqual(["Idea 2"]);
    deleteNode(objects, mindmap, root, "Alice");
    expect(shapeOf(objects, mindmap).root).toBe(root);
  });

  it("перестановка: в конец детей цели, перед ней и после неё", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const one = byText(objects, mindmap, "Idea 1");
    const two = byText(objects, mindmap, "Idea 2");
    const three = addChild(objects, mindmap, root, "Alice") as string;
    rename(objects, mindmap, three, "Idea 3");

    moveNode(objects, mindmap, three, { target: one, place: "before" }, "Bob");
    expect(childTexts(objects, mindmap, root)).toEqual([
      "Idea 3",
      "Idea 1",
      "Idea 2",
    ]);
    moveNode(objects, mindmap, three, { target: two, place: "after" }, "Bob");
    expect(childTexts(objects, mindmap, root)).toEqual([
      "Idea 1",
      "Idea 2",
      "Idea 3",
    ]);
    moveNode(objects, mindmap, one, { target: two, place: "child" }, "Bob");
    expect(childTexts(objects, mindmap, root)).toEqual(["Idea 2", "Idea 3"]);
    expect(childTexts(objects, mindmap, two)).toEqual(["Idea 1"]);
    expect(nodeOf(objects, mindmap, one).depth).toBe(2);
  });

  it("узел не кладётся в свою ветку, корень не переносится", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const one = byText(objects, mindmap, "Idea 1");
    const kid = addChild(objects, mindmap, one, "Alice") as string;
    moveNode(objects, mindmap, one, { target: kid, place: "child" }, "Bob");
    moveNode(objects, mindmap, root, { target: one, place: "child" }, "Bob");
    expect(nodeOf(objects, mindmap, kid).parent).toBe(one);
    expect(nodeOf(objects, mindmap, one).parent).toBe(root);
    expect(nodeOf(objects, mindmap, root).parent).toBeNull();
  });

  it("цель под указателем: края узла — до и после, середина — внутрь, своя ветка — нет", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const shape = shapeOf(objects, mindmap);
    const one = byText(objects, mindmap, "Idea 1");
    const two = nodeOf(objects, mindmap, byText(objects, mindmap, "Idea 2"));
    const mid = two.x + two.width / 2;
    expect(dropAt(shape, one, { x: mid, y: two.y + 2 })).toEqual({
      target: two.id,
      place: "before",
    });
    expect(dropAt(shape, one, { x: mid, y: two.y + two.height / 2 })).toEqual({
      target: two.id,
      place: "child",
    });
    expect(dropAt(shape, one, { x: mid, y: two.y + two.height - 2 })).toEqual({
      target: two.id,
      place: "after",
    });
    const rootNode = nodeOf(objects, mindmap, root);
    expect(
      dropAt(shape, one, { x: rootNode.x + 4, y: rootNode.y + 2 }),
    ).toEqual({ target: root, place: "child" });
    const own = nodeOf(objects, mindmap, one);
    expect(dropAt(shape, one, { x: own.x + 4, y: own.y + 4 })).toBeNull();
    expect(dropAt(shape, one, { x: -50, y: -50 })).toBeNull();
  });
});

describe("MAP-03: сворачивание веток", () => {
  it("свёрнутая ветка скрывает узлы под собой, корень остаётся на месте", () => {
    const { objects, mindmap } = mindmapBoard();
    const one = byText(objects, mindmap, "Idea 1");
    const kid = addChild(objects, mindmap, one, "Alice") as string;
    addChild(objects, mindmap, kid, "Alice");
    const before = rootCenter(objects, mindmap);
    toggleNode(objects, mindmap, one, "Bob");
    const shape = shapeOf(objects, mindmap);
    expect(shape.nodes.map((n) => n.id)).not.toContain(kid);
    expect(nodeOf(objects, mindmap, one)).toMatchObject({
      collapsed: true,
      descendants: 2,
    });
    expect(rootCenter(objects, mindmap)).toEqual(before);
    toggleNode(objects, mindmap, one, "Bob");
    expect(shapeOf(objects, mindmap).nodes.map((n) => n.id)).toContain(kid);
  });

  it("ветки корня сворачиваются: видно только корень, рамка — по нему", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const before = rootCenter(objects, mindmap);
    toggleNode(objects, mindmap, root, "Alice");
    const shape = shapeOf(objects, mindmap);
    expect(shape.nodes.map((n) => n.id)).toEqual([root]);
    expect(find(objects, mindmap).height).toBe(
      nodeOf(objects, mindmap, root).height,
    );
    expect(rootCenter(objects, mindmap)).toEqual(before);
  });

  it("узел без детей не сворачивается; новый ребёнок раскрывает свёрнутую ветку", () => {
    const { objects, mindmap, root } = mindmapBoard();
    const two = byText(objects, mindmap, "Idea 2");
    toggleNode(objects, mindmap, two, "Alice");
    expect(nodeOf(objects, mindmap, two).collapsed).toBe(false);
    toggleNode(objects, mindmap, root, "Alice");
    const kid = addChild(objects, mindmap, root, "Alice") as string;
    expect(shapeOf(objects, mindmap).nodes.map((n) => n.id)).toContain(kid);
  });
});

describe("MAP-04: перекраска с дочерними узлами или без", () => {
  function tree() {
    const setup = mindmapBoard();
    const { objects, mindmap } = setup;
    const one = byText(objects, mindmap, "Idea 1");
    const kid = addChild(objects, mindmap, one, "Alice") as string;
    const grandkid = addChild(objects, mindmap, kid, "Alice") as string;
    // Свёрнутая ветка тоже перекрашивается.
    toggleNode(objects, mindmap, kid, "Alice");
    return { ...setup, one, kid, grandkid };
  }

  it("ответ «да» — перекрашены узел и все узлы под ним", () => {
    const { objects, mindmap, one, kid, grandkid } = tree();
    recolorNode(objects, mindmap, one, "#ce93d8", true, "Alice");
    for (const id of [one, kid, grandkid]) {
      expect(nodeOf(objects, mindmap, id).color).toBe("#ce93d8");
    }
    expect(
      nodeOf(objects, mindmap, byText(objects, mindmap, "Idea 2")).color,
    ).not.toBe("#ce93d8");
  });

  it("ответ «нет» — перекрашен только узел", () => {
    const { objects, mindmap, one, kid, grandkid } = tree();
    const old = nodeOf(objects, mindmap, kid).color;
    recolorNode(objects, mindmap, one, "#ce93d8", false, "Alice");
    expect(nodeOf(objects, mindmap, one).color).toBe("#ce93d8");
    expect(nodeOf(objects, mindmap, kid).color).toBe(old);
    expect(nodeOf(objects, mindmap, grandkid).color).toBe(old);
  });
});

describe("T6.9: одновременные правки двух участников", () => {
  function linked() {
    const [docA, docB] = linkedDocs();
    const a = createBoardDocument(docA).objects;
    const b = createBoardDocument(docB).objects;
    const mindmap = createMindmap(a, { x: 0, y: 0 }, "Alice");
    return { a, b, mindmap, root: shapeOf(a, mindmap).root };
  }

  it("узлы, добавленные обоими, есть у обоих; правки названий разных узлов сливаются", () => {
    const { a, b, mindmap, root } = linked();
    addChild(a, mindmap, root, "Alice");
    addChild(b, mindmap, root, "Bob");
    rename(a, mindmap, byText(a, mindmap, "Idea 1"), "Alice idea");
    rename(b, mindmap, byText(b, mindmap, "Idea 2"), "Bob idea");
    expect(shapeOf(a, mindmap).byId.size).toBe(5);
    expect(childTexts(a, mindmap, root)).toEqual(childTexts(b, mindmap, root));
    expect(childTexts(b, mindmap, root).slice(0, 2)).toEqual([
      "Alice idea",
      "Bob idea",
    ]);
  });

  it("узлы, вложенные друг в друга одновременно, не пропадают — встают под корень", () => {
    const [docA, docB] = [new Y.Doc(), new Y.Doc()];
    const a = createBoardDocument(docA).objects;
    const b = createBoardDocument(docB).objects;
    const mindmap = createMindmap(a, { x: 0, y: 0 }, "Alice");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const one = byText(a, mindmap, "Idea 1");
    const two = byText(a, mindmap, "Idea 2");
    moveNode(a, mindmap, one, { target: two, place: "child" }, "Alice");
    moveNode(b, mindmap, two, { target: one, place: "child" }, "Bob");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    const root = shapeOf(a, mindmap).root;
    expect(childTexts(a, mindmap, root).sort()).toEqual(["Idea 1", "Idea 2"]);
    expect(childTexts(b, mindmap, root).sort()).toEqual(["Idea 1", "Idea 2"]);
  });

  it("узел, удалённый у одного, пока другой добавлял ему ребёнка, — ребёнок под корнем", () => {
    const [docA, docB] = [new Y.Doc(), new Y.Doc()];
    const a = createBoardDocument(docA).objects;
    const b = createBoardDocument(docB).objects;
    const mindmap = createMindmap(a, { x: 0, y: 0 }, "Alice");
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const one = byText(a, mindmap, "Idea 1");
    deleteNode(a, mindmap, one, "Alice");
    const kid = addChild(b, mindmap, one, "Bob") as string;
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    expect(nodeOf(a, mindmap, kid).parent).toBe(shapeOf(a, mindmap).root);
    expect(
      nodeMap(objectMap(a, mindmap) as Y.Map<unknown>, kid),
    ).not.toBeNull();
  });
});
