import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { HOME } from "../canvas/camera";
import { createBoardDocument } from "../realtime/boardDocument";
import type { LaserTrail } from "../realtime/messages";
import { createDrawing } from "./drawEdits";
import { DRAW_SETTINGS_KEY } from "./drawSettings";
import { LASER_FADE_MS, LASER_TICK_MS } from "./laser";
import { createObject } from "./sceneObjects";
import {
  canvas,
  drag,
  element,
  handle,
  object,
  renderScene,
  scene,
} from "./testScene";

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

/** Выбор инструмента клавишей (CVS-25): P — перо, M — маркер, E — ластик, R — лазер. */
function pressKey(code: string) {
  fireEvent.keyDown(window, { code, key: code.slice(3).toLowerCase() });
}

function drawPanel() {
  return screen.getByRole("toolbar", { name: "Drawing" });
}

function drawings() {
  return [...document.querySelectorAll('[data-type="drawing"]')];
}

function only<T>(list: readonly T[]): T {
  expect(list).toHaveLength(1);
  return list[0] as T;
}

const PEN = { brush: "pen" as const, color: "#1f2937", width: 4 };

describe("DRW-01: перо и маркер", () => {
  it("перо рисует штрих протяжкой: цвет и толщина — из панели рисования", () => {
    const { board } = renderScene();
    pressKey("KeyP");
    const panel = drawPanel();
    fireEvent.click(within(panel).getByRole("button", { name: "Blue" }));
    drag(
      canvas(),
      [10, 10],
      [
        [40, 20],
        [80, 60],
      ],
    );
    const stroke = only(scene(board));
    expect(stroke).toMatchObject({
      type: "drawing",
      x: 10,
      y: 10,
      width: 70,
      height: 50,
      style: { stroke: "#81d4fa", strokeWidth: 4 },
      meta: { createdBy: "Alice" },
    });
    expect(stroke.drawing?.brush).toBe("pen");
    // Инструмент остаётся пером: следующий штрих рисуется сразу.
    drag(canvas(), [200, 200], [[260, 200]]);
    expect(scene(board)).toHaveLength(2);
  });

  it("пока рисуют, штрих — черновик вкладки; в документ он попадает при отпускании", () => {
    const { board } = renderScene();
    pressKey("KeyP");
    fireEvent.pointerDown(canvas(), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });
    expect(screen.getByTestId("ink-draft")).toBeInTheDocument();
    expect(scene(board)).toHaveLength(0);
    fireEvent.pointerUp(canvas(), {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 50,
      clientY: 50,
    });
    expect(screen.queryByTestId("ink-draft")).toBeNull();
    expect(scene(board)).toHaveLength(1);
  });

  it("маркер — своя кисть: полупрозрачный штрих своего цвета и толщины", () => {
    const { board } = renderScene();
    pressKey("KeyM");
    drag(canvas(), [0, 0], [[100, 0]]);
    const stroke = only(scene(board));
    expect(stroke.drawing?.brush).toBe("marker");
    expect(stroke.style).toEqual({ stroke: "#fff176", strokeWidth: 16 });
    const path = only(drawings()).querySelector(
      '[data-testid="drawing-stroke"]',
    );
    expect(path).toHaveAttribute("stroke-opacity", "0.5");
  });

  it("свой цвет из поля выбора цвета — цвет пера и в недавних цветах рисунка", () => {
    const { board } = renderScene();
    pressKey("KeyP");
    const input = within(drawPanel()).getByLabelText("Custom color");
    fireEvent.change(input, { target: { value: "#123456" } });
    drag(canvas(), [0, 0], [[30, 30]]);
    expect(only(scene(board)).style.stroke).toBe("#123456");
    expect(
      within(drawPanel()).getByRole("button", { name: "Custom #123456" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("касание без движения ставит точку", () => {
    const { board } = renderScene();
    pressKey("KeyP");
    drag(canvas(), [30, 40], []);
    expect(only(scene(board))).toMatchObject({ x: 30, y: 40 });
  });

  it("штрих — один шаг отмены (CVS-07)", () => {
    const { board } = renderScene();
    pressKey("KeyP");
    drag(
      canvas(),
      [0, 0],
      [
        [20, 20],
        [40, 10],
      ],
    );
    fireEvent.keyDown(window, { code: "KeyZ", key: "z", ctrlKey: true });
    expect(scene(board)).toHaveLength(0);
  });
});

describe("DRW-02: три пресета толщины пера", () => {
  it("пресет задаёт толщину; новое значение пресета сохраняется в браузере", () => {
    const { board, unmount } = renderScene();
    pressKey("KeyP");
    const presets = within(drawPanel()).getByRole("group", {
      name: "Pen presets",
    });
    const buttons = within(presets).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Preset 1: 2",
      "Preset 2: 4",
      "Preset 3: 8",
    ]);
    fireEvent.click(buttons[2] as HTMLElement);
    drag(canvas(), [0, 0], [[50, 0]]);
    expect(only(scene(board)).style.strokeWidth).toBe(8);

    fireEvent.change(within(drawPanel()).getByLabelText("Thickness"), {
      target: { value: "24" },
    });
    expect(
      within(drawPanel()).getByRole("button", { name: "Preset 3: 24" }),
    ).toHaveAttribute("aria-pressed", "true");
    unmount();

    renderScene();
    pressKey("KeyP");
    expect(
      within(drawPanel()).getByRole("button", { name: "Preset 3: 24" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem(DRAW_SETTINGS_KEY)).toContain("24");
  });
});

describe("DRW-03: ластик", () => {
  it("стирает задетые штрихи в корзину; заблокированный остаётся", () => {
    const board = createBoardDocument();
    const free = createDrawing(
      board.objects,
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
      ],
      PEN,
      "Alice",
    );
    const locked = createDrawing(
      board.objects,
      [
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
      PEN,
      "Alice",
    );
    (board.objects.get(locked) as Y.Map<unknown>).set("locked", true);
    const far = createDrawing(
      board.objects,
      [
        { x: 0, y: 300 },
        { x: 100, y: 300 },
      ],
      PEN,
      "Alice",
    );
    renderScene(board, "Bob");
    pressKey("KeyE");
    drag(canvas(), [-50, 50], [[150, 50]]);
    expect(board.objects.has(free)).toBe(false);
    expect((board.trash.get(free) as Y.Map<unknown>).get("deletedBy")).toBe(
      "Bob",
    );
    expect(board.objects.has(locked)).toBe(true);
    expect(board.objects.has(far)).toBe(true);
  });

  it("стирает только рисунки, а не другие объекты", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    pressKey("KeyE");
    drag(canvas(), [-10, 100], [[300, 100]]);
    expect(board.objects.has(sticky)).toBe(true);
  });
});

describe("DRW-04: прямой штрих с Shift", () => {
  it("с зажатым Shift — отрезок от начала до точки отпускания", () => {
    const { board } = renderScene();
    pressKey("KeyP");
    drag(
      canvas(),
      [0, 0],
      [
        [30, 50],
        [10, 90],
        [100, 100],
      ],
      { shiftKey: true },
    );
    expect(only(scene(board)).drawing?.points).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ]);
  });
});

describe("DRW-05: лазерная указка", () => {
  it("след уходит в присутствие, исчезает через несколько секунд и не пишется в документ", () => {
    vi.useFakeTimers();
    const trails: (LaserTrail | null)[] = [];
    const { board } = renderScene(undefined, "Alice", {
      onLaser: (trail) => trails.push(trail),
    });
    const updates: Uint8Array[] = [];
    board.doc.on("update", (update: Uint8Array) => updates.push(update));
    pressKey("KeyR");
    drag(
      canvas(),
      [0, 0],
      [
        [50, 0],
        [100, 20],
      ],
    );
    expect(trails.at(-1)).toEqual([[0, 0, 50, 0, 100, 20]]);
    expect(screen.getByRole("img", { name: "Your laser" })).toBeInTheDocument();
    expect(scene(board)).toHaveLength(0);
    expect(updates).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(LASER_FADE_MS + LASER_TICK_MS);
    });
    expect(trails.at(-1)).toBeNull();
    expect(screen.queryByRole("img", { name: "Your laser" })).toBeNull();
    expect(updates).toHaveLength(0);
  });
});

