import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  createBoardDocument,
  type BoardDocument,
} from "../realtime/boardDocument";
import { CLIPBOARD_MIME } from "./clipboard";
import { createObject } from "./sceneObjects";
import { linkedDocs } from "./testDocs";
import {
  canvas,
  click,
  drag,
  element,
  handle,
  isSelected,
  object,
  renderScene,
  scene,
  threeObjects,
} from "./testScene";

// Операции над объектами (T5.3): CVS-15…CVS-20, CVS-22 — через интерфейс сцены.

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function bar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

async function barButton(user: UserEvent, name: string) {
  await user.click(within(bar()).getByRole("button", { name }));
}

async function menuItem(user: UserEvent, menu: string, name: string) {
  await user.click(
    within(screen.getByRole("menu", { name: menu })).getByRole("menuitem", {
      name,
    }),
  );
}

/** Выделяет объекты щелчком и Shift+щелчком (в точке, лежащей на объекте). */
function selectObjects(...targets: [string, [number, number]][]) {
  targets.forEach(([id, at], i) => {
    click(element(id), at, { shiftKey: i > 0 });
  });
}

/** Событие буфера обмена с данными, как от браузера. */
function clipboardEvent(
  type: "copy" | "cut" | "paste",
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
  return { event, store };
}

describe("CVS-15: выравнивание и распределение", () => {
  it("Distribute horizontally даёт равные промежутки; Align top — общий верх", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const a = createObject(board.objects, "sticky", { x: 0, y: 0 });
    const b = createObject(board.objects, "shape", { x: 260, y: 40 });
    const c = createObject(board.objects, "sticky", { x: 900, y: 80 });
    renderScene(board);
    selectObjects([a, [50, 50]], [b, [300, 60]], [c, [950, 120]]);

    await barButton(user, "Arrange");
    await menuItem(user, "Arrange menu", "Distribute horizontally");
    const [oa, ob, oc] = [object(board, a), object(board, b), object(board, c)];
    expect(ob.x - (oa.x + oa.width)).toBeCloseTo(oc.x - (ob.x + ob.width));
    expect(oa.x).toBe(0);
    expect(oc.x).toBe(900);

    await barButton(user, "Arrange");
    await menuItem(user, "Arrange menu", "Align top");
    expect([a, b, c].map((id) => object(board, id).y)).toEqual([0, 0, 0]);
  });

  it("жест за маркер промежутка рамки выделения ставит объекты с равным шагом", () => {
    const board = createBoardDocument();
    const a = createObject(board.objects, "sticky", { x: 0, y: 0 });
    const b = createObject(board.objects, "sticky", { x: 230, y: 0 });
    const c = createObject(board.objects, "sticky", { x: 700, y: 0 });
    renderScene(board);
    selectObjects([a, [50, 50]], [b, [250, 50]], [c, [750, 50]]);
    // Рамка 0…900; тянем маркер на 60 влево: длина 840, три объекта по 200 → шаг 120.
    drag(
      handle("spacing-x"),
      [900, 100],
      [
        [870, 100],
        [840, 100],
      ],
    );
    expect([a, b, c].map((id) => object(board, id).x)).toEqual([0, 320, 640]);
  });

  it("выравнивание недоступно для одного объекта", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    renderScene(board);
    click(element(a), [50, 50]);
    await barButton(user, "Arrange");
    const menu = screen.getByRole("menu", { name: "Arrange menu" });
    expect(
      within(menu).queryByRole("menuitem", { name: "Align left" }),
    ).toBeNull();
    expect(
      within(menu).getByRole("menuitem", { name: "Bring to front" }),
    ).toBeVisible();
  });
});

