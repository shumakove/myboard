import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardPresence } from "../realtime/boardPresence";
import type {
  AwarenessState,
  CameraView,
  PresencePeer,
} from "../realtime/messages";
import { BoardWorkspace } from "./BoardWorkspace";

const ALICE = { peer: "p1", name: "Alice" };
const KATE = { peer: "p2", name: "Kate" };

beforeEach(() => {
  localStorage.clear();
});

/** Вкладка Alice; присутствие приходит «с сервера» через receive. */
function setup(
  peers: PresencePeer[] = [ALICE, KATE],
  { boardId = "b1", objects = new Y.Doc().getMap<unknown>("objects") } = {},
) {
  const presence = new BoardPresence();
  const sent: AwarenessState[] = [];
  presence.attach((state) => sent.push(state));
  const view = render(
    <BoardWorkspace boardId={boardId} objects={objects} presence={presence} />,
  );
  act(() => {
    presence.receive({ type: "presence", self: "p1", peers });
  });
  const kateState = (state: Partial<AwarenessState>) => {
    act(() => {
      presence.receive({ type: "awareness", ...KATE, state });
    });
  };
  return { presence, sent, kateState, view };
}

function worldTransform(): string {
  const world = screen.getByTestId("board-canvas").firstElementChild;
  return (world as HTMLElement).style.transform;
}

function transformOf(view: CameraView): string {
  return `scale(${String(view.zoom)}) translate(${String(-view.x)}px, ${String(-view.y)}px)`;
}

