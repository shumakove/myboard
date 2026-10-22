import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createObject, objectMap } from "./sceneObjects";
import {
  canvas,
  click,
  element,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.3: фигуры и BPMN (SHP-01…SHP-04) — через интерфейс сцены.

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

function shapes() {
  return screen.getByRole("toolbar", { name: "Shapes" });
}

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function select(label: string) {
  return within(selectionBar()).getByRole<HTMLSelectElement>("combobox", {
    name: label,
  });
}

function optionLabels(field: HTMLSelectElement): string[] {
  return Array.from(field.options).map((o) => o.text);
}

/** Своё значение в поле выбора цвета: браузер шлёт `change`, когда окно выбора закрыто. */
function pickColor(label: string, color: string) {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  input.value = color;
  fireEvent.change(input);
}

describe("SHP-01: наборы фигур", () => {
  it("у инструмента Shape — наборы Basic, Callouts, Flowchart и BPMN; выбранный вид ставится щелчком", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    expect(screen.queryByRole("toolbar", { name: "Shapes" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Shape" }));
    expect(
      within(shapes())
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Basic", "Callouts", "Flowchart", "BPMN"]);

    await user.click(within(shapes()).getByRole("tab", { name: "Flowchart" }));
    const decision = within(shapes()).getByRole("button", { name: "Decision" });
    await user.click(decision);
    expect(decision).toHaveAttribute("aria-pressed", "true");
    click(canvas(), [100, 100]);

    const [created] = scene(board);
    expect(created).toMatchObject({
      type: "shape",
      width: 160,
      height: 100,
      x: 20,
      y: 60,
      style: expect.objectContaining({ shape: "decision" }) as unknown,
    });
    const view = element(created?.id ?? "");
    expect(view).toHaveAttribute("data-shape", "decision");
    expect(within(view).getByTestId("shape-outline")).toBeInTheDocument();
    // Выбор вида помнится до конца сессии вкладки.
    expect(sessionStorage.getItem("myboard.shapeKind")).toBe("decision");
  });

  it("выноска с панели перетаскивается на холст и встаёт в точку отпускания", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "board-canvas"
          ? new DOMRect(0, 0, 800, 600)
          : new DOMRect(0, 0, 0, 0);
      },
    );
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Shape" }));
    await user.click(within(shapes()).getByRole("tab", { name: "Callouts" }));
    const cloud = within(shapes()).getByRole("button", {
      name: "Cloud callout",
    });
    fireEvent.pointerDown(cloud, {
      pointerId: 3,
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(cloud, { pointerId: 3, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(cloud, { pointerId: 3, clientX: 500, clientY: 400 });
    fireEvent.click(cloud);

    // Точка (500, 400) области 800×600 — точка доски (100, 100); выноска 200×140,
    // угол прилипает к сетке 20: (0, 30) → (0, 40).
    expect(scene(board)).toEqual([
      expect.objectContaining({
        type: "shape",
        x: 0,
        y: 40,
        width: 200,
        height: 140,
        style: expect.objectContaining({ shape: "callout-cloud" }) as unknown,
      }),
    ]);
  });

  it("фигура, записанная до наборов (без вида), рисуется прямоугольником", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 0, y: 0 });
    objectMap(board.objects, id)?.delete("shape");
    renderScene(board);
    expect(element(id)).toHaveAttribute("data-shape", "rectangle");
  });
});

describe("SHP-02: фигуры BPMN и маркеры", () => {
  it("шлюз ставится с маркером по умолчанию, маркер переключается в панели выделения", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Shape" }));
    await user.click(within(shapes()).getByRole("tab", { name: "BPMN" }));
    await user.click(within(shapes()).getByRole("button", { name: "Gateway" }));
    click(canvas(), [0, 0]);
    fireEvent.keyDown(screen.getByLabelText("Object text"), { key: "Escape" });
    const id = scene(board)[0]?.id ?? "";
    expect(element(id)).toHaveAttribute("data-marker", "exclusive");

    const marker = select("Marker");
    expect(optionLabels(marker)).toEqual([
      "Exclusive",
      "Parallel",
      "Inclusive",
      "Event-based",
      "Complex",
      "None",
    ]);
    await user.selectOptions(marker, "Parallel");
    expect(object(board, id).style.marker).toBe("parallel");
    expect(element(id)).toHaveAttribute("data-marker", "parallel");
    await user.selectOptions(select("Marker"), "None");
    expect(within(element(id)).queryByTestId("shape-marker")).toBeNull();
  });

  it("смена вида задачи на событие меняет и список маркеров", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 0, y: 0 }, "", "", {
      shape: "bpmn-task",
      marker: "user",
    });
    renderScene(board);
    click(element(id), [10, 10]);
    expect(select("Marker").value).toBe("user");
    await user.selectOptions(select("Shape"), "End event");
    expect(optionLabels(select("Marker"))).toContain("Terminate");
    // Маркера «user» у события нет — показан маркер вида по умолчанию.
    expect(select("Marker").value).toBe("none");
    await user.selectOptions(select("Marker"), "Terminate");
    expect(object(board, id).style).toMatchObject({
      shape: "bpmn-end",
      marker: "terminate",
    });
  });

  it("у фигур не из BPMN маркера нет", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 0, y: 0 });
    renderScene(board);
    click(element(id), [10, 10]);
    expect(
      within(selectionBar()).queryByRole("combobox", { name: "Marker" }),
    ).toBeNull();
  });
});