describe("CVS-16: направляющие", () => {
  it("рядом с краем соседа объект прилипает и видна направляющая; после отпускания её нет", () => {
    const board = createBoardDocument();
    const { a } = threeObjects(board); // A (0,0) 200×200, B (220,0), C (600,0) 200×120
    renderScene(board);
    click(element(a), [50, 50]);
    fireEvent.pointerDown(element(a), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 50,
      clientY: 50,
    });
    // Низ A 200+…: сдвиг на (3, −76) — низ 124 рядом с низом C (120).
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 53,
      clientY: -26,
    });
    const guides = screen.getAllByTestId("alignment-guide");
    expect(guides.map((g) => g.dataset.axis)).toContain("y");
    expect(guides.find((g) => g.dataset.axis === "y")?.dataset.value).toBe(
      "120",
    );
    fireEvent.pointerUp(canvas(), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 53,
      clientY: -26,
    });
    expect(object(board, a).y).toBe(-80);
    expect(screen.queryAllByTestId("alignment-guide")).toHaveLength(0);
  });

  it("с Alt направляющих и прилипания нет", () => {
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    renderScene(board);
    click(element(a), [50, 50]);
    drag(element(a), [50, 50], [[53, -26]], { altKey: true });
    expect(object(board, a)).toMatchObject({ x: 3, y: -76 });
  });
});

describe("CVS-17, CVS-18: группы и порядок слоёв", () => {
  async function groupAB(user: UserEvent, board: BoardDocument) {
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    selectObjects([a, [50, 50]], [b, [250, 50]]);
    await barButton(user, "Group");
    const group = scene(board).find((o) => o.type === "group");
    if (group === undefined) throw new Error("группы нет");
    return { a, b, c, group: group.id };
  }

  it("Group объединяет выделенное: щелчок по объекту выделяет группу, двойной — объект", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, group } = await groupAB(user, board);
    expect(bar()).toHaveTextContent("1 selected");
    expect(object(board, a).parent).toBe(group);

    click(canvas(), [500, 500]);
    click(element(a), [50, 50]);
    expect(isSelected(group)).toBe(true);
    expect(isSelected(a)).toBe(false);

    // Перетаскивание объекта группы двигает всю группу.
    drag(element(a), [50, 50], [[150, 50]]);
    expect(object(board, a).x).toBe(100);
    expect(object(board, b).x).toBe(320);

    fireEvent.doubleClick(element(b), { clientX: 400, clientY: 50 });
    expect(isSelected(b)).toBe(true);
    expect(isSelected(group)).toBe(false);

    selectObjects([b, [400, 50]]);
    await barButton(user, "More");
    await menuItem(user, "Object menu", "Bring to front");
    expect(object(board, b).parent).toBe(group);

    click(element(a), [150, 50]); // внутри группы: щелчок по соседу выделяет его
    expect(isSelected(a)).toBe(true);
  });

  it("порядок слоёв внутри группы и у группы целиком", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, c, group } = await groupAB(user, board);
    const order = () => scene(board).map((o) => o.id);
    expect(order()).toEqual([group, a, b, c]);

    // Объект внутри группы — на передний план среди объектов группы.
    fireEvent.doubleClick(element(a), { clientX: 50, clientY: 50 });
    expect(isSelected(a)).toBe(true);
    await barButton(user, "Arrange");
    await menuItem(user, "Arrange menu", "Bring to front");
    expect(order()).toEqual([group, b, a, c]);

    // Группа — на передний план доски, поверх C.
    click(canvas(), [500, 500]);
    click(element(a), [50, 50]);
    expect(isSelected(group)).toBe(true);
    await barButton(user, "Arrange");
    await menuItem(user, "Arrange menu", "Bring to front");
    expect(order()).toEqual([c, group, b, a]);

    // Группа на один слой назад — снова под C.
    await barButton(user, "Arrange");
    await menuItem(user, "Arrange menu", "Send backward");
    expect(order()).toEqual([group, b, a, c]);
  });

  it("Ungroup возвращает объекты на место и выделяет их", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, group } = await groupAB(user, board);
    await barButton(user, "Ungroup");
    expect(board.objects.has(group)).toBe(false);
    expect(object(board, a)).toMatchObject({ x: 0, y: 0, parent: null });
    expect(object(board, b)).toMatchObject({ x: 220, y: 0, parent: null });
    expect(bar()).toHaveTextContent("2 selected");
  });

  it("CVS-18: Send to back, Bring forward у объектов верхнего уровня", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    const order = () => scene(board).map((o) => o.id);

    fireEvent.contextMenu(element(c), { clientX: 650, clientY: 50 });
    await menuItem(user, "Object menu", "Send to back");
    expect(order()).toEqual([c, a, b]);

    fireEvent.contextMenu(element(c), { clientX: 650, clientY: 50 });
    await menuItem(user, "Object menu", "Bring forward");
    expect(order()).toEqual([a, c, b]);
  });
});

