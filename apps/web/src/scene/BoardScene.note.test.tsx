import { act, fireEvent, screen, within } from "@testing-library/react";
import { renderHook } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { useBoardNote } from "../notes/useBoardNote";
import {
  ensureNoteText,
  isNoteOpenForAll,
  noteOps,
  setNoteOpenForAll,
} from "../notes/noteData";
import { createBoardDocument } from "../realtime/boardDocument";
import { Quill } from "../richtext/quill";
import "../richtext/testQuill";
import { createObject } from "./sceneObjects";
import { element, isSelected, renderScene } from "./testScene";

// T6.12: заметка доски (NTE-01…NTE-03) — через интерфейс сцены.

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

function notePanel() {
  return screen.getByRole("region", { name: "Board note" });
}

function noteField(): { field: HTMLElement; quill: Quill } {
  const field = within(notePanel()).getByRole("textbox", {
    name: "Object text",
  });
  const quill = Quill.find(field.parentElement as HTMLElement) as Quill;
  return { field, quill };
}

/** Набор «/» в позицию `at` и курсор после него — как ввод пользователя. */
function typeSlash(quill: Quill, at: number) {
  act(() => {
    quill.setSelection(at, 0, "user");
    quill.insertText(at, "/", "user");
    quill.setSelection(at + 1, 0, "user");
  });
}

describe("NTE-01: заметка доски отдельно от холста", () => {
  it("кнопка Note открывает панель заметки; правка пишется в notes, на холсте объектов нет", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    expect(screen.queryByRole("region", { name: "Board note" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Note" }));
    expect(notePanel()).toHaveTextContent("Empty note");
    await user.click(
      within(notePanel()).getByRole("button", { name: "Edit note" }),
    );
    const { quill } = noteField();
    act(() => {
      quill.insertText(0, "Agenda", "user");
    });
    expect(noteOps(board.notes)).toEqual([{ insert: "Agenda" }]);
    expect(board.objects.size).toBe(0);

    // Escape в редакторе завершает правку, панель остаётся и показывает текст.
    fireEvent.keyDown(noteField().field, { key: "Escape" });
    expect(within(notePanel()).queryByRole("textbox")).toBeNull();
    expect(notePanel()).toHaveTextContent("Agenda");
    // Escape в панели закрывает её.
    fireEvent.keyDown(notePanel(), { key: "Escape" });
    expect(screen.queryByRole("region", { name: "Board note" })).toBeNull();
  });

  it("меню «/» в заметке — блоки документа, включая разделитель и ссылку на объект", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Note" }));
    await user.click(
      within(notePanel()).getByRole("button", { name: "Edit note" }),
    );
    const { quill } = noteField();
    typeSlash(quill, 0);
    const menu = screen.getByRole("menu", { name: "Insert block" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Text",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bulleted list",
      "Numbered list",
      "To-do list",
      "Divider",
      "Link to object",
    ]);
    await user.click(within(menu).getByRole("menuitem", { name: "Heading 1" }));
    act(() => {
      quill.insertText(0, "Plan", "user");
    });
    expect(noteOps(board.notes)).toEqual([
      { insert: "Plan" },
      { insert: "\n", attributes: { header: 1 } },
    ]);
  });

  it("панели заметки, поиска и комментариев не открыты одновременно", async () => {
    const user = userEvent.setup();
    renderScene();
    await user.click(screen.getByRole("button", { name: "Note" }));
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.queryByRole("region", { name: "Board note" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Note" }));
    expect(screen.queryByRole("search", { name: "Search board" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Comments" }));
    expect(screen.queryByRole("region", { name: "Board note" })).toBeNull();
  });
});

describe("NTE-02: закреплённая заметка открыта у всех при входе", () => {
  it("переключатель Open for everyone пишет флаг в заметку доски", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Note" }));
    const toggle = within(notePanel()).getByRole("switch", {
      name: "Open for everyone",
    });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(isNoteOpenForAll(board.notes)).toBe(true);
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(isNoteOpenForAll(board.notes)).toBe(false);
  });

  it("вход на доску с закреплённой заметкой — панель открыта сразу", () => {
    const board = createBoardDocument();
    ensureNoteText(board.notes).insert(0, "Read me first");
    setNoteOpenForAll(board.notes, true);
    renderScene(board);
    expect(notePanel()).toHaveTextContent("Read me first");
  });

  it("незакреплённая заметка при входе не открывается", () => {
    const board = createBoardDocument();
    ensureNoteText(board.notes).insert(0, "Draft");
    renderScene(board);
    expect(screen.queryByRole("region", { name: "Board note" })).toBeNull();
  });

  it("панель открывается, когда документ сверен с сервером, и только при входе", () => {
    const board = createBoardDocument();
    const props = {
      notes: board.notes,
      loaded: false,
      objectLabel: () => null,
      onOpenObject: () => undefined,
      onPickObject: () => undefined,
    };
    const { result, rerender } = renderHook((p) => useBoardNote(p), {
      initialProps: props,
    });
    // До сверки флага в документе ещё нет — он приходит с сервера.
    setNoteOpenForAll(board.notes, true);
    expect(result.current.open).toBe(false);
    rerender({ ...props, loaded: true });
    expect(result.current.open).toBe(true);
    // Закрыл — больше сама не открывается.
    act(() => {
      result.current.close();
    });
    rerender({ ...props, loaded: true });
    expect(result.current.open).toBe(false);
  });
});

describe("NTE-03: ссылки на объекты в заметке", () => {
  it("щелчок по ссылке в заметке переводит вид к объекту и выделяет его", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const target = createObject(
      board.objects,
      "sticky",
      { x: 900, y: 900 },
      "Goal",
    );
    ensureNoteText(board.notes).applyDelta([
      { insert: "See " },
      { insert: { objectLink: target } },
      { insert: "\n" },
    ]);
    const { camera } = renderScene(board);
    await user.click(screen.getByRole("button", { name: "Note" }));
    await user.click(
      within(notePanel()).getByRole("button", { name: "Sticky note: Goal" }),
    );
    expect(isSelected(target)).toBe(true);
    // Стикер 200×200 в (900, 900): центр вида — в его середине.
    expect(camera()).toMatchObject({ x: 1000, y: 1000 });
    // Щелчок по ссылке не открывает правку заметки.
    expect(within(notePanel()).queryByRole("textbox")).toBeNull();
  });

  it("ссылка на удалённый объект недоступна", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    ensureNoteText(board.notes).applyDelta([
      { insert: { objectLink: "gone" } },
      { insert: "\n" },
    ]);
    renderScene(board);
    await user.click(screen.getByRole("button", { name: "Note" }));
    expect(
      within(notePanel()).getByRole("button", { name: "Missing object" }),
    ).toBeDisabled();
  });

  it("«/» → Link to object → выбор объекта вставляет ссылку с его id", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const target = createObject(
      board.objects,
      "sticky",
      { x: 0, y: 0 },
      "Goal",
    );
    renderScene(board);
    expect(element(target)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Note" }));
    await user.click(
      within(notePanel()).getByRole("button", { name: "Edit note" }),
    );
    typeSlash(noteField().quill, 0);
    await user.click(screen.getByRole("menuitem", { name: "Link to object" }));
    const dialog = screen.getByRole("dialog", {
      name: "Choose object to link",
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Sticky note: Goal" }),
    );
    expect(noteOps(board.notes)).toEqual([
      { insert: { objectLink: target } },
      { insert: " " },
    ]);
    // Правка продолжается в заметке.
    expect(noteField().field).toBeInTheDocument();
  });
});
