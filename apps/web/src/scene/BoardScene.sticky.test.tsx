import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import { Quill } from "../richtext/quill";
import { typeInto } from "../richtext/testQuill";
import { createObject, objectMap, objectText } from "./sceneObjects";
import { addTag } from "./tags";
import { linkedDocs } from "./testDocs";
import {
  canvas,
  click,
  drag,
  element,
  isSelected,
  object,
  renderScene,
  scene,
} from "./testScene";

// T6.2: стикеры (STK-01…STK-05) — через интерфейс сцены.

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

const PINK = "#f48fb1";
const BLUE = "#81d4fa";
const GREEN = "#a5d6a7";

function palette() {
  return screen.getByRole("toolbar", { name: "Sticky note color" });
}

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function editorField() {
  return screen.getByRole("textbox", { name: "Object text" });
}

describe("STK-01: цвет стикера", () => {
  it("цвет выбирается до постановки: палитра у инструмента, новый стикер — этого цвета", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    expect(
      screen.queryByRole("toolbar", { name: "Sticky note color" }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    const pink = within(palette()).getByRole("button", { name: "Pink" });
    await user.click(pink);
    expect(pink).toHaveAttribute("aria-pressed", "true");
    click(canvas(), [100, 100]);

    expect(scene(board)).toEqual([
      expect.objectContaining({
        type: "sticky",
        style: { fill: PINK, fontSize: "auto" },
      }),
    ]);
    expect(element(scene(board)[0]?.id ?? "")).toHaveStyle({
      backgroundColor: PINK,
    });
    // Инструмент снова Select — палитра скрыта; выбор помнится до конца сессии вкладки.
    expect(
      screen.queryByRole("toolbar", { name: "Sticky note color" }),
    ).toBeNull();
    fireEvent.keyDown(editorField(), { key: "Escape" });
    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    expect(
      within(palette()).getByRole("button", { name: "Pink" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("образец, перетащенный с палитры на холст, ставит стикер своего цвета в точку отпускания", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "board-canvas"
          ? new DOMRect(0, 0, 800, 600)
          : new DOMRect(0, 0, 0, 0);
      },
    );
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    const blue = within(palette()).getByRole("button", { name: "Blue" });
    fireEvent.pointerDown(blue, {
      pointerId: 4,
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(blue, { pointerId: 4, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(blue, { pointerId: 4, clientX: 500, clientY: 400 });
    fireEvent.click(blue);

    // Точка (500, 400) области 800×600 — точка доски (100, 100); стикер 200×200.
    expect(scene(board)).toEqual([
      expect.objectContaining({
        type: "sticky",
        x: 0,
        y: 0,
        style: { fill: BLUE, fontSize: "auto" },
      }),
    ]);
    // Перетаскивание образца не меняет выбранный цвет.
    expect(sessionStorage.getItem("myboard.stickyColor")).toBeNull();
  });
});

describe("STK-02: размер шрифта стикера", () => {
  /** Раскладка jsdom: ~0,6 em на символ в ширину 176, строка 1,25 em. */
  function fakeLayout() {
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        if (!this.classList.contains("rich-text")) return 0;
        const box = this.closest<HTMLElement>(".scene-object");
        const size = parseFloat(box?.style.fontSize ?? "") || 20;
        const chars = this.textContent.length;
        const lines = Math.max(1, Math.ceil((chars * size * 0.6) / 176));
        return lines * size * 1.25;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return parseFloat(this.style.height) || 0;
      },
    );
  }

  it("по умолчанию — Auto: длинный текст уменьшает шрифт, в том числе после чужой правки", async () => {
    fakeLayout();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    const shortSize = parseFloat(element(id).style.fontSize);
    expect(element(id)).toHaveAttribute("data-font-fit", "auto");
    act(() => {
      objectText(board.objects, id)?.insert(
        2,
        " — a much longer note ".repeat(8),
      );
    });
    await waitFor(() => {
      expect(parseFloat(element(id).style.fontSize)).toBeLessThan(shortSize);
    });
  });

  it("размер шрифта задаётся вручную в панели выделения; Auto возвращает подгон", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    click(element(id), [10, 10]);
    const size = within(selectionBar()).getByLabelText("Font size");
    expect(size).toHaveValue("auto");
    expect(within(size).getByRole("option", { name: "Auto" })).toBeVisible();
    await user.selectOptions(size, "32");
    expect(object(board, id).style.fontSize).toBe(32);
    expect(element(id).style.fontSize).toBe("32px");
    expect(element(id)).not.toHaveAttribute("data-font-fit");

    await user.selectOptions(size, "Auto");
    expect(object(board, id).style.fontSize).toBe("auto");
    expect(element(id)).toHaveAttribute("data-font-fit", "auto");
  });

  it("у фигуры и текста варианта Auto нет", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    click(element(id), [10, 10]);
    const size = within(selectionBar()).getByLabelText("Font size");
    expect(within(size).queryByRole("option", { name: "Auto" })).toBeNull();
  });
});

describe("STK-03: теги и автор", () => {
  it("теги добавляются и убираются в панели выделения, видны на стикере и у второго участника", async () => {
    const user = userEvent.setup();
    const [docA, docB] = linkedDocs();
    const board = createBoardDocument(docA);
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 }, "Bug");
    renderScene(board);
    click(element(id), [10, 10]);
    await user.click(
      within(selectionBar()).getByRole("button", { name: "Tags" }),
    );
    const group = within(selectionBar()).getByRole("group", { name: "Tags" });
    await user.type(within(group).getByLabelText("Add tag"), "#urgent{Enter}");
    await user.type(within(group).getByLabelText("Add tag"), "backend");
    await user.click(within(group).getByRole("button", { name: "Add" }));

    const remote = createBoardDocument(docB).objects;
    expect(objectMap(remote, id)?.get("tags")).toBeInstanceOf(Y.Array);
    expect(object(createBoardDocument(docB), id).tags).toEqual([
      "urgent",
      "backend",
    ]);
    const shown = within(element(id)).getByRole("list", { name: "Tags" });
    expect(
      within(shown)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["urgent", "backend"]);

    await user.click(
      within(group).getByRole("button", { name: "Remove tag urgent" }),
    );
    expect(object(board, id).tags).toEqual(["backend"]);
  });

  it("имя автора показано на стикере; переключатель Show author скрывает его у всех", async () => {
    const user = userEvent.setup();
    const [docA, docB] = linkedDocs();
    const board = createBoardDocument(docA);
    const id = createObject(
      board.objects,
      "sticky",
      { x: 0, y: 0 },
      "Idea",
      "Alice",
    );
    renderScene(board, "Bob");
    expect(within(element(id)).getByTestId("sticky-author")).toHaveTextContent(
      "Alice",
    );
    click(element(id), [10, 10]);
    const toggle = within(selectionBar()).getByRole("switch", {
      name: "Show author",
    });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(within(element(id)).queryByTestId("sticky-author")).toBeNull();
    expect(object(createBoardDocument(docB), id).showAuthor).toBe(false);
  });

  it("CVS-19: у заблокированного стикера теги не правятся", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    objectMap(board.objects, id)?.set("locked", true);
    renderScene(board);
    click(element(id), [10, 10]);
    expect(
      within(selectionBar()).queryByRole("button", { name: "Tags" }),
    ).toBeNull();
  });
});

