import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBoardDocument,
  type BoardDocument,
} from "../realtime/boardDocument";
import {
  addReply,
  createThread,
  readThreads,
  type CommentThread,
} from "../comments/commentData";
import { createObject } from "./sceneObjects";
import { linkedDocs } from "./testDocs";
import { canvas, click, drag, element, object, renderScene } from "./testScene";

// T6.10: комментарии (CMT-01…CMT-04) через интерфейс сцены. Стикер — в (100, 100).

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

function stickyBoard(board = createBoardDocument()) {
  const id = createObject(board.objects, "sticky", { x: 100, y: 100 });
  return { board, id };
}

function panel() {
  return screen.getByRole("region", { name: "Comments" });
}

function pins(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-comment-id]")];
}

function pinAt(pin: HTMLElement | undefined): [number, number] {
  return [
    Number.parseFloat(pin?.style.left ?? ""),
    Number.parseFloat(pin?.style.top ?? ""),
  ];
}

function threads(board: BoardDocument): CommentThread[] {
  return readThreads(board.comments);
}

async function post(text: string) {
  await userEvent.type(
    within(panel()).getByRole("textbox", { name: "Comment" }),
    text,
  );
  await userEvent.click(within(panel()).getByRole("button", { name: "Post" }));
}

describe("CMT-01: комментарий к объекту и к точке холста", () => {
  it("инструмент Comment по объекту — ветка у объекта, метка едет вместе с ним", async () => {
    const { board, id } = stickyBoard();
    renderScene(board);
    // Инструмент — в полном списке All tools (его можно закрепить, CVS-24).
    await userEvent.click(
      within(screen.getByRole("toolbar", { name: "Tools" })).getByRole(
        "button",
        { name: "All tools" },
      ),
    );
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "All tools" })).getByRole(
        "button",
        { name: "Comment" },
      ),
    );
    click(element(id), [110, 120]);
    expect(within(panel()).getByText("On Sticky note")).toBeTruthy();
    await post("Check the wording");

    const [thread] = threads(board);
    expect(thread?.anchor).toMatchObject({ object: id });
    expect(thread?.messages.map((m) => [m.author, m.text])).toEqual([
      ["Alice", "Check the wording"],
    ]);
    expect(pinAt(pins()[0])).toEqual([110, 120]);

    drag(element(id), [150, 150], [[250, 210]]);
    expect(object(board, id)).toMatchObject({ x: 200, y: 160 });
    expect(pinAt(pins()[0])).toEqual([210, 180]);
  });

  it("клавиша O и щелчок по пустому месту — ветка в точке холста", async () => {
    const { board } = stickyBoard();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyO", key: "o" });
    click(canvas(), [-300, 40]);
    expect(within(panel()).getByText("On the board")).toBeTruthy();
    await post("Free note");
    expect(threads(board)[0]?.anchor).toEqual({ object: null, x: -300, y: 40 });
    expect(pinAt(pins()[0])).toEqual([-300, 40]);
  });

  it("меню объекта и меню пустого места дают начать комментарий", async () => {
    const { board, id } = stickyBoard();
    renderScene(board);
    fireEvent.contextMenu(element(id), { clientX: 120, clientY: 120 });
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Add comment" }),
    );
    await post("On object");
    fireEvent.contextMenu(canvas(), { clientX: 600, clientY: -200 });
    await userEvent.click(
      screen.getByRole("menuitem", { name: "Add comment here" }),
    );
    await post("On point");
    expect(threads(board).map((t) => t.anchor.object)).toEqual([id, null]);
  });

  it("отмена новой ветки ничего не пишет в документ", async () => {
    const { board } = stickyBoard();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyO", key: "o" });
    click(canvas(), [0, 0]);
    await userEvent.click(
      within(panel()).getByRole("button", { name: "Cancel" }),
    );
    expect(board.comments.size).toBe(0);
    expect(document.querySelector("[data-comment-draft]")).toBeNull();
  });

  it("метка объекта, удалённого с доски, пропадает с холста", async () => {
    const { board, id } = stickyBoard();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyO", key: "o" });
    click(element(id), [110, 110]);
    await post("Soon gone");
    expect(pins()).toHaveLength(1);
    act(() => {
      board.objects.delete(id);
    });
    expect(pins()).toHaveLength(0);
  });
});