describe("DRW-06: масштаб штриха", () => {
  it("выделенный штрих тянут за угол — точки растягиваются вместе с рамкой", () => {
    const board = createBoardDocument();
    const id = createDrawing(
      board.objects,
      [
        { x: 0, y: 0 },
        { x: 100, y: 100 },
      ],
      PEN,
      "Alice",
    );
    renderScene(board);
    // Нажатие ловит полоса вдоль штриха.
    const hit = element(id).querySelector(".drawing-hit") as Element;
    drag(hit, [50, 50], []);
    drag(handle("se"), [100, 100], [[200, 300]]);
    const stroke = object(board, id);
    expect(stroke).toMatchObject({ width: 200, height: 300 });
    expect(stroke.drawing?.points.at(-1)).toEqual({ x: 200, y: 300 });
    expect(stroke.style.strokeWidth).toBe(4);
  });
});

describe("MOB-04: касание ладонью игнорируется, пока рисуют", () => {
  const touch = (id: number, x: number, y: number, extra = {}) => ({
    pointerId: id,
    pointerType: "touch",
    button: 0,
    clientX: x,
    clientY: y,
    ...extra,
  });

  it("второе касание во время штриха пальцем не двигает вид и не прерывает штрих", () => {
    const { board, camera } = renderScene();
    pressKey("KeyP");
    fireEvent.pointerDown(canvas(), touch(1, 0, 0));
    fireEvent.pointerMove(canvas(), touch(1, 50, 0));
    fireEvent.pointerDown(canvas(), touch(2, 200, 200));
    fireEvent.pointerMove(canvas(), touch(2, 300, 320));
    fireEvent.pointerUp(canvas(), touch(2, 300, 320));
    fireEvent.pointerMove(canvas(), touch(1, 100, 0));
    fireEvent.pointerUp(canvas(), touch(1, 100, 0));
    expect(camera()).toEqual(HOME);
    expect(only(scene(board))).toMatchObject({ x: 0, width: 100 });
  });

  it("стилус вытесняет штрих, начатый ладонью: остаётся только штрих стилуса", () => {
    const { board, camera } = renderScene();
    pressKey("KeyP");
    fireEvent.pointerDown(canvas(), touch(1, 0, 0));
    const pen = { pointerId: 5, pointerType: "pen", button: 0 };
    fireEvent.pointerDown(canvas(), { ...pen, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas(), touch(1, 80, 80));
    fireEvent.pointerMove(canvas(), { ...pen, clientX: 60, clientY: 10 });
    fireEvent.pointerUp(canvas(), { ...pen, clientX: 60, clientY: 10 });
    fireEvent.pointerUp(canvas(), touch(1, 80, 80));
    expect(only(scene(board))).toMatchObject({ x: 10, y: 10, width: 50 });
    expect(camera()).toEqual(HOME);
  });

  it("касание сразу после стилуса — ладонь пишущей руки: вид не двигается", () => {
    const { board, camera } = renderScene();
    pressKey("KeyP");
    drag(canvas(), [0, 0], [[40, 0]], { pointerType: "pen" });
    pressKey("KeyV");
    drag(canvas(), [100, 100], [[200, 150]], { pointerType: "touch" });
    expect(camera()).toEqual(HOME);
    expect(scene(board)).toHaveLength(1);
  });

  it("широкое пятно касания не начинает штрих", () => {
    const { board, camera } = renderScene();
    pressKey("KeyP");
    const palm = { width: 80, height: 60 };
    fireEvent.pointerDown(canvas(), touch(1, 0, 0, palm));
    fireEvent.pointerMove(canvas(), touch(1, 60, 60, palm));
    fireEvent.pointerUp(canvas(), touch(1, 60, 60, palm));
    expect(scene(board)).toHaveLength(0);
    expect(camera()).toEqual(HOME);
  });

  it("два пальца до начала штриха — щипок, а не штрих", () => {
    const { board, camera } = renderScene();
    pressKey("KeyP");
    fireEvent.pointerDown(canvas(), touch(1, 0, 0));
    fireEvent.pointerDown(canvas(), touch(2, 100, 0));
    fireEvent.pointerMove(canvas(), touch(2, 200, 0));
    fireEvent.pointerUp(canvas(), touch(2, 200, 0));
    fireEvent.pointerUp(canvas(), touch(1, 0, 0));
    expect(scene(board)).toHaveLength(0);
    expect(camera().zoom).toBeGreaterThan(1);
  });
});

describe("MOB-05: режим «стилус сразу рисует»", () => {
  function enableStylusMode() {
    pressKey("KeyP");
    fireEvent.click(
      within(drawPanel()).getByRole("switch", { name: "Stylus draws" }),
    );
    pressKey("KeyV");
  }

  it("включён: стилус с инструментом Select рисует пером, палец двигает вид", () => {
    const { board, camera } = renderScene();
    enableStylusMode();
    drag(canvas(), [0, 0], [[60, 30]], { pointerType: "touch" });
    expect(scene(board)).toHaveLength(0);
    expect(camera()).not.toEqual(HOME);

    drag(canvas(), [0, 0], [[60, 30]], { pointerType: "pen" });
    expect(only(scene(board)).type).toBe("drawing");
    // Режим запоминается в браузере.
    expect(localStorage.getItem(DRAW_SETTINGS_KEY)).toContain(
      '"stylusDraws":true',
    );
  });

  it("выключен: стилус с инструментом Select выделяет и двигает вид, как мышь", () => {
    const { board, camera } = renderScene();
    drag(canvas(), [0, 0], [[60, 30]], { pointerType: "pen" });
    expect(scene(board)).toHaveLength(0);
    expect(camera()).not.toEqual(HOME);
  });
});