describe("STK-04: Tab создаёт следующий стикер", () => {
  it("Tab в правке стикера — новый стикер справа того же цвета, правка переходит в него", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 }, "One");
    objectMap(board.objects, id)?.set("fill", PINK);
    renderScene(board);
    fireEvent.doubleClick(element(id), { clientX: 50, clientY: 50 });
    fireEvent.keyDown(editorField(), { key: "Tab" });

    const next = scene(board).find((o) => o.id !== id);
    expect(next).toMatchObject({
      type: "sticky",
      x: 220,
      y: 0,
      text: "",
      style: { fill: PINK, fontSize: "auto" },
    });
    const field = editorField();
    expect(field).toHaveFocus();
    expect(field.closest<HTMLElement>(".scene-editor")?.style.left).toBe(
      "220px",
    );
    expect(isSelected(next?.id ?? "")).toBe(true);
    // Текст первого стикера не изменился: Tab не попал в него.
    expect(object(board, id).text).toBe("One");
  });

  it("CVS-07: отмена убирает стикер, созданный по Tab, а правку первого — следующим шагом", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    fireEvent.doubleClick(element(id), { clientX: 50, clientY: 50 });
    const quill = Quill.find(
      editorField().parentElement as HTMLElement,
    ) as Quill;
    act(() => {
      typeInto(quill, "One");
    });
    fireEvent.keyDown(editorField(), { key: "Tab" });
    fireEvent.keyDown(editorField(), { key: "Escape" });
    expect(scene(board)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(scene(board)).toEqual([
      expect.objectContaining({ id, text: "One" }),
    ]);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(object(board, id).text).toBe("");
  });

  it("в текстовом блоке Tab стикер не создаёт", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, "One");
    renderScene(board);
    fireEvent.doubleClick(element(id), { clientX: 10, clientY: 10 });
    fireEvent.keyDown(editorField(), { key: "Tab" });
    expect(scene(board)).toHaveLength(1);
  });
});

