import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBoardDocument,
  type BoardDocument,
} from "../realtime/boardDocument";
import { addChild, createMindmap } from "./mindmaps";
import { linkedDocs } from "./testDocs";
import {
  canvas,
  click,
  drag,
  element,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.9: интеллект-карты (MAP-01…MAP-04) — через интерфейс сцены. Карта в (0, 0):
// корень Main topic — x 0…142, y 18…74; Idea 1 — x 198…294, y 0…40; Idea 2 — y 52…92.

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function barButton(name: string) {
  return within(selectionBar()).getByRole("button", { name });
}

function mindmapBoard(doc = createBoardDocument()) {
  const id = createMindmap(doc.objects, { x: 0, y: 0 }, "Alice");
  return { board: doc, id };
}

function shape(board: BoardDocument, id: string) {
  const found = object(board, id).mindmap;
  if (found === null) throw new Error("не интеллект-карта");
  return found;
}

function nodeId(board: BoardDocument, id: string, text: string) {
  const found = [...shape(board, id).byId.values()].find(
    (n) => n.text === text,
  );
  if (found === undefined) throw new Error(`нет узла «${text}»`);
  return found.id;
}

/** Узел на холсте и точка в его середине. */
function nodeAt(board: BoardDocument, id: string, text: string) {
  const node = shape(board, id).byId.get(nodeId(board, id, text));
  const found = element(id).querySelector<HTMLElement>(
    `[data-node="${node?.id ?? ""}"]`,
  );
  if (node === undefined || found === null) throw new Error("узла нет");
  const map = object(board, id);
  const at: [number, number] = [
    map.x + node.x + node.width / 2,
    map.y + node.y + node.height / 2,
  ];
  return { element: found, at, node };
}

/** Названия детей узла по порядку. */
function childTexts(board: BoardDocument, id: string, text: string) {
  const all = shape(board, id).byId;
  return (all.get(nodeId(board, id, text))?.children ?? []).map(
    (kid) => all.get(kid)?.text,
  );
}

/** Названия видимых узлов на холсте. */
function shownTexts(id: string) {
  return [...element(id).querySelectorAll("[data-node]")].map(
    (n) => n.textContent,
  );
}

function toggle(name: string) {
  return screen.getByRole("button", { name });
}

describe("MAP-01: интеллект-карта на холсте", () => {
  it("инструмент Mind map (клавиша I) ставит карту с корнем и двумя дочерними узлами", () => {
    const board = createBoardDocument();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyI", key: "i" });
    click(canvas(), [400, 200]);
    const map = scene(board).find((o) => o.type === "mindmap");
    if (map === undefined) throw new Error("карта не создана");
    expect(element(map.id).getAttribute("aria-label")).toBe("Mind map");
    expect(shownTexts(map.id)).toEqual(["Main topic", "Idea 1", "Idea 2"]);
    // Ветки — кривые от корня к детям.
    expect(
      element(map.id).querySelectorAll(".mindmap-branches path"),
    ).toHaveLength(2);
    // Размер карты задают узлы: маркеров размера нет.
    expect(document.querySelector('[data-handle="se"]')).toBeNull();
  });
});

describe("MAP-02: операции с узлами", () => {
  it("щелчок выбирает узел; Add child — новый узел сразу в правке названия", async () => {
    const user = userEvent.setup();
    const { board, id } = mindmapBoard();
    renderScene(board);
    const idea = nodeAt(board, id, "Idea 1");
    click(idea.element, idea.at);
    expect(within(selectionBar()).getByText("Node: Idea 1")).toBeTruthy();
    expect(idea.element.getAttribute("data-active")).toBe("true");

    await user.click(barButton("Add child"));
    const field = screen.getByRole("textbox", { name: "Node title" });
    await user.type(field, "Detail{Enter}");
    expect(screen.queryByRole("textbox", { name: "Node title" })).toBeNull();
    expect(childTexts(board, id, "Idea 1")).toEqual(["Detail"]);
    expect(shownTexts(id)).toContain("Detail");
  });

  it("двойной щелчок и Rename — правка названия; Add sibling — узел рядом", async () => {
    const user = userEvent.setup();
    const { board, id } = mindmapBoard();
    renderScene(board);
    const idea = nodeAt(board, id, "Idea 2");
    fireEvent.doubleClick(idea.element, {
      clientX: idea.at[0],
      clientY: idea.at[1],
    });
    const field = screen.getByRole("textbox", { name: "Node title" });
    await user.clear(field);
    await user.type(field, "Budget{Enter}");
    expect(childTexts(board, id, "Main topic")).toEqual(["Idea 1", "Budget"]);

    await user.click(barButton("Rename"));
    await user.type(
      screen.getByRole("textbox", { name: "Node title" }),
      "!{Enter}",
    );
    expect(childTexts(board, id, "Main topic")).toEqual(["Idea 1", "Budget!"]);

    const first = nodeAt(board, id, "Idea 1");
    click(first.element, first.at);
    await user.click(barButton("Add sibling"));
    await user.type(
      screen.getByRole("textbox", { name: "Node title" }),
      "Middle{Enter}",
    );
    expect(childTexts(board, id, "Main topic")).toEqual([
      "Idea 1",
      "Middle",
      "Budget!",
    ]);
  });

  it("перекраска узла без детей — сразу, без вопроса", async () => {
    const user = userEvent.setup();
    const { board, id } = mindmapBoard();
    renderScene(board);
    const idea = nodeAt(board, id, "Idea 2");
    click(idea.element, idea.at);
    await user.selectOptions(
      within(selectionBar()).getByLabelText("Node color"),
      "Pink",
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(nodeAt(board, id, "Idea 2").node.color).toBe("#f48fb1");
    expect(nodeAt(board, id, "Idea 2").element.style.background).toBe(
      "rgb(244, 143, 177)",
    );
  });

  it("Delete node и клавиша Delete удаляют узел, а не карту; у корня кнопки нет", async () => {
    const user = userEvent.setup();
    const { board, id } = mindmapBoard();
    addChild(board.objects, id, nodeId(board, id, "Idea 1"), "Alice");
    renderScene(board);
    const idea = nodeAt(board, id, "Idea 1");
    click(idea.element, idea.at);
    await user.click(barButton("Delete node"));
    expect(shownTexts(id)).toEqual(["Main topic", "Idea 2"]);
    expect(shape(board, id).byId.size).toBe(2);

    const two = nodeAt(board, id, "Idea 2");
    click(two.element, two.at);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(board.objects.has(id)).toBe(true);
    expect(shownTexts(id)).toEqual(["Main topic"]);

    const root = nodeAt(board, id, "Main topic");
    click(root.element, root.at);
    expect(
      within(selectionBar()).queryByRole("button", { name: "Delete node" }),
    ).toBeNull();
  });

  it("перетаскивание узла выделенной карты переставляет его — видно второму участнику", () => {
    const [docA, docB] = linkedDocs();
    const { board, id } = mindmapBoard(createBoardDocument(docA));
    renderScene(board);
    const two = nodeAt(board, id, "Idea 2");
    const one = nodeAt(board, id, "Idea 1");
    click(two.element, two.at);
    // Верхняя четверть Idea 1 — перед ним.
    drag(two.element, two.at, [
      [two.at[0], two.at[1] - 30],
      [one.at[0], one.node.y + 3],
    ]);
    expect(childTexts(board, id, "Main topic")).toEqual(["Idea 2", "Idea 1"]);
    const remote = createBoardDocument(docB);
    expect(childTexts(remote, id, "Main topic")).toEqual(["Idea 2", "Idea 1"]);

    // Середина узла — внутрь него.
    const moved = nodeAt(board, id, "Idea 2");
    const target = nodeAt(board, id, "Idea 1");
    drag(moved.element, moved.at, [[moved.at[0], moved.at[1] + 20], target.at]);
    expect(childTexts(board, id, "Main topic")).toEqual(["Idea 1"]);
    expect(childTexts(board, id, "Idea 1")).toEqual(["Idea 2"]);
  });

  it("узел невыделенной карты не отрывается: перетаскивание двигает всю карту", () => {
    const { board, id } = mindmapBoard();
    renderScene(board);
    const two = nodeAt(board, id, "Idea 2");
    drag(two.element, two.at, [[two.at[0] + 100, two.at[1] + 60]]);
    expect(object(board, id)).toMatchObject({ x: 100, y: 60 });
    expect(childTexts(board, id, "Main topic")).toEqual(["Idea 1", "Idea 2"]);
  });
});

describe("MAP-03: сворачивание веток", () => {
  it("кнопка у узла сворачивает и разворачивает его ветку", () => {
    const { board, id } = mindmapBoard();
    addChild(board.objects, id, nodeId(board, id, "Idea 1"), "Alice");
    renderScene(board);
    expect(shownTexts(id)).toEqual([
      "Main topic",
      "Idea 1",
      "New idea",
      "Idea 2",
    ]);
    click(toggle("Collapse “Idea 1”"), [300, 20]);
    expect(shownTexts(id)).toEqual(["Main topic", "Idea 1", "Idea 2"]);
    expect(toggle("Expand “Idea 1”").textContent).toBe("1");
    click(toggle("Expand “Idea 1”"), [300, 20]);
    expect(shownTexts(id)).toEqual([
      "Main topic",
      "Idea 1",
      "New idea",
      "Idea 2",
    ]);
  });

  it("ветки корня сворачиваются кнопкой и из панели выделения", async () => {
    const user = userEvent.setup();
    const { board, id } = mindmapBoard();
    renderScene(board);
    click(toggle("Collapse “Main topic”"), [150, 46]);
    expect(shownTexts(id)).toEqual(["Main topic"]);
    const root = nodeAt(board, id, "Main topic");
    click(root.element, root.at);
    await user.click(barButton("Expand"));
    expect(shownTexts(id)).toEqual(["Main topic", "Idea 1", "Idea 2"]);
    await user.click(barButton("Collapse"));
    expect(shownTexts(id)).toEqual(["Main topic"]);
  });
});

describe("MAP-04: вопрос о перекраске дочерних узлов", () => {
  async function recolorRoot(answer: string) {
    const user = userEvent.setup();
    const { board, id } = mindmapBoard();
    renderScene(board);
    const root = nodeAt(board, id, "Main topic");
    click(root.element, root.at);
    await user.selectOptions(
      within(selectionBar()).getByLabelText("Node color"),
      "Green",
    );
    const dialog = screen.getByRole("dialog", {
      name: "Recolor child nodes too?",
    });
    expect(within(dialog).getByText(/has 2 child nodes/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: answer }));
    expect(screen.queryByRole("dialog")).toBeNull();
    return [...shape(board, id).byId.values()].map((n) => [n.text, n.color]);
  }

  it("ответ Recolor all — перекрашены корень и все дочерние узлы", async () => {
    expect(await recolorRoot("Recolor all")).toEqual([
      ["Main topic", "#a5d6a7"],
      ["Idea 1", "#a5d6a7"],
      ["Idea 2", "#a5d6a7"],
    ]);
  });

  it("ответ Only this node — перекрашен только корень", async () => {
    expect(await recolorRoot("Only this node")).toEqual([
      ["Main topic", "#a5d6a7"],
      ["Idea 1", "#81d4fa"],
      ["Idea 2", "#81d4fa"],
    ]);
  });

  it("Cancel — цвет не меняется", async () => {
    expect(await recolorRoot("Cancel")).toEqual([
      ["Main topic", "#81d4fa"],
      ["Idea 1", "#81d4fa"],
      ["Idea 2", "#81d4fa"],
    ]);
  });
});