describe("CMT-02: переписка, «решено», непрочитанные", () => {
  it("ответ дописывается в ветку, Resolve и Reopen меняют признак", async () => {
    const { board } = stickyBoard();
    createThread(
      board.comments,
      { object: null, x: 0, y: 0 },
      "#e53935",
      "Bob",
      "Why?",
    );
    renderScene(board);
    await userEvent.click(pins()[0] as HTMLElement);
    const reply = within(panel()).getByRole("textbox", { name: "Reply" });
    await userEvent.type(reply, "Because{Enter}");
    expect(threads(board)[0]?.messages.map((m) => m.text)).toEqual([
      "Why?",
      "Because",
    ]);
    expect(within(panel()).getByText("Because")).toBeTruthy();

    await userEvent.click(
      within(panel()).getByRole("button", { name: "Resolve" }),
    );
    expect(threads(board)[0]?.resolved).toBe(true);
    expect(pins()[0]?.getAttribute("data-resolved")).toBe("true");
    await userEvent.click(
      within(panel()).getByRole("button", { name: "Reopen" }),
    );
    expect(threads(board)[0]?.resolved).toBe(false);
  });

  it("сообщение другого участника отмечено непрочитанным, пока ветку не открыли", async () => {
    const [docA, docB] = linkedDocs();
    const alice = createBoardDocument(docA);
    const bob = createBoardDocument(docB);
    renderScene(bob, "Bob");
    const button = () =>
      within(screen.getByRole("toolbar", { name: "Tools" })).getByRole(
        "button",
        {
          name: /^Comments/,
        },
      );

    let thread = "";
    act(() => {
      thread = createThread(
        alice.comments,
        { object: null, x: 0, y: 0 },
        "#1e88e5",
        "Alice",
        "Hello Bob",
      ).thread;
    });
    expect(pins()[0]?.getAttribute("data-unread")).toBe("true");
    expect(button().getAttribute("aria-label")).toBe("Comments, 1 unread");

    await userEvent.click(pins()[0] as HTMLElement);
    expect(pins()[0]?.getAttribute("data-unread")).toBeNull();
    expect(button().getAttribute("aria-label")).toBe("Comments");

    // Пока ветка открыта, новые сообщения в ней сразу прочитаны.
    act(() => {
      addReply(alice.comments, thread, "Alice", "Are you there?");
    });
    expect(pins()[0]?.getAttribute("data-unread")).toBeNull();

    await userEvent.click(
      within(panel()).getByRole("button", { name: "Close" }),
    );
    act(() => {
      addReply(alice.comments, thread, "Alice", "Ping");
    });
    expect(pins()[0]?.getAttribute("data-unread")).toBe("true");
    await userEvent.click(button());
    const item = within(panel()).getByRole("button", { name: /Hello Bob/ });
    expect(item.getAttribute("data-unread")).toBe("true");
    expect(within(item).getByText("1 new")).toBeTruthy();
  });

  it("свои сообщения не считаются непрочитанными", async () => {
    const { board } = stickyBoard();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyO", key: "o" });
    click(canvas(), [0, 0]);
    await post("Mine");
    expect(pins()[0]?.getAttribute("data-unread")).toBeNull();
  });
});

describe("CMT-03: цвет комментария", () => {
  it("цвет выбирается для новой ветки и меняется у существующей", async () => {
    const { board } = stickyBoard();
    renderScene(board);
    fireEvent.keyDown(document.body, { code: "KeyO", key: "o" });
    click(canvas(), [0, 0]);
    await userEvent.click(
      within(panel()).getByRole("radio", { name: "Green" }),
    );
    await post("Green one");
    expect(threads(board)[0]?.color).toBe("#43a047");
    expect(pins()[0]?.style.getPropertyValue("--comment-color")).toBe(
      "#43a047",
    );

    await userEvent.click(
      within(panel()).getByRole("radio", { name: "Purple" }),
    );
    expect(threads(board)[0]?.color).toBe("#8e24aa");
    expect(
      within(panel())
        .getByRole("radio", { name: "Purple" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("CMT-04: фильтр по участникам обсуждения", () => {
  it("выбранный участник оставляет ветки, где он писал, — в списке и на холсте", async () => {
    const { board } = stickyBoard();
    const at = (x: number) => ({ object: null, x, y: 0 });
    const first = createThread(
      board.comments,
      at(0),
      "#000000",
      "Alice",
      "Alpha",
      new Date("2026-10-27T10:01:00Z"),
    );
    createThread(
      board.comments,
      at(50),
      "#000000",
      "Bob",
      "Beta",
      new Date("2026-10-27T10:02:00Z"),
    );
    addReply(board.comments, first.thread, "Guest", "Reply from guest");
    renderScene(board, "Alice");
    await userEvent.click(
      within(screen.getByRole("toolbar", { name: "Tools" })).getByRole(
        "button",
        {
          name: /^Comments/,
        },
      ),
    );
    const people = within(panel()).getByRole("group", {
      name: "Filter by people",
    });
    expect(
      within(people)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Alice", "Bob", "Guest"]);
    const list = () =>
      within(within(panel()).getByRole("list", { name: "Comment threads" }))
        .getAllByRole("listitem")
        .map((li) => li.querySelector(".comment-text")?.textContent);

    await userEvent.click(
      within(people).getByRole("button", { name: "Guest" }),
    );
    expect(list()).toEqual(["Alpha"]);
    expect(pins()).toHaveLength(1);

    await userEvent.click(within(people).getByRole("button", { name: "Bob" }));
    expect(list()).toEqual(["Alpha", "Beta"]);
    expect(pins()).toHaveLength(2);

    await userEvent.click(
      within(people).getByRole("button", { name: "Guest" }),
    );
    await userEvent.click(within(people).getByRole("button", { name: "Bob" }));
    expect(list()).toEqual(["Alpha", "Beta"]);
  });

  it("Hide resolved убирает решённые ветки", async () => {
    const { board } = stickyBoard();
    createThread(
      board.comments,
      { object: null, x: 0, y: 0 },
      "#000000",
      "Bob",
      "Done",
    );
    renderScene(board);
    await userEvent.click(pins()[0] as HTMLElement);
    await userEvent.click(
      within(panel()).getByRole("button", { name: "Resolve" }),
    );
    await userEvent.click(
      within(panel()).getByRole("button", { name: "All comments" }),
    );
    await userEvent.click(
      within(panel()).getByRole("switch", { name: "Hide resolved" }),
    );
    expect(pins()).toHaveLength(0);
    expect(
      within(panel()).getByText("No comments match the filter."),
    ).toBeTruthy();
  });
});