describe("STK-05: стопка стикеров", () => {
  it("стопка выбранного цвета; из неё вытягивается стикер её цвета и с её тегами", async () => {
    const user = userEvent.setup();
    const { board } = renderScene(createBoardDocument(), "Kate");
    // Инструмент Sticky stack — в полном списке All tools и по клавише K.
    await user.keyboard("k");
    await user.click(within(palette()).getByRole("button", { name: "Green" }));
    click(canvas(), [100, 100]);
    const [stack] = scene(board);
    expect(stack).toMatchObject({
      type: "stack",
      style: { fill: GREEN },
    });
    const stackId = stack?.id ?? "";
    // У стопки нет своего текста: правка не открывается.
    expect(screen.queryByRole("textbox", { name: "Object text" })).toBeNull();
    fireEvent.doubleClick(element(stackId), { clientX: 100, clientY: 100 });
    expect(screen.queryByRole("textbox", { name: "Object text" })).toBeNull();
    addTag(board.objects, stackId, "retro", "Kate");

    // Щелчок по пустому месту снимает выделение; стопку тянут — выходит стикер.
    click(canvas(), [900, 900]);
    drag(
      element(stackId),
      [100, 100],
      [
        [300, 200],
        [600, 420],
      ],
    );
    const pulled = scene(board).find((o) => o.id !== stackId);
    expect(pulled).toMatchObject({
      type: "sticky",
      tags: ["retro"],
      style: { fill: GREEN, fontSize: "auto" },
      meta: { createdBy: "Kate" },
    });
    // Центр стикера — под указателем (угол прилипает к сетке 20).
    expect(pulled?.x).toBe(500);
    expect(pulled?.y).toBe(320);
    expect(isSelected(pulled?.id ?? "")).toBe(true);
    // Стопка на месте.
    expect(object(board, stackId)).toMatchObject({ x: stack?.x, y: stack?.y });
  });

  it("щелчок выделяет стопку без нового стикера; выделенную стопку тянут как объект", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "stack", { x: 0, y: 0 });
    renderScene(board);
    click(element(id), [50, 50]);
    expect(isSelected(id)).toBe(true);
    expect(scene(board)).toHaveLength(1);

    drag(element(id), [50, 50], [[150, 90]]);
    expect(scene(board)).toHaveLength(1);
    expect(object(board, id)).toMatchObject({ x: 100, y: 40 });
  });

  it("MOB-03: пальцем стикер из стопки тоже вытягивается", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "stack", { x: 0, y: 0 });
    renderScene(board);
    drag(element(id), [100, 100], [[400, 100]], { pointerType: "touch" });
    expect(
      scene(board)
        .map((o) => o.type)
        .sort(),
    ).toEqual(["stack", "sticky"]);
  });
});
