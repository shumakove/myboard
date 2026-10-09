import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import "../richtext/testQuill";
import { createObject, objectText } from "./sceneObjects";
import { click, element, renderScene, scene } from "./testScene";
import { TEXT_STYLE_KEY } from "./textStyle";

// T6.1: текст и документ (TXT-01…TXT-08) — через интерфейс сцены.

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function clipboardEvent(
  type: "copy" | "paste",
  data: Record<string, string> = {},
) {
  const store = { ...data };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (kind: string) => store[kind] ?? "",
      setData: (kind: string, value: string) => {
        store[kind] = value;
      },
    },
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return store;
}

/** Текстовый блок со списком дел: «Milk» не отмечен. */
function boardWithTodo() {
  const board = createBoardDocument();
  const id = createObject(board.objects, "text", { x: 0, y: 0 }, [
    { insert: "Milk" },
    { insert: "\n", attributes: { list: "unchecked" } },
  ]);
  return { board, id };
}

describe("TXT-01: свойства текстового блока", () => {
  it("шрифт, размер, цвет, начертание, выравнивание, интервал и фон меняются в панели выделения", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    click(element(id), [10, 10]);
    const bar = screen.getByRole("toolbar", { name: "Selection" });
    await user.selectOptions(within(bar).getByLabelText("Font size"), "48");
    await user.selectOptions(within(bar).getByLabelText("Text color"), "Blue");
    await user.click(within(bar).getByRole("button", { name: "Text style" }));
    const more = within(bar).getByRole("group", { name: "Text style" });
    await user.selectOptions(within(more).getByLabelText("Font"), "Serif");
    await user.selectOptions(
      within(more).getByLabelText("Style"),
      "Bold italic",
    );
    await user.selectOptions(within(more).getByLabelText("Align"), "Center");
    await user.selectOptions(within(more).getByLabelText("Line spacing"), "2");
    await user.selectOptions(
      within(more).getByLabelText("Background"),
      "Yellow",
    );

    expect(scene(board)[0]?.style).toMatchObject({
      fontSize: 48,
      color: "#81d4fa",
      fontFamily: "serif",
      fontStyle: "bold-italic",
      align: "center",
      lineHeight: 2,
      background: "#fff176",
    });
    const shown = element(id);
    expect(shown.style.fontSize).toBe("48px");
    expect(shown.style.fontWeight).toBe("700");
    expect(shown.style.fontStyle).toBe("italic");
    expect(shown.style.textAlign).toBe("center");
    expect(shown.style.lineHeight).toBe("2");
    expect(shown.style.fontFamily).toContain("Georgia");
  });
});

describe("TXT-02: список дел на холсте", () => {
  it("флажок отмечает пункт без редактора; отметка — в документе и у второго участника", async () => {
    const user = userEvent.setup();
    const { board, id } = boardWithTodo();
    renderScene(board);
    await user.click(screen.getByRole("checkbox", { name: "Done" }));
    expect(screen.queryByLabelText("Object text")).toBeNull();
    expect(objectText(board.objects, id)?.toDelta()).toEqual([
      { insert: "Milk" },
      { insert: "\n", attributes: { list: "checked" } },
    ]);
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeChecked();
  });

  it("CVS-19: у заблокированного блока флажок не отмечается", () => {
    const { board, id } = boardWithTodo();
    const map = board.objects.get(id) as Y.Map<unknown>;
    map.set("locked", true);
    renderScene(board);
    expect(screen.getByRole("checkbox", { name: "Done" })).toBeDisabled();
  });
});

describe("TXT-05: размер и цвет последнего текста", () => {
  it("новый текстовый блок получает размер и цвет, выбранные в этой вкладке", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    click(element(id), [10, 10]);
    const bar = screen.getByRole("toolbar", { name: "Selection" });
    await user.selectOptions(within(bar).getByLabelText("Font size"), "36");
    await user.selectOptions(within(bar).getByLabelText("Text color"), "Pink");
    expect(JSON.parse(sessionStorage.getItem(TEXT_STYLE_KEY) ?? "")).toEqual({
      fontSize: 36,
      color: "#f48fb1",
    });

    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    click(screen.getByTestId("board-canvas"), [500, 500]);
    const created = scene(board).find((o) => o.id !== id);
    expect(created?.style).toMatchObject({ fontSize: 36, color: "#f48fb1" });
  });

  it("стикер размер и цвет текста не запоминает", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    click(element(id), [10, 10]);
    await user.selectOptions(screen.getByLabelText("Fill"), "Blue");
    expect(sessionStorage.getItem(TEXT_STYLE_KEY)).toBeNull();
  });
});

