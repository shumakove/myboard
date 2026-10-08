import { act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { LONG_PRESS_MS } from "../canvas/BoardCanvas";
import { HOME } from "../canvas/camera";
import { createBoardDocument } from "../realtime/boardDocument";
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CVS-09: создание объектов", () => {
  it("инструмент с панели и щелчок по холсту ставят объект; текст пишется в Y.Text", async () => {
    const user = userEvent.setup();
    const { board } = renderScene();
    await user.click(screen.getByRole("button", { name: "Sticky note" }));
    expect(screen.getByRole("button", { name: "Sticky note" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    click(canvas(), [130, 90]);

    const [sticky] = scene(board);
    // Центр — в точке щелчка, угол прилипает к сетке 20.
    expect(sticky).toMatchObject({ type: "sticky", x: 40, y: 0, width: 200 });
    // После установки инструмент снова Select, текст сразу редактируется.
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await user.type(screen.getByLabelText("Object text"), "Hello");
    const map = board.objects.get(sticky?.id ?? "") as Y.Map<unknown>;
    expect(map.get("text")).toBeInstanceOf(Y.Text);
    expect(String(map.get("text"))).toBe("Hello");
  });

  it("дрожание указателя при щелчке инструментом — всё ещё щелчок: открывается ввод текста", () => {
    const { board } = renderScene();
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    // Браузер шлёт pointermove и без сдвига; сдвиг в пределах допуска — не перетаскивание.
    drag(
      canvas(),
      [100, 100],
      [
        [100, 100],
        [101, 102],
      ],
    );
    expect(screen.getByLabelText("Object text")).toHaveFocus();
    expect(scene(board)).toEqual([expect.objectContaining({ type: "text" })]);
  });

  it("перетаскивание кнопки инструмента на холст ставит объект в точку отпускания", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "board-canvas"
          ? new DOMRect(0, 0, 800, 600)
          : new DOMRect(0, 0, 0, 0);
      },
    );
    const { board } = renderScene();
    const button = screen.getByRole("button", { name: "Shape" });
    fireEvent.pointerDown(button, {
      pointerId: 3,
      button: 0,
      clientX: 5,
      clientY: 5,
    });
    fireEvent.pointerMove(button, { pointerId: 3, clientX: 300, clientY: 300 });
    fireEvent.pointerUp(button, { pointerId: 3, clientX: 500, clientY: 400 });
    fireEvent.click(button);

    // Точка (500, 400) области 800×600 — точка доски (100, 100); фигура 200×120.
    expect(scene(board)).toEqual([
      expect.objectContaining({ type: "shape", x: 0, y: 40 }),
    ]);
    // Отпускание после перетаскивания не выбирает инструмент.
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("отпускание над панелью поверх холста (миникартой) объект не ставит", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "board-canvas"
          ? new DOMRect(0, 0, 400, 500)
          : new DOMRect(0, 0, 0, 0);
      },
    );
    const { board } = renderScene();
    const button = screen.getByRole("button", { name: "Shape" });
    // Панель поверх низа холста (y > 440), как миникарта.
    const overlay = document.createElement("div");
    document.body.append(overlay);
    const elementFromPoint = vi.fn((_x: number, y: number) =>
      y > 440 ? overlay : canvas(),
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: elementFromPoint,
    });
    try {
      const dragTo = (x: number, y: number) => {
        fireEvent.pointerDown(button, {
          pointerId: 3,
          button: 0,
          clientX: 20,
          clientY: 470,
        });
        fireEvent.pointerMove(button, { pointerId: 3, clientX: x, clientY: y });
        fireEvent.pointerUp(button, { pointerId: 3, clientX: x, clientY: y });
        fireEvent.click(button);
      };
      dragTo(120, 470);
      expect(scene(board)).toEqual([]);
      dragTo(200, 250);
      expect(scene(board)).toEqual([
        expect.objectContaining({ type: "shape" }),
      ]);
    } finally {
      Reflect.deleteProperty(document, "elementFromPoint");
      overlay.remove();
    }
  });

  it("вставка текста из буфера ставит текстовый объект", () => {
    const { board } = renderScene();
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: () => "Pasted note" },
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(scene(board)).toEqual([
      expect.objectContaining({ type: "text", text: "Pasted note" }),
    ]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("объект, созданный одним участником, появляется у другого", () => {
    const [docA, docB] = linkedDocs();
    const { board } = renderScene(createBoardDocument(docB));
    act(() => {
      createObject(
        createBoardDocument(docA).objects,
        "sticky",
        { x: 0, y: 0 },
        "Hi",
      );
    });
    const [only] = scene(board);
    expect(element(only?.id ?? "")).toHaveTextContent("Hi");
  });
});

