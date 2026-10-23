import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createLine, setPoints } from "./lineEdits";
import { createObject } from "./sceneObjects";
import {
  canvas,
  click,
  drag,
  element,
  handle,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.4: соединительные линии (CON-01…CON-07, CVS-26) — через интерфейс сцены.

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function select(label: string) {
  return within(selectionBar()).getByRole<HTMLSelectElement>("combobox", {
    name: label,
  });
}

function barButton(name: string) {
  return within(selectionBar()).getByRole("button", { name });
}

function optionLabels(field: HTMLSelectElement): string[] {
  return Array.from(field.options).map((o) => o.text);
}

function pickColor(label: string, color: string) {
  const input = screen.getByLabelText<HTMLInputElement>(label);
  input.value = color;
  fireEvent.change(input);
}

/** Инструмент Line — клавишей C (CVS-25). */
function lineTool() {
  fireEvent.keyDown(document.body, { code: "KeyC", key: "c" });
}

function lines(board: ReturnType<typeof createBoardDocument>) {
  return scene(board).filter((o) => o.type === "line");
}

function lineHit(id: string) {
  return within(element(id)).getByTestId("line-hit");
}

/** Стикеры 200×200: A в (0,0), B в (400,0). */
function twoStickies() {
  const board = createBoardDocument();
  const a = createObject(board.objects, "sticky", { x: 0, y: 0 });
  const b = createObject(board.objects, "sticky", { x: 400, y: 0 });
  return { board, a, b };
}

function connected() {
  const { board, a, b } = twoStickies();
  const id = createLine(
    board.objects,
    { point: { x: 200, y: 100 }, object: a, anchor: "e" },
    { point: { x: 400, y: 100 }, object: b, anchor: "w" },
    "Alice",
  );
  return { board, a, b, id };
}

describe("CON-01, CVS-26: линия между объектами", () => {
  it("протяжка инструментом Line от объекта к объекту привязывает оба конца", () => {
    const { board, a, b } = twoStickies();
    renderScene(board);
    lineTool();
    drag(
      canvas(),
      [150, 90],
      [
        [300, 90],
        [450, 110],
      ],
    );

    const [line] = lines(board);
    expect(line?.line?.start).toMatchObject({ object: a, anchor: "e" });
    expect(line?.line?.end).toMatchObject({ object: b, anchor: "w" });
    expect(line?.line?.path).toEqual([
      { x: 200, y: 100 },
      { x: 400, y: 100 },
    ]);
    // Линия выделена, инструмент вернулся к Select.
    expect(element(line?.id ?? "")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("линия следует за перемещаемым объектом, пока привязана", () => {
    const { board, a, id } = connected();
    renderScene(board);
    drag(
      element(a),
      [100, 100],
      [
        [100, 200],
        [100, 400],
      ],
    );
    expect(object(board, id).line?.path[0]).toEqual({ x: 200, y: 400 });
  });

  it("Alt при протяжке оставляет конец свободным", () => {
    const { board } = twoStickies();
    renderScene(board);
    lineTool();
    drag(
      canvas(),
      [250, 300],
      [
        [300, 300],
        [450, 300],
      ],
      { altKey: true },
    );
    const [line] = lines(board);
    expect(line?.line?.end.object).toBeUndefined();
    expect(line?.line?.path.at(-1)).toEqual({ x: 450, y: 300 });
  });

  it("Detach отвязывает линию: после этого она не следует за объектом", async () => {
    const user = userEvent.setup();
    const { board, a, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    await user.click(barButton("Detach"));
    expect(
      within(selectionBar()).queryByRole("button", { name: "Detach" }),
    ).toBeNull();

    click(element(a), [100, 100]);
    drag(
      element(a),
      [100, 100],
      [
        [100, 200],
        [100, 400],
      ],
    );
    expect(object(board, id).line?.path[0]).toEqual({ x: 200, y: 100 });
  });

  it("конец, оттянутый от объекта, отвязывается; поднесённый к объекту — привязывается", () => {
    const { board, b, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    drag(
      handle("line-end"),
      [400, 100],
      [
        [400, 250],
        [400, 400],
      ],
    );
    expect(object(board, id).line?.end.object).toBeUndefined();

    drag(
      handle("line-end"),
      [400, 400],
      [
        [420, 200],
        [610, 120],
      ],
    );
    expect(object(board, id).line?.end).toMatchObject({
      object: b,
      anchor: "e",
    });
    expect(object(board, id).line?.path.at(-1)).toEqual({ x: 600, y: 100 });
  });

  it("удаление объекта оставляет привязанную линию на месте", () => {
    const { board, b, id } = connected();
    renderScene(board);
    click(element(b), [500, 100]);
    fireEvent.keyDown(document.body, { key: "Delete" });
    expect(object(board, id).line?.path.at(-1)).toEqual({ x: 400, y: 100 });
  });
});

describe("CON-05: Shift — произвольный угол", () => {
  it("без Shift конец встаёт под углом, кратным 45°; с Shift — куда указали", () => {
    const board = createBoardDocument();
    renderScene(board);
    lineTool();
    drag(
      canvas(),
      [0, 0],
      [
        [50, 20],
        [100, 40],
      ],
    );
    const [snapped] = lines(board);
    const end = snapped?.line?.path.at(-1);
    expect(end?.y).toBeCloseTo(0);

    lineTool();
    drag(
      canvas(),
      [0, 300],
      [
        [50, 320],
        [100, 340],
      ],
      { shiftKey: true },
    );
    const free = lines(board).find((o) => o.id !== snapped?.id);
    expect(free?.line?.path.at(-1)).toEqual({ x: 100, y: 340 });
  });

  it("щелчок инструментом без протяжки ставит горизонтальную линию", () => {
    const board = createBoardDocument();
    renderScene(board);
    lineTool();
    click(canvas(), [0, 0]);
    expect(lines(board)[0]?.line?.path).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });
});

describe("CON-01, CON-07: вид линии и наконечники", () => {
  it("прямая, ломаная, кривая; наконечники на обоих концах и без них", async () => {
    const user = userEvent.setup();
    const { board, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    const stroke = () => within(element(id)).getByTestId("line-stroke");
    const caps = () =>
      within(element(id))
        .queryAllByTestId("line-cap")
        .map((cap) => `${cap.dataset.end ?? ""}:${cap.dataset.cap ?? ""}`);

    expect(stroke()).toHaveAttribute("data-line-style", "straight");
    expect(caps()).toEqual(["end:arrow"]);
    for (const style of ["Elbow", "Curved"]) {
      await user.selectOptions(select("Line type"), style);
      expect(stroke()).toHaveAttribute("data-line-style", style.toLowerCase());
    }
    await user.selectOptions(select("Start"), "Circle");
    expect(caps()).toEqual(["start:circle", "end:arrow"]);
    await user.selectOptions(select("Start"), "None");
    await user.selectOptions(select("End"), "None");
    expect(caps()).toEqual([]);
    expect(object(board, id).style).toMatchObject({
      lineStyle: "curved",
      startCap: "none",
      endCap: "none",
    });
  });

  it("цвет и толщина линии; толщины «без линии» нет", async () => {
    const user = userEvent.setup();
    const { board, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    expect(optionLabels(select("Line width"))).not.toContain("None");
    await user.selectOptions(select("Line width"), "6");
    await user.selectOptions(select("Line color"), "Blue");
    const stroke = within(element(id)).getByTestId("line-stroke");
    expect(stroke).toHaveAttribute("stroke-width", "6");
    expect(stroke).toHaveAttribute("stroke", "#81d4fa");
  });
});

describe("CON-02: смена направления", () => {
  it("Swap ends меняет начало и конец местами", async () => {
    const user = userEvent.setup();
    const { board, a, b, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    await user.click(barButton("Swap ends"));
    const line = object(board, id).line;
    expect(line?.start.object).toBe(b);
    expect(line?.end.object).toBe(a);
    expect(line?.path[0]).toEqual({ x: 400, y: 100 });
  });
});

describe("CON-06: точки изгиба", () => {
  it("потянув середину участка, добавляют точку; двойной щелчок по точке удаляет её", () => {
    const { board, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    drag(
      handle("line-add-0"),
      [300, 100],
      [
        [300, 150],
        [300, 250],
      ],
    );
    expect(object(board, id).line?.points).toHaveLength(1);
    expect(object(board, id).line?.path[1]).toEqual({ x: 300, y: 250 });

    fireEvent.doubleClick(handle("line-point-0"));
    expect(object(board, id).line?.points).toEqual([]);
  });

  it("у кривой с несколькими точками удаляется именно та, по которой щёлкнули", async () => {
    const user = userEvent.setup();
    const { board, id } = connected();
    setPoints(
      board.objects,
      object(board, id),
      [
        { x: 250, y: 0 },
        { x: 350, y: 200 },
      ],
      "Alice",
    );
    renderScene(board);
    click(lineHit(id), [300, 100]);
    await user.selectOptions(select("Line type"), "Curved");
    fireEvent.doubleClick(handle("line-point-0"));
    expect(object(board, id).line?.path.slice(1, -1)).toEqual([
      { x: 350, y: 200 },
    ]);
  });
});

describe("CON-03, CON-04: подписи линии", () => {
  it("двойной щелчок по линии добавляет подпись; текст в несколько строк", async () => {
    const user = userEvent.setup();
    const { board, id } = connected();
    renderScene(board);
    fireEvent.doubleClick(lineHit(id), { clientX: 300, clientY: 100 });
    const field = screen.getByRole("textbox", { name: "Line label" });
    await user.type(field, "Yes{Enter}maybe");
    fireEvent.blur(field);
    const [label] = object(board, id).line?.labels ?? [];
    expect(label).toMatchObject({ text: "Yes\nmaybe", position: 0.5 });
    expect(within(element(id)).getByTestId("line-label")).toHaveTextContent(
      "Yes maybe",
    );
  });

  it("пустая подпись после правки не остаётся", async () => {
    const user = userEvent.setup();
    const { board, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    await user.click(barButton("Add label"));
    fireEvent.blur(screen.getByRole("textbox", { name: "Line label" }));
    expect(object(board, id).line?.labels).toEqual([]);
  });

  it("несколько подписей: каждую двигают вдоль линии и оформляют отдельно", async () => {
    const user = userEvent.setup();
    const { board, id } = connected();
    renderScene(board);
    click(lineHit(id), [300, 100]);
    for (const text of ["one", "two"]) {
      await user.click(barButton("Add label"));
      const field = screen.getByRole("textbox", { name: "Line label" });
      await user.type(field, text);
      fireEvent.blur(field);
    }
    const labelOf = (text: string) =>
      within(element(id))
        .getAllByTestId("line-label")
        .find((l) => l.textContent === text) as HTMLElement;

    // Подпись тянут вдоль линии — она остаётся на линии (доля длины).
    drag(
      labelOf("one"),
      [300, 100],
      [
        [340, 140],
        [350, 160],
      ],
    );
    const one = () =>
      object(board, id).line?.labels.find((l) => l.text === "one");
    expect(one()?.position).toBeCloseTo(0.75);

    // Щелчок выбирает подпись — её оформление в группе Label.
    click(labelOf("two"), [300, 100]);
    const group = within(selectionBar()).getByRole("group", { name: "Label" });
    await user.click(within(group).getByRole("button", { name: "Start" }));
    await user.selectOptions(within(group).getByLabelText("Label size"), "32");
    await user.selectOptions(
      within(group).getByLabelText("Label color"),
      "Pink",
    );
    await user.selectOptions(
      within(group).getByLabelText("Label font"),
      "Serif",
    );
    await user.selectOptions(
      within(group).getByLabelText("Label align"),
      "Left",
    );
    await user.selectOptions(
      within(group).getByLabelText("Label direction"),
      "Along line",
    );
    const two = object(board, id).line?.labels.find((l) => l.text === "two");
    expect(two).toMatchObject({
      position: 0.1,
      fontSize: 32,
      color: "#f48fb1",
      fontFamily: "serif",
      align: "left",
      orientation: "along",
    });
    expect(one()?.fontSize).toBe(16);
    expect(labelOf("two")).toHaveStyle({ fontSize: "32px", color: "#f48fb1" });
    expect(labelOf("two")).toHaveAttribute("data-orientation", "along");

    await user.click(within(group).getByRole("button", { name: "End" }));
    expect(
      object(board, id).line?.labels.find((l) => l.text === "two")?.position,
    ).toBe(0.9);
    await user.click(
      within(group).getByRole("button", { name: "Delete label" }),
    );
    expect(object(board, id).line?.labels.map((l) => l.text)).toEqual(["one"]);
  });
});

describe("SHP-04 (Q-003): недавние цвета линии", () => {
  it("свои цвета текста, стикера и фигуры не попадают в палитру линии, свой цвет линии — попадает", async () => {
    const user = userEvent.setup();
    const { board, a, id } = connected();
    const text = createObject(board.objects, "text", { x: 0, y: 400 });
    const shape = createObject(board.objects, "shape", { x: 400, y: 400 });
    renderScene(board);

    click(element(a), [100, 100]);
    await user.click(barButton("Custom color"));
    pickColor("Custom fill", "#111111");
    click(element(text), [10, 410]);
    pickColor("Custom text color", "#222222");
    click(element(shape), [410, 410]);
    pickColor("Custom border", "#333333");

    click(lineHit(id), [300, 100]);
    const palette = optionLabels(select("Line color"));
    for (const color of ["#111111", "#222222", "#333333"]) {
      expect(palette).not.toContain(color);
    }
    pickColor("Custom line color", "#444444");
    expect(object(board, id).style.stroke).toBe("#444444");
    expect(
      select("Line color").querySelector('optgroup[label="Recent colors"]'),
    ).toHaveTextContent("#444444");
    expect(
      JSON.parse(localStorage.getItem("myboard.recentColors") ?? ""),
    ).toEqual({
      text: ["#222222"],
      sticky: ["#111111"],
      shape: ["#333333"],
      line: ["#444444"],
      drawing: [],
    });

    // Цвет линии не появляется у фигуры.
    click(element(shape), [410, 410]);
    expect(optionLabels(select("Border"))).not.toContain("#444444");
  });
});