describe("CVS-19: блокировка", () => {
  it("заблокированный объект не двигается, не меняет размер и не удаляется", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    renderScene(board);
    click(element(a), [50, 50]);
    await barButton(user, "Lock");
    expect(element(a)).toHaveAttribute("data-locked", "true");
    expect(document.querySelector("[data-handle]")).toBeNull();

    drag(element(a), [50, 50], [[150, 150]]);
    expect(object(board, a)).toMatchObject({ x: 0, y: 0 });
    await user.keyboard("{Delete}");
    expect(board.objects.has(a)).toBe(true);
    expect(within(bar()).queryByRole("button", { name: "Delete" })).toBeNull();

    // Двойной щелчок не открывает ввод текста.
    fireEvent.doubleClick(element(a), { clientX: 50, clientY: 50 });
    expect(screen.queryByLabelText("Object text")).toBeNull();

    await barButton(user, "Unlock");
    drag(element(a), [50, 50], [[150, 150]]);
    expect(object(board, a)).toMatchObject({ x: 100, y: 100 });
  });

  it("Unlock all снимает блокировку со всех объектов, у второго участника тоже", async () => {
    const user = userEvent.setup();
    const [docA, docB] = linkedDocs();
    const board = createBoardDocument(docA);
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    selectObjects([a, [50, 50]], [c, [650, 50]]);
    await barButton(user, "Lock");
    click(element(b), [250, 50]);
    await barButton(user, "Lock");
    const other = createBoardDocument(docB);
    expect(scene(other).filter((o) => o.locked)).toHaveLength(3);

    fireEvent.contextMenu(canvas(), { clientX: 1000, clientY: 500 });
    await menuItem(user, "Board menu", "Unlock all");
    expect(scene(other).some((o) => o.locked)).toBe(false);
    expect(screen.getByRole("button", { name: "Unlock all" })).toBeDisabled();
  });
});