describe("TXT-06: документ", () => {
  it("инструмент Document ставит документ; ссылка на объект в нём переводит к объекту", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const target = createObject(
      board.objects,
      "sticky",
      { x: 900, y: 900 },
      "Goal",
    );
    const doc = createObject(board.objects, "document", { x: 0, y: 0 }, [
      { insert: "See " },
      { insert: { objectLink: target } },
      { insert: "\n" },
    ]);
    const { camera } = renderScene(board);
    expect(element(doc)).toHaveAttribute("data-type", "document");
    await user.click(screen.getByRole("button", { name: "Sticky note: Goal" }));
    expect(element(target)).toHaveAttribute("aria-selected", "true");
    expect(camera()).toMatchObject({ x: 1000, y: 1000 });
  });

  it("клавиша D выбирает инструмент Document", () => {
    const { board } = renderScene();
    fireEvent.keyDown(window, { code: "KeyD", key: "d" });
    click(screen.getByTestId("board-canvas"), [0, 0]);
    expect(scene(board)).toEqual([
      expect.objectContaining({ type: "document" }),
    ]);
  });
});

describe("TXT-07, TXT-08: буфер обмена и внешние редакторы", () => {
  it("копия выделенного текста — HTML с форматированием и простой текст", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, [
      { insert: "Plan" },
      { insert: "\n", attributes: { header: 1 } },
      { insert: "bold", attributes: { bold: true } },
      { insert: "\n" },
    ]);
    renderScene(board);
    click(element(id), [10, 10]);
    const store = clipboardEvent("copy");
    expect(store["text/html"]).toBe(
      "<h1>Plan</h1><p><strong>bold</strong></p>",
    );
    expect(store["text/plain"]).toBe("Plan\nbold");
  });

  it("копия и вставка на доске сохраняют форматирование", () => {
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, [
      { insert: "Item" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);
    renderScene(board);
    click(element(id), [10, 10]);
    const store = clipboardEvent("copy");
    clipboardEvent("paste", store);
    const pasted = scene(board).find((o) => o.id !== id);
    expect(pasted?.rich).toEqual([
      { insert: "Item" },
      { insert: "\n", attributes: { list: "bullet" } },
    ]);
  });

  it("HTML внешнего документа становится текстовым блоком с базовым форматированием", () => {
    const board = createBoardDocument();
    renderScene(board);
    clipboardEvent("paste", {
      "text/html":
        '<h2>Agenda</h2><ul><li><b>One</b></li></ul><p style="color:red">plain</p>',
      "text/plain": "Agenda One plain",
    });
    const [created] = scene(board);
    expect(created?.type).toBe("text");
    expect(created?.rich).toEqual([
      { insert: "Agenda" },
      { insert: "\n", attributes: { header: 2 } },
      { insert: "One", attributes: { bold: true } },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "plain" },
    ]);
    expect(created?.height).toBeGreaterThan(60);
  });
});

describe("TXT-03, TXT-04: редактор текста", () => {
  it("редактор — поле Object text с панелью начертания; Escape закрывает", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "text", { x: 0, y: 0 }, "Hi");
    renderScene(board);
    click(element(id), [10, 10]);
    await user.click(screen.getByRole("button", { name: "Edit text" }));
    const field = screen.getByRole("textbox", { name: "Object text" });
    expect(field).toHaveFocus();
    // Панель выделения на время правки скрыта: она закрывала бы панель редактора.
    expect(screen.queryByRole("toolbar", { name: "Selection" })).toBeNull();
    const toolbar = screen.getByRole("toolbar", { name: "Text formatting" });
    for (const name of [
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Link",
    ]) {
      expect(within(toolbar).getByRole("button", { name })).toBeEnabled();
    }
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Object text" })).toBeNull();
  });
});
