import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createObject } from "./sceneObjects";
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

// T5.4: CVS-07 отмена и повтор, CVS-24 закреплённые инструменты, CVS-25 горячие клавиши.

afterEach(() => {
  localStorage.clear();
});

function tools() {
  return screen.getByRole("toolbar", { name: "Tools" });
}

function toolButton(name: string) {
  return within(tools()).getByRole("button", { name });
}

function pinnedNames(): string[] {
  return within(tools())
    .getAllByRole("button")
    .filter((button) => button.hasAttribute("aria-keyshortcuts"))
    .filter((button) => !["Undo", "Redo"].includes(button.textContent))
    .map((button) => button.textContent);
}

describe("CVS-07 Undo/Redo в интерфейсе", () => {
  it("Ctrl+Z отменяет перетаскивание целиком, Ctrl+Shift+Z повторяет", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();

    drag(
      element(id),
      [50, 50],
      [
        [70, 50],
        [120, 90],
        [250, 130],
      ],
    );
    const moved = object(board, id);
    expect(moved.x).not.toBe(0);

    await user.keyboard("{Control>}z{/Control}");
    expect(object(board, id)).toMatchObject({ x: 0, y: 0 });
    expect(screen.getByRole("button", { name: "Redo" })).toBeEnabled();

    await user.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(object(board, id)).toMatchObject({ x: moved.x, y: moved.y });
  });

  it("⌘Z и кнопки Undo/Redo; удаление отменяется", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    click(element(id), [10, 10]);
    await user.keyboard("{Delete}");
    expect(scene(board)).toHaveLength(0);

    await user.keyboard("{Meta>}z{/Meta}");
    expect(scene(board).map((o) => o.id)).toEqual([id]);

    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(scene(board)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Undo" }));
    expect(scene(board)).toHaveLength(1);
  });

  it("Undo не трогает объект второго клиента", async () => {
    const user = userEvent.setup();
    const [docA, docB] = linkedDocs();
    const a = createBoardDocument(docA);
    const b = createBoardDocument(docB);
    renderScene(a);
    await user.click(toolButton("Sticky note"));
    click(canvas(), [0, 0]);
    await user.keyboard("{Escape}");
    const theirs = createObject(b.objects, "shape", { x: 400, y: 0 });
    expect(scene(b)).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(scene(b).map((o) => o.id)).toEqual([theirs]);
  });

  it("в поле ввода Ctrl+Z принадлежит полю", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    createObject(board.objects, "sticky", { x: 0, y: 0 });
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();

    await user.keyboard("{Control>}z{/Control}");

    expect(scene(board)).toHaveLength(1);
    input.remove();
  });
});

describe("CVS-25 горячие клавиши инструментов", () => {
  it("V, L, N, S, T выбирают инструмент", async () => {
    const user = userEvent.setup();
    renderScene();
    const keys: [string, string][] = [
      ["l", "Lasso"],
      ["n", "Sticky note"],
      ["s", "Shape"],
      ["t", "Text"],
      ["v", "Select"],
    ];
    for (const [key, name] of keys) {
      await user.keyboard(key);
      expect(toolButton(name)).toHaveAttribute("aria-pressed", "true");
    }
  });

  it("клавиша N, затем щелчок по холсту ставит стикер", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    await user.keyboard("n");
    click(canvas(), [0, 0]);
    expect(scene(board).map((o) => o.type)).toEqual(["sticky"]);
  });

  it("клавиша в поле ввода инструмент не меняет", async () => {
    const user = userEvent.setup();
    renderScene();
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    await user.keyboard("l");
    expect(toolButton("Select")).toHaveAttribute("aria-pressed", "true");
    input.remove();
  });

  it("кнопки инструментов подсказывают клавишу", () => {
    renderScene();
    expect(toolButton("Lasso")).toHaveAttribute("aria-keyshortcuts", "L");
    expect(toolButton("Lasso").title).toMatch(/^Lasso \(L\)/);
  });
});

describe("CVS-24 закреплённые инструменты и полный список", () => {
  async function openList(user: ReturnType<typeof userEvent.setup>) {
    await user.click(toolButton("All tools"));
    return screen.getByRole("dialog", { name: "All tools" });
  }

  it("открепление убирает инструмент с панели; он остаётся в полном списке", async () => {
    const user = userEvent.setup();
    renderScene();
    const list = await openList(user);
    await user.click(within(list).getByRole("switch", { name: "Pin Lasso" }));
    expect(pinnedNames()).toEqual(["Select", "Sticky note", "Shape", "Text"]);

    await user.click(within(list).getByRole("button", { name: "Lasso" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Выбранный из списка инструмент работает, хоть и не на панели.
    await user.click(toolButton("All tools"));
    const again = screen.getByRole("dialog", { name: "All tools" });
    expect(
      within(again).getByRole("button", { name: "Lasso" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("порядок меняется и вместе с набором сохраняется после перезагрузки", async () => {
    const user = userEvent.setup();
    const first = renderScene();
    const list = await openList(user);
    await user.click(
      within(list).getByRole("button", { name: "Move Text up" }),
    );
    await user.click(
      within(list).getByRole("button", { name: "Move Text up" }),
    );
    await user.click(within(list).getByRole("switch", { name: "Pin Select" }));
    await user.click(within(list).getByRole("button", { name: "Done" }));
    expect(pinnedNames()).toEqual(["Lasso", "Text", "Sticky note", "Shape"]);

    first.unmount();
    renderScene();
    expect(pinnedNames()).toEqual(["Lasso", "Text", "Sticky note", "Shape"]);
  });

  it("закрепление возвращает инструмент в конец панели", async () => {
    const user = userEvent.setup();
    renderScene();
    const list = await openList(user);
    const pin = within(list).getByRole("switch", { name: "Pin Select" });
    await user.click(pin);
    expect(pin).not.toBeChecked();
    expect(
      within(list).getByRole("button", { name: "Move Select up" }),
    ).toBeDisabled();
    await user.click(pin);
    expect(pinnedNames()).toEqual([
      "Lasso",
      "Sticky note",
      "Shape",
      "Text",
      "Select",
    ]);
  });

  it("пока список открыт, клавиши сцены не работают; Escape закрывает его с первого раза", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 });
    renderScene(board);
    click(element(id), [10, 10]);
    await openList(user);
    // Фокус остался на кнопке All tools панели — вне диалога.
    expect(document.activeElement).toBe(toolButton("All tools"));
    await user.keyboard("{Delete}l");
    expect(scene(board)).toHaveLength(1);
    expect(toolButton("Select")).toHaveAttribute("aria-pressed", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