describe("CVS-10: выделение", () => {
  it("щелчок выделяет; Shift+щелчок добавляет и убирает; щелчок по пустому снимает", () => {
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    renderScene(board);

    click(element(a), [50, 50]);
    expect([isSelected(a), isSelected(b)]).toEqual([true, false]);
    click(element(b), [250, 50], { shiftKey: true });
    expect([isSelected(a), isSelected(b)]).toEqual([true, true]);
    click(element(a), [50, 50], { shiftKey: true });
    expect([isSelected(a), isSelected(b)]).toEqual([false, true]);
    click(canvas(), [-300, -300]);
    expect(isSelected(b)).toBe(false);
  });

  it("Shift+перетаскивание по пустому месту — рамка: выделяет объекты внутри целиком", () => {
    const board = createBoardDocument();
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    drag(
      canvas(),
      [-10, -10],
      [
        [200, 100],
        [450, 250],
      ],
      { shiftKey: true },
    );
    expect([isSelected(a), isSelected(b), isSelected(c)]).toEqual([
      true,
      true,
      false,
    ]);
    expect(screen.queryByTestId("selection-marquee")).toBeNull();
  });

  it("перетаскивание по пустому месту без Shift двигает вид, а не выделяет", () => {
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    const { camera } = renderScene(board);
    drag(canvas(), [-10, -10], [[300, 300]]);
    expect(isSelected(a)).toBe(false);
    expect(camera()).toEqual({ x: -310, y: -310, zoom: 1 });
  });

  it("лассо выделяет объекты внутри области произвольной формы", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    renderScene(board);
    await user.click(screen.getByRole("button", { name: "Lasso" }));
    drag(
      canvas(),
      [-10, -10],
      [
        [210, -10],
        [215, 100],
        [210, 210],
        [-10, 210],
      ],
    );
    expect([isSelected(a), isSelected(b)]).toEqual([true, false]);
    expect(screen.getByRole("button", { name: "Select" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("CVS-11: фильтр смешанного выделения и массовые свойства", () => {
  it("смешанное выделение → только стикеры → цвет меняется у всех стикеров", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    drag(canvas(), [-10, -10], [[900, 300]], { shiftKey: true });

    const bar = screen.getByRole("toolbar", { name: "Selection" });
    expect(bar).toHaveTextContent("3 selected");
    await user.click(
      within(bar).getByRole("button", { name: "Only sticky notes (2)" }),
    );
    expect([isSelected(a), isSelected(b), isSelected(c)]).toEqual([
      true,
      true,
      false,
    ]);
    await user.selectOptions(within(bar).getByLabelText("Fill"), "Blue");

    expect(object(board, a).style.fill).toBe("#81d4fa");
    expect(object(board, b).style.fill).toBe("#81d4fa");
    expect(object(board, c).style.fill).toBe("#ffffff");
  });

  it("свойство, которого нет у одного из типов, при смешанном выделении не показывается", () => {
    const board = createBoardDocument();
    createObject(board.objects, "sticky", { x: 0, y: 0 });
    createObject(board.objects, "text", { x: 0, y: 300 });
    renderScene(board);
    drag(canvas(), [-10, -10], [[500, 500]], { shiftKey: true });
    const bar = screen.getByRole("toolbar", { name: "Selection" });
    expect(within(bar).queryByLabelText("Fill")).toBeNull();
    expect(
      within(bar).getByRole("button", { name: "Only texts (1)" }),
    ).toBeVisible();
  });
});

describe("CVS-12: перемещение", () => {
  it("объект двигается с прилипанием к сетке; Shift — по оси; Alt — без прилипания", () => {
    const [docA, docB] = linkedDocs();
    const board = createBoardDocument(docA);
    const { a } = threeObjects(board);
    renderScene(board);

    drag(
      element(a),
      [50, 50],
      [
        [70, 55],
        [93, 61],
      ],
    );
    expect(object(board, a)).toMatchObject({ x: 40, y: 20 });
    // Второй участник видит новое место.
    expect(object(createBoardDocument(docB), a)).toMatchObject({
      x: 40,
      y: 20,
    });

    drag(element(a), [90, 70], [[133, 81]], { shiftKey: true });
    expect(object(board, a)).toMatchObject({ x: 80, y: 20 });

    drag(element(a), [90, 70], [[103, 77]], { altKey: true });
    expect(object(board, a)).toMatchObject({ x: 93, y: 27 });
  });

  it("выделенные объекты двигаются вместе; без сетки — без прилипания к сетке", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    renderScene(board);
    await user.selectOptions(screen.getByLabelText("Grid"), "Off");
    click(element(a), [50, 50]);
    click(element(b), [250, 50], { shiftKey: true });
    // Сдвиг дальше расстояния прилипания к соседу C (CVS-16).
    drag(element(b), [250, 50], [[257, 63]]);
    expect(object(board, a)).toMatchObject({ x: 7, y: 13 });
    expect(object(board, b)).toMatchObject({ x: 227, y: 13 });
  });
});

describe("BUG-004: выделение не двигает объект и не пишет в документ", () => {
  /** Объект вне сетки и счётчик обновлений документа после его создания. */
  function offGridObject() {
    const board = createBoardDocument();
    const id = createObject(board.objects, "shape", { x: 77, y: 53 });
    const updates = { count: 0 };
    board.doc.on("update", () => {
      updates.count += 1;
    });
    renderScene(board);
    return { board, id, updates };
  }

  it("щелчок и дрожание в пределах щелчка выделяют, но не прилипляют к сетке", () => {
    const { board, id, updates } = offGridObject();
    click(element(id), [100, 80]);
    expect(isSelected(id)).toBe(true);
    click(canvas(), [-500, -500]);
    drag(element(id), [100, 80], [[102, 81]]);
    expect(isSelected(id)).toBe(true);
    expect(object(board, id)).toMatchObject({ x: 77, y: 53 });
    expect(updates.count).toBe(0);
  });

  it("долгое нажатие пальцем без движения выделяет, но не прилипляет к сетке", () => {
    vi.useFakeTimers();
    const { board, id, updates } = offGridObject();
    const touch = {
      pointerId: 1,
      pointerType: "touch",
      clientX: 100,
      clientY: 80,
    };
    fireEvent.pointerDown(element(id), { ...touch, button: 0 });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(canvas(), touch);
    expect(isSelected(id)).toBe(true);
    expect(object(board, id)).toMatchObject({ x: 77, y: 53 });
    expect(updates.count).toBe(0);
  });

  it("перетаскивание, вернувшее объект на место, не шлёт повторных одинаковых правок", () => {
    const { board, id, updates } = offGridObject();
    drag(
      element(id),
      [100, 80],
      [
        [130, 80],
        [131, 80],
        [100, 80],
      ],
      {
        altKey: true,
      },
    );
    expect(object(board, id)).toMatchObject({ x: 77, y: 53 });
    expect(updates.count).toBe(3);
  });
});

describe("CVS-13: автопрокрутка у края", () => {
  it("пока объект держат у края холста, вид едет туда, а объект — вместе с указателем", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 800, 600),
    );
    const board = createBoardDocument();
    const id = createObject(board.objects, "sticky", { x: -100, y: -100 });
    const { camera } = renderScene(board);

    // Экранная точка (400, 300) — центр вида, точка доски (0, 0).
    fireEvent.pointerDown(element(id), {
      pointerId: 1,
      button: 0,
      clientX: 400,
      clientY: 300,
      altKey: true,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 795,
      clientY: 300,
      altKey: true,
    });
    await vi.waitFor(() => {
      expect(camera().x).toBeGreaterThan(30);
    });
    fireEvent.pointerUp(canvas(), {
      pointerId: 1,
      clientX: 795,
      clientY: 300,
      altKey: true, // Alt держат до отпускания: конец жеста не прилипает к сетке
    });
    const settled = camera().x;
    // Объект под указателем: его сдвиг = сдвиг указателя на экране + сдвиг вида.
    expect(object(board, id).x).toBeGreaterThan(-100 + 395 + 30);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(camera().x).toBe(settled); // после отпускания вид стоит
  });
});

describe("CVS-14: размер и поворот", () => {
  it("угловой маркер меняет размер; маркер поворота — только у типов с поворотом", () => {
    const board = createBoardDocument();
    const { a, c } = threeObjects(board);
    renderScene(board);

    click(element(a), [50, 50]);
    expect(screen.queryByLabelText("Rotate")).toBeNull(); // стикер не поворачивается
    drag(handle("se"), [200, 200], [[260, 300]]);
    expect(object(board, a)).toMatchObject({
      x: 0,
      y: 0,
      width: 260,
      height: 300,
    });

    click(element(c), [650, 50]);
    // Фигура 600…800 × 0…120, центр (700, 60): маркер над центром → вправо от центра = 90°.
    drag(handle("rotate"), [700, -40], [[800, 60]]);
    expect(object(board, c).rotation).toBeCloseTo(90);
    expect(object(board, c)).toMatchObject({ x: 600, y: 0, width: 200 });
  });

  it("несколько объектов масштабируются вместе от противоположного угла", () => {
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    renderScene(board);
    drag(canvas(), [-10, -10], [[450, 250]], { shiftKey: true });
    // Общая рамка 0…420 × 0…200; угол se → (840, 400): масштаб ×2.
    drag(handle("se"), [420, 200], [[840, 400]]);
    expect(object(board, a)).toMatchObject({
      x: 0,
      y: 0,
      width: 400,
      height: 400,
    });
    expect(object(board, b)).toMatchObject({ x: 440, y: 0, width: 400 });
  });
});

describe("CVS-21: удаление", () => {
  it("Delete удаляет выделенное в корзину; в поле ввода — нет", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b, c } = threeObjects(board);
    renderScene(board);
    click(element(a), [50, 50]);
    click(element(b), [250, 50], { shiftKey: true });
    await user.keyboard("{Delete}");

    expect(scene(board).map((o) => o.id)).toEqual([c]);
    expect((board.trash.get(a) as Y.Map<unknown>).get("deletedBy")).toBe(
      "Alice",
    );
    expect(board.trash.has(b)).toBe(true);

    click(element(c), [650, 50]);
    screen.getByLabelText("Grid").focus();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Delete",
    });
    expect(board.objects.has(c)).toBe(true);
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(board.objects.size).toBe(0);
  });
});

