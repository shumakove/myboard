import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
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

// T6.6: фреймы (FRM-01…FRM-05) — через интерфейс сцены.

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

function select(label: string) {
  return within(selectionBar()).getByRole<HTMLSelectElement>("combobox", {
    name: label,
  });
}

/** Фрейм 640×480 в (0, 0) и стикер 200×200 снаружи в (1000, 0). */
function frameAndSticky() {
  const board = createBoardDocument();
  const frame = createObject(board.objects, "frame", { x: 0, y: 0 });
  const sticky = createObject(board.objects, "sticky", { x: 1000, y: 0 });
  return { board, frame, sticky };
}

/** Стикер переносится мышью во фрейм: центр (1100, 100) → (200, 200). */
function dropStickyIntoFrame(sticky: string) {
  drag(element(sticky), [1100, 100], [[200, 200]], { altKey: true });
}

describe("FRM-01: фрейм и его содержимое", () => {
  it("инструмент Frame (клавиша F) ставит фрейм; стикер, поставленный в нём, — его объект", () => {
    const board = createBoardDocument();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyF", key: "f" });
    click(canvas(), [320, 240]);
    const frame = scene(board).find((o) => o.type === "frame");
    if (frame === undefined) throw new Error("фрейм не создан");
    expect(frame).toMatchObject({ x: 0, y: 0, width: 640, height: 480 });
    expect(element(frame.id).getAttribute("aria-label")).toBe("Frame");

    fireEvent.keyDown(document.body, { code: "KeyN", key: "n" });
    click(canvas(), [300, 200]);
    const sticky = scene(board).find((o) => o.type === "sticky");
    expect(sticky?.parent).toBe(frame.id);
  });

  it("объект, перенесённый во фрейм, двигается вместе с ним", () => {
    const { board, frame, sticky } = frameAndSticky();
    renderScene(board);
    dropStickyIntoFrame(sticky);
    expect(object(board, sticky)).toMatchObject({ parent: frame, x: 100 });

    // Щелчок по стикеру во фрейме выделяет стикер, а не фрейм.
    click(element(sticky), [200, 200]);
    expect(element(sticky).getAttribute("aria-selected")).toBe("true");

    drag(element(frame), [600, 400], [[900, 500]], { altKey: true });
    expect(object(board, frame)).toMatchObject({ x: 300, y: 100 });
    expect(object(board, sticky)).toMatchObject({ x: 400, y: 200 });
  });

  it("вынесенный из фрейма объект остаётся на месте, когда фрейм двигают", () => {
    const { board, frame, sticky } = frameAndSticky();
    renderScene(board);
    dropStickyIntoFrame(sticky);
    drag(element(sticky), [200, 200], [[1200, 200]], { altKey: true });
    expect(object(board, sticky).parent).toBeNull();

    drag(element(frame), [600, 400], [[900, 400]], { altKey: true });
    expect(object(board, sticky)).toMatchObject({ x: 1100, y: 100 });
  });
});

describe("FRM-02: оформление фрейма", () => {
  it("заливка, только граница и рамка без фона — в том числе своим цветом", async () => {
    const user = userEvent.setup();
    const { board, frame } = frameAndSticky();
    renderScene(board);
    click(element(frame), [600, 400]);
    expect(element(frame).dataset.appearance).toBe("fill");

    await user.selectOptions(select("Frame color"), "Blue");
    expect(element(frame).style.background).toBe("rgb(129, 212, 250)");

    await user.selectOptions(select("Frame style"), "Border only");
    expect(element(frame).dataset.appearance).toBe("border");
    expect(element(frame).style.background).toBe("rgb(255, 255, 255)");
    expect(element(frame).style.borderColor).toBe("rgb(129, 212, 250)");

    await user.selectOptions(select("Frame style"), "No background");
    expect(element(frame).dataset.appearance).toBe("outline");
    expect(element(frame).style.background).toBe("transparent");

    await user.click(barButton("Custom color"));
    const input = screen.getByLabelText<HTMLInputElement>("Custom frame color");
    input.value = "#123456";
    fireEvent.change(input);
    expect(object(board, frame).style).toMatchObject({
      appearance: "outline",
      fill: "#123456",
    });
    expect(element(frame).style.borderColor).toBe("rgb(18, 52, 86)");
  });
});