describe("SHP-03: заливка, обводка, скругление и текст фигуры", () => {
  it("свойства меняются в панели выделения и видны на контуре", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    click(element(id), [10, 10]);

    await user.selectOptions(select("Fill"), "Blue");
    await user.selectOptions(select("Border"), "Pink");
    await user.selectOptions(select("Border width"), "6");
    await user.selectOptions(select("Corners"), "16");
    await user.selectOptions(select("Font size"), "24");
    await user.click(
      within(selectionBar()).getByRole("button", { name: "Text style" }),
    );
    await user.selectOptions(select("Line spacing"), "2");

    expect(object(board, id).style).toMatchObject({
      fill: "#81d4fa",
      stroke: "#f48fb1",
      strokeWidth: 6,
      radius: 16,
      fontSize: 24,
      lineHeight: 2,
    });
    const path = within(element(id))
      .getByTestId("shape-outline")
      .querySelector("path");
    expect(path).toHaveAttribute("fill", "#81d4fa");
    expect(path).toHaveAttribute("stroke", "#f48fb1");
    expect(path).toHaveAttribute("stroke-width", "6");
    expect(path?.getAttribute("d")).toContain("Q");
    expect(element(id)).toHaveStyle({ fontSize: "24px", lineHeight: "2" });
    expect(element(id).querySelector(".shape-text")).toHaveTextContent("Hi");
  });

  it("заливка может быть прозрачной; у эллипса нет скругления", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 0, y: 0 }, "", "", {
      shape: "ellipse",
    });
    renderScene(board);
    click(element(id), [10, 10]);
    await user.selectOptions(select("Fill"), "None");
    expect(object(board, id).style.fill).toBe("transparent");
    expect(
      within(selectionBar()).queryByRole("combobox", { name: "Corners" }),
    ).toBeNull();
  });

  it("текст фигуры правят в поле поверх её области текста", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 0, y: 0 }, "", "", {
      shape: "diamond",
      lineHeight: 1.5,
    });
    renderScene(board);
    fireEvent.doubleClick(element(id), { clientX: 50, clientY: 50 });
    const field = screen.getByLabelText<HTMLTextAreaElement>("Object text");
    // Ромб 200×120: область текста — средние 60 % рамки.
    expect(field).toHaveStyle({
      left: "40px",
      top: "24px",
      width: "120px",
      lineHeight: "1.5",
    });
    await user.type(field, "Yes{Enter}No");
    expect(object(board, id).text).toBe("Yes\nNo");
  });
});

describe("SHP-04: недавние свои цвета по категориям", () => {
  it("свой цвет стикера — в списке стикера и в палитре стикеров, но не у фигуры", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    const shape = createObject(board.objects, "shape", { x: 400, y: 0 });
    renderScene(board);

    click(element(sticky), [10, 10]);
    await user.click(
      within(selectionBar()).getByRole("button", { name: "Custom color" }),
    );
    pickColor("Custom fill", "#123456");
    expect(object(board, sticky).style.fill).toBe("#123456");
    const recentGroup = select("Fill").querySelector(
      'optgroup[label="Recent colors"]',
    );
    expect(recentGroup).toHaveTextContent("#123456");

    click(element(shape), [410, 10]);
    expect(optionLabels(select("Fill"))).not.toContain("#123456");
    expect(optionLabels(select("Border"))).not.toContain("#123456");

    fireEvent.keyDown(document.body, { key: "Escape" });
    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    expect(
      within(
        screen.getByRole("toolbar", { name: "Sticky note color" }),
      ).getByRole("button", { name: "Custom #123456" }),
    ).toBeInTheDocument();
    expect(
      JSON.parse(localStorage.getItem("myboard.recentColors") ?? ""),
    ).toEqual({ text: [], sticky: ["#123456"], shape: [], line: [] });
  });

  it("свой цвет фигуры и текста — каждый в своём списке", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const shape = createObject(board.objects, "shape", { x: 0, y: 0 });
    const text = createObject(board.objects, "text", { x: 400, y: 0 });
    renderScene(board);

    click(element(shape), [10, 10]);
    await user.click(
      within(selectionBar()).getByRole("button", { name: "Custom color" }),
    );
    pickColor("Custom border", "#00aa00");
    expect(object(board, shape).style.stroke).toBe("#00aa00");
    expect(optionLabels(select("Fill"))).toContain("#00aa00");

    click(element(text), [410, 10]);
    expect(optionLabels(select("Text color"))).not.toContain("#00aa00");
    // Группа Custom color остаётся открытой при смене выделения, как Text style.
    pickColor("Custom text color", "#aa0000");
    expect(object(board, text).style.color).toBe("#aa0000");

    expect(
      JSON.parse(localStorage.getItem("myboard.recentColors") ?? ""),
    ).toEqual({ text: ["#aa0000"], sticky: [], shape: ["#00aa00"], line: [] });
  });

  it("свой цвет до постановки стикера — в палитре стикеров, новый стикер этого цвета", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    pickColor("Custom color", "#334455");
    const palette = screen.getByRole("toolbar", { name: "Sticky note color" });
    expect(
      within(palette).getByRole("button", { name: "Custom #334455" }),
    ).toHaveAttribute("aria-pressed", "true");
    click(canvas(), [100, 100]);
    expect(scene(board)[0]?.style.fill).toBe("#334455");
  });
});