describe("CVS-23: контекстное меню", () => {
  it("меню объекта выделяет его и удаляет", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    renderScene(board);
    fireEvent.contextMenu(element(b), { clientX: 250, clientY: 50 });
    expect(isSelected(b)).toBe(true);
    const menu = screen.getByRole("menu", { name: "Object menu" });
    expect(
      within(menu).getByRole("menuitem", { name: "Edit text" }),
    ).toBeVisible();
    await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(scene(board).map((o) => o.id)).toEqual([a, expect.any(String)]);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("меню пустого места ставит объект в эту точку и выделяет всё", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    threeObjects(board);
    renderScene(board);
    fireEvent.contextMenu(canvas(), { clientX: 1000, clientY: 500 });
    const menu = screen.getByRole("menu", { name: "Board menu" });
    await user.click(
      within(menu).getByRole("menuitem", { name: "Add sticky note here" }),
    );
    expect(scene(board).at(-1)).toMatchObject({
      type: "sticky",
      x: 900,
      y: 400,
    });

    fireEvent.contextMenu(canvas(), { clientX: 1000, clientY: 500 });
    await user.click(screen.getByRole("menuitem", { name: "Select all" }));
    expect(
      screen.getByRole("toolbar", { name: "Selection" }),
    ).toHaveTextContent("4 selected");
  });

  it("Escape закрывает меню", async () => {
    const user = userEvent.setup();
    renderScene();
    fireEvent.contextMenu(canvas(), { clientX: 0, clientY: 0 });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("MOB-03: долгое нажатие на телефоне", () => {
  const touch = { pointerType: "touch" };

  it("короткое движение пальцем по объекту двигает холст; касание выделяет", () => {
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    const { camera } = renderScene(board);
    drag(element(a), [50, 50], [[120, 90]], touch);
    expect(object(board, a)).toMatchObject({ x: 0, y: 0 });
    expect(isSelected(a)).toBe(false);
    expect(camera()).toEqual({ x: -70, y: -40, zoom: 1 });

    click(element(a), [50, 50], touch);
    expect(isSelected(a)).toBe(true);
    // Уже выделенный объект палец тянет сразу.
    drag(element(a), [50, 50], [[130, 50]], touch);
    expect(object(board, a)).toMatchObject({ x: 80, y: 0 });
  });

  it("долгое нажатие на объект выделяет его, дальше палец его тянет", () => {
    vi.useFakeTimers();
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    renderScene(board);
    fireEvent.pointerDown(element(a), {
      pointerId: 1,
      button: 0,
      clientX: 50,
      clientY: 50,
      ...touch,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    expect(isSelected(a)).toBe(true);
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 90,
      clientY: 50,
      ...touch,
    });
    fireEvent.pointerUp(canvas(), {
      pointerId: 1,
      clientX: 90,
      clientY: 50,
      ...touch,
    });
    expect(object(board, a)).toMatchObject({ x: 40, y: 0 });
  });

  it("долгое нажатие на пустом месте начинает рамку выделения", () => {
    vi.useFakeTimers();
    const board = createBoardDocument();
    const { a, b } = threeObjects(board);
    const { camera } = renderScene(board);
    fireEvent.pointerDown(canvas(), {
      pointerId: 1,
      button: 0,
      clientX: -10,
      clientY: -10,
      ...touch,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 210,
      clientY: 210,
      ...touch,
    });
    expect(screen.getByTestId("selection-marquee")).toBeInTheDocument();
    fireEvent.pointerUp(canvas(), {
      pointerId: 1,
      clientX: 210,
      clientY: 210,
      ...touch,
    });
    expect([isSelected(a), isSelected(b)]).toEqual([true, false]);
    expect(camera()).toEqual(HOME);
  });

  it("палец, сдвинутый до срока, долгим нажатием уже не считается", () => {
    vi.useFakeTimers();
    const board = createBoardDocument();
    const { a } = threeObjects(board);
    renderScene(board);
    fireEvent.pointerDown(element(a), {
      pointerId: 1,
      button: 0,
      clientX: 50,
      clientY: 50,
      ...touch,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: 80,
      clientY: 50,
      ...touch,
    });
    act(() => {
      vi.advanceTimersByTime(LONG_PRESS_MS);
    });
    fireEvent.pointerUp(canvas(), {
      pointerId: 1,
      clientX: 80,
      clientY: 50,
      ...touch,
    });
    expect(isSelected(a)).toBe(false);
  });
});

describe("CVS-06: фон и сетка", () => {
  it("фон и шаг сетки меняются у холста и попадают в документ", async () => {
    const user = userEvent.setup();
    const [docA, docB] = linkedDocs();
    renderScene(createBoardDocument(docA));
    await user.selectOptions(screen.getByLabelText("Background"), "Dark");
    await user.selectOptions(screen.getByLabelText("Grid"), "40 px");

    expect(canvas()).toHaveStyle({ backgroundColor: "#263238" });
    expect(canvas()).toHaveAttribute("data-grid-step", "40");
    expect(canvas().style.backgroundSize).toBe("40px 40px");
    expect(createBoardDocument(docB).settings.toJSON()).toEqual({
      background: "#263238",
      gridStep: 40,
    });

    await user.selectOptions(screen.getByLabelText("Grid"), "Off");
    expect(canvas().style.backgroundImage).toBe("none");
  });

  it("смена другим участником видна сразу", () => {
    const [docA, docB] = linkedDocs();
    renderScene(createBoardDocument(docA));
    act(() => {
      createBoardDocument(docB).settings.set("background", "#e3f2fd");
    });
    expect(canvas()).toHaveStyle({ backgroundColor: "#e3f2fd" });
    expect(screen.getByLabelText("Background")).toHaveValue("#e3f2fd");
  });
});

describe("COL-01: текст объекта правят двое", () => {
  it("чужая правка появляется в открытом поле, курсор остаётся на месте", async () => {
    const user = userEvent.setup();
    const [docA, docB] = linkedDocs();
    const board = createBoardDocument(docA);
    const id = createObject(board.objects, "sticky", { x: 0, y: 0 }, "world");
    renderScene(board);
    fireEvent.doubleClick(element(id), { clientX: 50, clientY: 50 });
    const field = screen.getByLabelText<HTMLTextAreaElement>("Object text");
    field.setSelectionRange(5, 5);
    await user.type(field, "!", {
      initialSelectionStart: 5,
      initialSelectionEnd: 5,
    });

    act(() => {
      const remote = createBoardDocument(docB).objects.get(
        id,
      ) as Y.Map<unknown>;
      (remote.get("text") as Y.Text).insert(0, "hello ");
    });
    expect(field.value).toBe("hello world!");
    expect(field.selectionStart).toBe(12);
    expect(object(createBoardDocument(docB), id).text).toBe("hello world!");
  });
});