describe("FRM-03: фиксация пропорций", () => {
  it("с Keep proportions угол меняет размер в прежнем соотношении", async () => {
    const user = userEvent.setup();
    const { board, frame } = frameAndSticky();
    renderScene(board);
    click(element(frame), [600, 400]);
    await user.click(screen.getByRole("switch", { name: "Keep proportions" }));
    expect(object(board, frame).frameOptions?.keepRatio).toBe(true);

    drag(handle("se"), [640, 480], [[1280, 500]]);
    expect(object(board, frame)).toMatchObject({ width: 1280, height: 960 });
  });

  it("без фиксации стороны меняются независимо", () => {
    const { board, frame } = frameAndSticky();
    renderScene(board);
    click(element(frame), [600, 400]);
    drag(handle("se"), [640, 480], [[1280, 500]]);
    expect(object(board, frame)).toMatchObject({ width: 1280, height: 500 });
  });
});

describe("FRM-04: скрытие содержимого", () => {
  it("Hide content прячет объекты фрейма, Show content возвращает — и у заблокированного", async () => {
    const user = userEvent.setup();
    const { board, frame, sticky } = frameAndSticky();
    renderScene(board);
    dropStickyIntoFrame(sticky);

    click(element(frame), [600, 400]);
    await user.click(barButton("Hide content"));
    expect(document.querySelector(`[data-object-id="${sticky}"]`)).toBeNull();
    expect(within(element(frame)).getByText("Content hidden")).toBeTruthy();

    // Блокировка рамки с содержимым не мешает показать и снова скрыть содержимое.
    await user.click(barButton("Lock"));
    await user.click(
      within(screen.getByRole("group", { name: "Lock frame" })).getByRole(
        "button",
        { name: "Frame and content" },
      ),
    );
    expect(object(board, frame).locked).toBe(true);
    await user.click(barButton("Show content"));
    expect(element(sticky)).toBeTruthy();
    await user.click(barButton("Hide content"));
    expect(document.querySelector(`[data-object-id="${sticky}"]`)).toBeNull();
  });

  it("скрытие видно другому участнику (поле документа)", () => {
    const { board, frame, sticky } = frameAndSticky();
    renderScene(board);
    dropStickyIntoFrame(sticky);
    const map = board.objects.get(frame) as Y.Map<unknown>;
    map.set("contentHidden", true);
    expect(object(board, sticky).hidden).toBe(true);
  });
});

describe("FRM-05: выбор режима блокировки", () => {
  function lockAs(choice: "Frame only" | "Frame and content") {
    fireEvent.click(barButton("Lock"));
    const group = screen.getByRole("group", { name: "Lock frame" });
    expect(within(group).getByText("Lock what?")).toBeTruthy();
    fireEvent.click(within(group).getByRole("button", { name: choice }));
  }

  it("Frame only: фрейм не двигается, объект внутри двигается", () => {
    const { board, frame, sticky } = frameAndSticky();
    renderScene(board);
    dropStickyIntoFrame(sticky);
    click(element(frame), [600, 400]);
    lockAs("Frame only");
    expect(object(board, frame).locked).toBe(true);

    drag(element(frame), [600, 400], [[900, 400]], { altKey: true });
    expect(object(board, frame)).toMatchObject({ x: 0, y: 0 });
    drag(element(sticky), [200, 200], [[300, 250]], { altKey: true });
    expect(object(board, sticky)).toMatchObject({
      locked: false,
      x: 200,
      y: 150,
    });
  });

  it("Frame and content: не двигается ни фрейм, ни объект внутри", () => {
    const { board, frame, sticky } = frameAndSticky();
    renderScene(board);
    dropStickyIntoFrame(sticky);
    click(element(frame), [600, 400]);
    lockAs("Frame and content");

    drag(element(sticky), [200, 200], [[300, 250]], { altKey: true });
    expect(object(board, sticky)).toMatchObject({
      locked: true,
      x: 100,
      y: 100,
    });
  });

  it("у объектов без фреймов Lock блокирует сразу, без выбора", () => {
    const { board, sticky } = frameAndSticky();
    renderScene(board);
    click(element(sticky), [1100, 100]);
    fireEvent.click(barButton("Lock"));
    expect(screen.queryByRole("group", { name: "Lock frame" })).toBeNull();
    expect(object(board, sticky).locked).toBe(true);
  });

  it("в контекстном меню фрейма — оба варианта блокировки", () => {
    const { board, frame } = frameAndSticky();
    renderScene(board);
    fireEvent.contextMenu(element(frame), { clientX: 600, clientY: 400 });
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Lock" })).toBeNull();
    fireEvent.click(
      within(menu).getByRole("menuitem", { name: "Lock frame only" }),
    );
    expect(object(board, frame)).toMatchObject({
      locked: true,
      frameOptions: { lockContent: false },
    });
  });
});