describe("BoardWorkspace — присутствие на доске", () => {
  it("COL-09: показывает всех, кто на доске, и себя", () => {
    setup();
    const panel = screen.getByRole("complementary", {
      name: "People on this board",
    });
    expect(panel).toHaveTextContent("On this board (2)");
    expect(panel).toHaveTextContent("Alice (you)");
    expect(panel).toHaveTextContent("Kate");
  });

  it("COL-02: курсор и имя другого участника; ушедший пропадает", () => {
    const { presence, kateState } = setup();
    kateState({ cursor: { x: 120, y: -40 } });

    const cursor = screen.getByLabelText("Kate's cursor");
    expect(cursor).toHaveTextContent("Kate");
    expect(cursor).toHaveStyle({ left: "120px", top: "-40px" });
    expect(screen.queryByLabelText("Alice's cursor")).toBeNull();

    act(() => {
      presence.receive({ type: "presence", self: "p1", peers: [ALICE] });
    });
    expect(screen.queryByLabelText("Kate's cursor")).toBeNull();
    expect(screen.getByText("On this board (1)")).toBeInTheDocument();
  });

  it("COL-03: чужие курсоры скрываются и показываются снова", async () => {
    const user = userEvent.setup();
    const { kateState } = setup();
    kateState({ cursor: { x: 1, y: 1 } });

    await user.click(screen.getByRole("button", { name: "Hide cursors" }));
    expect(screen.queryByLabelText("Kate's cursor")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show cursors" }));
    expect(screen.getByLabelText("Kate's cursor")).toBeInTheDocument();
  });

  it("COL-04: вид повторяет камеру участника, пока слежение не выключено", async () => {
    const user = userEvent.setup();
    const { kateState, sent } = setup();
    const first = { x: 100, y: 10, zoom: 2 };
    kateState({ camera: first });

    await user.click(screen.getByRole("button", { name: "Follow Kate" }));
    expect(worldTransform()).toBe(transformOf(first));
    expect(screen.getByText("Following Kate")).toBeInTheDocument();
    // Своё состояние уходит с задержкой не больше интервала присутствия.
    await vi.waitFor(() => {
      expect(sent.at(-1)?.following).toBe("p2");
    });

    const moved = { x: -300, y: 50, zoom: 0.5 };
    kateState({ camera: moved });
    expect(worldTransform()).toBe(transformOf(moved));

    await user.click(screen.getByRole("button", { name: "Stop following" }));
    kateState({ camera: { x: 0, y: 0, zoom: 1 } });
    // Вид остаётся там, где был, и больше не следует.
    expect(worldTransform()).toBe(transformOf(moved));
    expect(screen.getByRole("button", { name: "Follow Kate" })).toBeEnabled();
  });

  it("COL-04: своё перемещение вида или уход участника прекращают слежение", async () => {
    const user = userEvent.setup();
    const { presence, kateState } = setup();
    kateState({ camera: { x: 100, y: 0, zoom: 1 } });

    await user.click(screen.getByRole("button", { name: "Follow Kate" }));
    const canvas = screen.getByTestId("board-canvas");
    fireEvent.pointerDown(canvas, {
      pointerId: 1,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 30, clientY: 10 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(screen.queryByText("Following Kate")).toBeNull();
    expect(worldTransform()).toBe(transformOf({ x: 80, y: 0, zoom: 1 }));

    await user.click(screen.getByRole("button", { name: "Follow Kate" }));
    act(() => {
      presence.receive({ type: "presence", self: "p1", peers: [ALICE] });
    });
    expect(screen.queryByText("Following Kate")).toBeNull();
  });

  it("COL-02: свой курсор уходит остальным в координатах доски", async () => {
    const { sent } = setup();
    const canvas = screen.getByTestId("board-canvas");
    // jsdom не считает раскладку: область 0×0 с началом в (0, 0) — центр вида в (0, 0).
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 25, clientY: -5 });
    await vi.waitFor(() => {
      expect(sent.at(-1)?.cursor).toEqual({ x: 25, y: -5 });
    });

    fireEvent.pointerLeave(canvas, { pointerId: 1, pointerType: "mouse" });
    await vi.waitFor(() => {
      expect(sent.at(-1)?.cursor).toBeNull();
    });
  });
});

// jsdom не считает раскладку: область холста 0×0 с началом в (0, 0), центр вида — в (0, 0).
// Поэтому экранная точка события равна смещению от центра вида.
describe("BoardWorkspace — камера", () => {
  function canvas() {
    return screen.getByTestId("board-canvas");
  }

  function touch(
    type: "pointerDown" | "pointerMove" | "pointerUp",
    pointerId: number,
    x: number,
    y: number,
  ) {
    fireEvent[type](canvas(), {
      pointerId,
      pointerType: "touch",
      button: type === "pointerMove" ? -1 : 0,
      clientX: x,
      clientY: y,
    });
  }

  it("CVS-02: кнопки масштаба приближают и отдаляют вид", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("100%");

    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");
    expect(worldTransform()).toBe(transformOf({ x: 0, y: 0, zoom: 1.25 }));

    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("80%");
  });

  it("CVS-02: «+»/«−» и стрелки управляют видом; в поле ввода — нет", async () => {
    const user = userEvent.setup();
    setup();
    await user.keyboard("+");
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("125%");
    await user.keyboard("-");
    await user.keyboard("{ArrowRight}{ArrowDown}");
    expect(worldTransform()).toBe(transformOf({ x: 100, y: 100, zoom: 1 }));

    screen.getByRole("combobox", { name: "Mouse wheel" }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "ArrowLeft",
    });
    expect(worldTransform()).toBe(transformOf({ x: 100, y: 100, zoom: 1 }));
  });

  it("CVS-02: перетаскивание мышью сдвигает вид", () => {
    setup();
    fireEvent.pointerDown(canvas(), {
      pointerId: 1,
      button: 0,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(canvas(), {
      pointerId: 1,
      clientX: -40,
      clientY: 25,
    });
    fireEvent.pointerUp(canvas(), { pointerId: 1 });
    expect(worldTransform()).toBe(transformOf({ x: 40, y: -25, zoom: 1 }));
  });

  it("CVS-03: колесо масштабирует; в режиме прокрутки двигает, с Ctrl — масштабирует", async () => {
    const user = userEvent.setup();
    setup();
    fireEvent.wheel(canvas(), { deltaY: -100 });
    expect(screen.getByLabelText("Zoom level")).not.toHaveTextContent("100%");
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    const zoomed = worldTransform();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Mouse wheel" }),
      "scroll",
    );
    fireEvent.wheel(canvas(), { deltaX: 0, deltaY: 50 });
    expect(worldTransform()).not.toBe(zoomed);
    const level = screen.getByLabelText("Zoom level").textContent;
    fireEvent.wheel(canvas(), { deltaY: 50 }); // прокрутка масштаб не меняет
    expect(screen.getByLabelText("Zoom level").textContent).toBe(level);
    fireEvent.wheel(canvas(), { deltaY: 200, ctrlKey: true });
    expect(screen.getByLabelText("Zoom level").textContent).not.toBe(level);
    // Выбор режима помнит браузер.
    expect(localStorage.getItem("myboard.wheelMode")).toBe("scroll");
  });

  it("CVS-04: щелчок по миникарте переносит вид к выбранному месту", () => {
    const objects = new Y.Doc().getMap<unknown>("objects");
    objects.set("far", {
      type: "sticky",
      x: 1000,
      y: 500,
      width: 200,
      height: 100,
    });
    setup([ALICE], { objects });
    const minimap = screen.getByRole("img", { name: "Minimap" });
    expect(minimap.querySelectorAll(".minimap-object")).toHaveLength(1);

    // Мир миникарты: x от −120 до 1320, y от −120 до 720 → масштаб 1/9, сдвиг (13⅓, 21⅔).
    // Центр объекта (1100, 550) на миникарте — (135,(5), 82,(7)).
    fireEvent.pointerDown(minimap, {
      pointerId: 7,
      button: 0,
      clientX: 1100 / 9 + 40 / 3,
      clientY: 550 / 9 + 65 / 3,
    });
    fireEvent.pointerUp(minimap, { pointerId: 7 });
    const [x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/
      .exec(worldTransform())
      ?.slice(1)
      .map(Number) ?? [NaN, NaN];
    expect(x).toBeCloseTo(-1100);
    expect(y).toBeCloseTo(-550);
  });

  it("CVS-05: вид доски восстанавливается при новом открытии, у другой доски — свой", async () => {
    const user = userEvent.setup();
    const first = setup([ALICE]);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    await user.keyboard("{ArrowRight}");
    const remembered = worldTransform();
    first.view.unmount();

    const again = setup([ALICE]);
    expect(worldTransform()).toBe(remembered);
    again.view.unmount();

    setup([ALICE], { boardId: "b2" });
    expect(worldTransform()).toBe(transformOf({ x: 0, y: 0, zoom: 1 }));
  });

  it("MOB-02: один палец двигает вид, два пальца — щипок", () => {
    setup([ALICE]);
    touch("pointerDown", 1, 0, 0);
    touch("pointerMove", 1, 30, -20);
    expect(worldTransform()).toBe(transformOf({ x: -30, y: 20, zoom: 1 }));

    touch("pointerDown", 2, 130, -20);
    // Пальцы расходятся вдвое, середина на месте.
    touch("pointerMove", 1, -20, -20);
    touch("pointerMove", 2, 180, -20);
    expect(screen.getByLabelText("Zoom level")).toHaveTextContent("200%");

    // Второй палец поднят — первый продолжает сдвиг без скачка.
    touch("pointerUp", 2, 180, -20);
    const afterPinch = worldTransform();
    touch("pointerMove", 1, -20, -20);
    expect(worldTransform()).toBe(afterPinch);
    touch("pointerMove", 1, 0, -20);
    expect(worldTransform()).not.toBe(afterPinch);
    touch("pointerUp", 1, 0, -20);
  });

  it("COL-04 на телефоне: щипок прекращает слежение, а свой вид уходит наблюдателям", async () => {
    const user = userEvent.setup();
    const { kateState, sent } = setup();
    kateState({ camera: { x: 500, y: 0, zoom: 1 } });
    await user.click(screen.getByRole("button", { name: "Follow Kate" }));

    touch("pointerDown", 1, -50, 0);
    touch("pointerDown", 2, 50, 0);
    touch("pointerMove", 1, -100, 0);
    touch("pointerMove", 2, 100, 0);
    expect(screen.queryByText("Following Kate")).toBeNull();
    await vi.waitFor(() => {
      expect(sent.at(-1)?.camera?.zoom).toBe(2);
    });
    expect(sent.at(-1)?.camera?.x).toBeCloseTo(500);
    expect(sent.at(-1)?.following).toBeNull();
    // Во время щипка курсор не прыгает между пальцами.
    expect(sent.every((state) => state.cursor === null)).toBe(true);

    // Слежение не мешает Kate видеть курсоры и присутствие.
    kateState({ cursor: { x: 1, y: 2 } });
    expect(screen.getByLabelText("Kate's cursor")).toBeInTheDocument();
  });
});