describe("CVS-20: копирование, вырезание, дублирование, вставка", () => {
  it("Ctrl+C и Ctrl+V через системный буфер: копия на этой доске под указателем", () => {
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    (board.objects.get(a) as Y.Map<unknown>).set("fill", "#81d4fa");
    renderScene(board);
    click(element(a), [50, 50]);
    const { event, store } = clipboardEvent("copy");
    expect(event.defaultPrevented).toBe(true);
    expect(store[CLIPBOARD_MIME]).toContain('"myboard/objects"');

    fireEvent.pointerMove(canvas(), { clientX: 1000, clientY: 1000 });
    clipboardEvent("paste", store);
    const pasted = scene(board).at(-1);
    expect(pasted).toMatchObject({
      type: "sticky",
      x: 900,
      y: 900,
      style: { fill: "#81d4fa" },
    });
    expect(pasted?.id).not.toBe(a);
    expect(isSelected(pasted?.id ?? "")).toBe(true);
  });

  it("вставка на другую доску того же пользователя сохраняет объекты", async () => {
    const user = userEvent.setup();
    const first = createBoardDocument();
    const id = createObject(first.objects, "sticky", { x: 0, y: 0 }, "Copied");
    const { unmount } = renderScene(first);
    click(element(id), [50, 50]);
    // Сочетание без события буфера (как из средства автоматизации) — копия в браузере.
    await user.keyboard("{Control>}c{/Control}");
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    unmount();

    const second = createBoardDocument();
    renderScene(second, "Alice");
    await user.keyboard("{Control>}v{/Control}");
    await act(() => new Promise((resolve) => setTimeout(resolve, 5)));
    expect(scene(second)).toEqual([
      expect.objectContaining({ type: "sticky", text: "Copied" }),
    ]);
  });

  it("Cut переносит объект в корзину; Paste из панели возвращает копию", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    click(element(a), [50, 50]);
    await barButton(user, "More");
    await menuItem(user, "Object menu", "Cut");
    expect(board.objects.has(a)).toBe(false);
    expect(board.trash.get(a)).toBeInstanceOf(Y.Map);
    expect((board.trash.get(a) as Y.Map<unknown>).get("deletedBy")).toBe(
      "Alice",
    );

    await user.click(screen.getByRole("button", { name: "Paste" }));
    expect(scene(board)).toHaveLength(3);
    expect(scene(board).map((o) => o.id)).toEqual(
      expect.arrayContaining([b, c]),
    );
  });

  it("Ctrl+D дублирует выделенное со сдвигом", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    renderScene(board);
    selectObjects([a, [50, 50]], [b, [250, 50]]);
    await user.keyboard("{Control>}d{/Control}");
    const copies = scene(board).slice(-2);
    expect(copies.map((o) => [o.type, o.x, o.y])).toEqual([
      ["sticky", 20, 20],
      ["sticky", 240, 20],
    ]);
    expect(bar()).toHaveTextContent("2 selected");
    expect(copies.every((o) => isSelected(o.id))).toBe(true);
  });
});

describe("CVS-22: автор и даты", () => {
  it("панель выделения показывает автора, создание и последнее изменение другим участником", () => {
    vi.useFakeTimers({
      now: new Date("2026-10-08T09:15:00Z"),
      toFake: ["Date"],
    });
    const [docA, docB] = linkedDocs();
    const board = createBoardDocument(docA);
    const id = createObject(
      board.objects,
      "sticky",
      { x: 0, y: 0 },
      "",
      "Alice",
    );
    renderScene(createBoardDocument(docB), "Kate (guest)");
    click(element(id), [50, 50]);
    const info = screen.getByLabelText("Object info");
    expect(within(info).getByTestId("object-created")).toHaveTextContent(
      "Alice",
    );
    expect(
      within(info).getByTestId("object-created").querySelector("time"),
    ).toHaveAttribute("datetime", "2026-10-08T09:15:00.000Z");

    vi.setSystemTime(new Date("2026-10-08T09:45:00Z"));
    drag(element(id), [50, 50], [[150, 50]]);
    const modified = within(screen.getByLabelText("Object info")).getByTestId(
      "object-modified",
    );
    expect(modified).toHaveTextContent("Kate (guest)");
    expect(modified.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-10-08T09:45:00.000Z",
    );
    // Автор у всех участников один и тот же — он в документе.
    expect(object(board, id).meta.updatedBy).toBe("Kate (guest)");
    expect(object(board, id).meta.createdBy).toBe("Alice");
  });

  it("правка текста отмечает изменившего", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const id = createObject(
      board.objects,
      "shape",
      { x: 0, y: 0 },
      "",
      "Alice",
    );
    renderScene(board, "Bob");
    fireEvent.doubleClick(element(id), { clientX: 50, clientY: 50 });
    await user.type(screen.getByLabelText("Object text"), "Hi");
    expect(object(board, id)).toMatchObject({
      text: "Hi",
      meta: { createdBy: "Alice", updatedBy: "Bob" },
    });
  });

  it("новый объект — автор тот, кто его поставил", async () => {
    const user = userEvent.setup();
    const { board } = renderScene(createBoardDocument(), "Kate");
    await user.click(screen.getByRole("button", { name: "Shape" }));
    click(canvas(), [300, 300]);
    expect(scene(board)[0]?.meta).toMatchObject({
      createdBy: "Kate",
      updatedBy: "Kate",
    });
  });
});
