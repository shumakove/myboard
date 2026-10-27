import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createDice, rollDice } from "./dice";
import { createFlipCard, sideText } from "./flipCards";
import { REACTION_MIN } from "./reactionData";
import { createObject } from "./sceneObjects";
import {
  canvas,
  click,
  drag,
  element,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.11: реакции, флип-карточки и кубики через интерфейс сцены.

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function barButton(name: string | RegExp) {
  return within(selectionBar()).getByRole("button", { name });
}

function pressKey(code: string, key: string) {
  fireEvent.keyDown(document.body, { code, key });
}

function reactions(board: ReturnType<typeof createBoardDocument>) {
  return scene(board).filter((o) => o.type === "reaction");
}

describe("RCT-01…RCT-04: инструмент Reaction", () => {
  it("щелчок по объекту ставит выбранную реакцию на него, по пустому месту — нет", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    pressKey("KeyU", "u");
    click(canvas(), [500, 500]);
    expect(reactions(board)).toHaveLength(0);
    click(element(sticky), [100, 100]);
    const [placed] = reactions(board);
    expect(placed?.parent).toBe(sticky);
    expect(placed?.reaction?.image).toBe("👍");
    expect(placed?.width).toBe(REACTION_MIN);
  });

  it("RCT-02: реакция подписана автором", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board, "Bob");
    pressKey("KeyU", "u");
    click(element(sticky), [100, 100]);
    const [placed] = reactions(board);
    const view = element(placed?.id ?? "");
    expect(view).toHaveAttribute("aria-label", "Thumbs up by Bob");
    expect(
      within(view).getByRole("tooltip", { hidden: true }),
    ).toHaveTextContent("Thumbs up by Bob");
  });

  it("RCT-03: пока кнопку держат, реакция растёт; отпускание ставит выросшую", () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    pressKey("KeyU", "u");
    const base = { pointerId: 1, pointerType: "mouse" };
    fireEvent.pointerDown(element(sticky), {
      ...base,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    const draft = () =>
      Number(screen.getByTestId("reaction-draft").dataset.size);
    const first = draft();
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(draft()).toBeGreaterThan(first);
    fireEvent.pointerUp(canvas(), {
      ...base,
      button: 0,
      clientX: 100,
      clientY: 100,
    });
    expect(screen.queryByTestId("reaction-draft")).toBeNull();
    const [placed] = reactions(board);
    expect(placed?.width).toBeGreaterThan(REACTION_MIN);
    expect(placed?.x).toBeCloseTo(100 - (placed?.width ?? 0) / 2);
  });

  it("RCT-04: наборы и недавние — выбранное изображение ставится и попадает в Recent", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    pressKey("KeyU", "u");
    const palette = screen.getByRole("toolbar", { name: "Reactions" });
    fireEvent.click(within(palette).getByRole("tab", { name: "Stamps" }));
    fireEvent.click(
      within(palette).getByRole("button", { name: "Rocket reaction" }),
    );
    click(element(sticky), [50, 50]);
    expect(reactions(board).map((o) => o.reaction?.image)).toEqual(["🚀"]);
    fireEvent.click(within(palette).getByRole("tab", { name: "Recent" }));
    expect(
      within(palette).getByRole("button", { name: "Rocket reaction" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("RCT-01: реакцию не стаскивают с объекта; она едет, когда тянут объект", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    pressKey("KeyU", "u");
    click(element(sticky), [100, 100]);
    pressKey("Escape", "Escape");
    const [placed] = reactions(board);
    const id = placed?.id ?? "";
    drag(element(id), [100, 100], [[400, 400]]);
    expect(object(board, id)).toMatchObject({ x: 76, y: 76 });
    drag(element(sticky), [10, 10], [[310, 10]]);
    expect(object(board, sticky).x).toBe(300);
    expect(object(board, id)).toMatchObject({ x: 376, y: 76 });
  });

  it("щелчок по реакции ставит новую на тот же объект", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    pressKey("KeyU", "u");
    click(element(sticky), [100, 100]);
    const [first] = reactions(board);
    click(element(first?.id ?? ""), [100, 100]);
    expect(reactions(board).map((o) => o.parent)).toEqual([sticky, sticky]);
  });
});

describe("FLP-01…FLP-03: флип-карточка", () => {
  it("клавиша H ставит карточку и открывает лицевую сторону для текста", () => {
    const board = createBoardDocument();
    renderScene(board);
    pressKey("KeyH", "h");
    click(canvas(), [0, 0]);
    const [card] = scene(board).filter((o) => o.type === "flipcard");
    expect(card).toBeDefined();
    const field = screen.getByRole("textbox", { name: "Flip card side text" });
    fireEvent.input(field, { target: { value: "Front" } });
    expect(object(board, card?.id ?? "").flip?.front.text).toBe("Front");
  });

  it("FLP-02: Flip в панели и кнопка в углу переворачивают карточку", () => {
    const board = createBoardDocument();
    const id = createFlipCard(board.objects, { x: 0, y: 0 }, "Alice");
    renderScene(board);
    click(element(id), [50, 50]);
    fireEvent.click(barButton("Flip"));
    expect(object(board, id).flip?.flipped).toBe(true);
    expect(element(id)).toHaveAttribute("data-side", "back");
    const corner = element(id).querySelector("[data-flip-toggle]");
    if (corner === null) throw new Error("нет кнопки переворота");
    click(corner, [230, 10]);
    expect(object(board, id).flip?.flipped).toBe(false);
  });

  it("FLP-02: все выделенные карточки переворачиваются разом", () => {
    const board = createBoardDocument();
    const ids = [0, 1, 2].map((i) =>
      createFlipCard(board.objects, { x: i * 300, y: 0 }, "Alice"),
    );
    renderScene(board);
    for (const id of ids) click(element(id), [0, 0], { shiftKey: true });
    fireEvent.click(barButton("Flip all (3)"));
    expect(ids.map((id) => object(board, id).flip?.flipped)).toEqual([
      true,
      true,
      true,
    ]);
  });

  it("FLP-01, FLP-03: двойной щелчок правит показанную сторону, её оформление — в панели", () => {
    const board = createBoardDocument();
    const id = createFlipCard(board.objects, { x: 0, y: 0 }, "Alice");
    sideText(board.objects, id, "front")?.insert(0, "Q");
    renderScene(board);
    click(element(id), [50, 50]);
    fireEvent.click(barButton("Flip"));
    expect(within(selectionBar()).getByText("Back side")).toBeInTheDocument();
    fireEvent.change(within(selectionBar()).getByLabelText("Font size"), {
      target: { value: "48" },
    });
    fireEvent.change(within(selectionBar()).getByLabelText("Style"), {
      target: { value: "bold" },
    });
    fireEvent.change(within(selectionBar()).getByLabelText("Flip direction"), {
      target: { value: "vertical" },
    });
    fireEvent.doubleClick(element(id), { clientX: 50, clientY: 50 });
    const field = screen.getByRole("textbox", { name: "Flip card side text" });
    fireEvent.input(field, { target: { value: "A" } });
    const flip = object(board, id).flip;
    expect(flip?.back).toMatchObject({
      text: "A",
      fontSize: 48,
      fontStyle: "bold",
    });
    expect(flip?.front).toMatchObject({ text: "Q", fontSize: 24 });
    expect(flip?.direction).toBe("vertical");
    expect(field).toHaveStyle({ fontSize: "48px", fontWeight: "700" });
  });
});

describe("DICE-01…DICE-03: кубик", () => {
  it("клавиша X ставит кубик; Roll показывает значение в диапазоне граней", () => {
    const board = createBoardDocument();
    renderScene(board);
    pressKey("KeyX", "x");
    click(canvas(), [0, 0]);
    const [dice] = scene(board).filter((o) => o.type === "dice");
    const id = dice?.id ?? "";
    expect(within(element(id)).getByTestId("dice-value")).toHaveTextContent(
      "–",
    );
    fireEvent.change(within(selectionBar()).getByLabelText("Faces"), {
      target: { value: "20" },
    });
    for (let i = 0; i < 50; i += 1) {
      fireEvent.click(barButton("Roll"));
      const value = object(board, id).dice?.value ?? 0;
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
      expect(within(element(id)).getByTestId("dice-value")).toHaveTextContent(
        String(value),
      );
    }
    expect(element(id)).toHaveAttribute(
      "aria-label",
      `Dice d20: ${String(object(board, id).dice?.value)}`,
    );
  });

  it("двойной щелчок по кубику бросает его", () => {
    const board = createBoardDocument();
    const id = createDice(board.objects, { x: 0, y: 0 }, "Alice");
    renderScene(board);
    fireEvent.doubleClick(element(id), { clientX: 10, clientY: 10 });
    expect(object(board, id).dice?.roll).toBe(1);
    expect(object(board, id).dice?.value).not.toBeNull();
  });

  it("DICE-03: у нескольких выделенных кубиков — сумма последних значений", () => {
    const board = createBoardDocument();
    const ids = [0, 1, 2].map((i) =>
      createDice(board.objects, { x: i * 120, y: 0 }, "Alice"),
    );
    const values = [2, 5, 6];
    ids.forEach((id, i) => {
      rollDice(
        board.objects,
        [object(board, id)],
        "Alice",
        () => (values[i] ?? 1) - 1,
      );
    });
    renderScene(board);
    click(element(ids[0] ?? ""), [10, 10]);
    expect(within(selectionBar()).queryByText(/Sum:/)).toBeNull();
    click(element(ids[1] ?? ""), [130, 10], { shiftKey: true });
    expect(within(selectionBar()).getByText("Sum: 7")).toBeInTheDocument();
    click(element(ids[2] ?? ""), [250, 10], { shiftKey: true });
    expect(within(selectionBar()).getByText("Sum: 13")).toBeInTheDocument();
    fireEvent.click(barButton("Roll all (3)"));
    const sum = ids.reduce(
      (s, id) => s + (object(board, id).dice?.value ?? 0),
      0,
    );
    expect(
      within(selectionBar()).getByText(`Sum: ${String(sum)}`),
    ).toBeInTheDocument();
  });
});
