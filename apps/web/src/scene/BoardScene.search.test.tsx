import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import { createObject, objectMap } from "./sceneObjects";
import { click, element, isSelected, renderScene } from "./testScene";

// T5.5: поиск по доске (CVS-08) и ссылка на объект (SHR-07) — через интерфейс сцены.

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

/** Доска: стикер с текстом слева вверху, стикер с тегом далеко справа внизу. */
function boardWithObjects() {
  const board = createBoardDocument();
  const plan = createObject(
    board.objects,
    "sticky",
    { x: 0, y: 0 },
    "Release plan",
  );
  const bug = createObject(
    board.objects,
    "sticky",
    { x: 1000, y: 800 },
    "Login fails",
  );
  const tags = new Y.Array<string>();
  tags.push(["urgent"]);
  objectMap(board.objects, bug)?.set("tags", tags);
  return { board, plan, bug };
}

function searchBox() {
  return within(screen.getByRole("search", { name: "Search board" })).getByRole(
    "searchbox",
    { name: "Search text and tags" },
  );
}

function results() {
  return within(
    screen.getByRole("list", { name: "Search results" }),
  ).getAllByRole("button");
}

describe("CVS-08: поиск по доске", () => {
  it("находит объект по тексту; щелчок по результату переводит вид к нему и выделяет", async () => {
    const user = userEvent.setup();
    const { board, plan } = boardWithObjects();
    const { camera } = renderScene(board);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(searchBox(), "release");

    expect(screen.getByRole("status")).toHaveTextContent("1 result");
    const [hit] = results();
    expect(hit).toHaveTextContent("Sticky note");
    expect(hit).toHaveTextContent("Release plan");
    await user.click(hit as HTMLElement);

    // Стикер 200×200 в (0, 0): центр вида — в его середине.
    expect(camera()).toEqual({ x: 100, y: 100, zoom: 1 });
    expect(isSelected(plan)).toBe(true);
  });

  it("находит объект по тегу и переходит к нему по Enter", async () => {
    const user = userEvent.setup();
    const { board, bug, plan } = boardWithObjects();
    const { camera } = renderScene(board);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(searchBox(), "#urgent{Enter}");

    const [hit] = results();
    expect(hit).toHaveTextContent("#urgent");
    expect(hit).toHaveAttribute("aria-current", "true");
    expect(camera()).toEqual({ x: 1100, y: 900, zoom: 1 });
    expect(isSelected(bug)).toBe(true);
    expect(isSelected(plan)).toBe(false);
  });

  it("Enter перебирает результаты по кругу", async () => {
    const user = userEvent.setup();
    const { board, plan, bug } = boardWithObjects();
    renderScene(board);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(searchBox(), "l{Enter}");
    expect(isSelected(plan)).toBe(true);
    await user.keyboard("{Enter}");
    expect(isSelected(bug)).toBe(true);
    await user.keyboard("{Enter}");
    expect(isSelected(plan)).toBe(true);
  });

  it("ничего не найдено — так и сказано; результаты следят за правками документа", async () => {
    const user = userEvent.setup();
    const { board } = boardWithObjects();
    renderScene(board);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(searchBox(), "budget");
    expect(screen.getByRole("status")).toHaveTextContent("Nothing found.");

    // Объект появился (например, его создал другой участник) — он в результатах.
    createObject(board.objects, "text", { x: 0, y: 400 }, "Budget 2027");
    await waitFor(() => {
      expect(results()).toHaveLength(1);
    });
  });

  it("Escape в поле и кнопка Close закрывают поиск; клавиши сцены в поле не срабатывают", async () => {
    const user = userEvent.setup();
    const { board, plan } = boardWithObjects();
    renderScene(board);
    click(element(plan), [10, 10]);

    await user.click(screen.getByRole("button", { name: "Search" }));
    // Delete удаляет выделенное (CVS-21), но не из поля поиска.
    await user.type(searchBox(), "x{Backspace}{Delete}");
    expect(board.objects.has(plan)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("search")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("search")).toBeNull();
  });

  it("BUG-010: Escape закрывает поиск и при фокусе на результате или Close, выделение остаётся", async () => {
    const user = userEvent.setup();
    const { board, plan } = boardWithObjects();
    renderScene(board);

    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.type(searchBox(), "release");
    await user.tab();
    await user.tab();
    expect(results()[0]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("search")).toBeNull();
    // Переход к результату по Tab не выделял; выделение доски Escape панели не трогает.
    click(element(plan), [10, 10]);
    await user.click(screen.getByRole("button", { name: "Search" }));
    screen.getByRole("button", { name: "Close" }).focus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("search")).toBeNull();
    expect(isSelected(plan)).toBe(true);
  });
});

describe("SHR-07: ссылка на объект", () => {
  it("документ загружен — вид переходит к объекту из ссылки и выделяет его", () => {
    const { board, bug } = boardWithObjects();
    const { camera } = renderScene(board, "Alice", { focusObject: bug });

    expect(camera()).toEqual({ x: 1100, y: 900, zoom: 1 });
    expect(isSelected(bug)).toBe(true);
  });

  it("объекта из ссылки нет на доске — вид не меняется, показано сообщение", async () => {
    const user = userEvent.setup();
    const { board } = boardWithObjects();
    const { camera } = renderScene(board, "Alice", { focusObject: "gone" });

    expect(camera()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(screen.getByRole("status")).toHaveTextContent(
      "The linked object is not on this board.",
    );
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Copy link to object в меню объекта — ссылка на доску с ?object={id}", async () => {
    const user = userEvent.setup();
    const { board, plan } = boardWithObjects();
    const boardLink = vi.fn(() =>
      Promise.resolve("http://192.168.1.20:8080/b/tok-1"),
    );
    renderScene(board, "Alice", { boardLink });

    click(element(plan), [10, 10]);
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Copy link to object" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Link to object" });
    expect(
      await within(dialog).findByRole("textbox", { name: "Object link" }),
    ).toHaveValue(`http://192.168.1.20:8080/b/tok-1?object=${plan}`);
    expect(boardLink).toHaveBeenCalledTimes(1);

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("пункт есть только для одного объекта и только при известной ссылке на доску", async () => {
    const user = userEvent.setup();
    const { board, plan, bug } = boardWithObjects();
    renderScene(board, "Alice", {
      boardLink: () => Promise.resolve("http://192.168.1.20:8080/b/tok-1"),
    });

    click(element(plan), [10, 10]);
    click(element(bug), [1010, 810], { shiftKey: true });
    await user.click(screen.getByRole("button", { name: "More" }));
    expect(
      screen.queryByRole("menuitem", { name: "Copy link to object" }),
    ).toBeNull();
  });
});
