import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BoardPresence } from "../realtime/boardPresence";
import type {
  AwarenessState,
  CameraView,
  PresencePeer,
} from "../realtime/messages";
import { BoardWorkspace } from "./BoardWorkspace";

const ALICE = { peer: "p1", name: "Alice" };
const KATE = { peer: "p2", name: "Kate" };

/** Вкладка Alice; присутствие приходит «с сервера» через receive. */
function setup(peers: PresencePeer[] = [ALICE, KATE]) {
  const presence = new BoardPresence();
  const sent: AwarenessState[] = [];
  presence.attach((state) => sent.push(state));
  render(<BoardWorkspace presence={presence} />);
  act(() => {
    presence.receive({ type: "presence", self: "p1", peers });
  });
  const kateState = (state: Partial<AwarenessState>) => {
    act(() => {
      presence.receive({ type: "awareness", ...KATE, state });
    });
  };
  return { presence, sent, kateState };
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
