import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BoardCanvas } from "./BoardCanvas";

function touchMove(target: Element): Event {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

function renderCanvas() {
  render(
    <BoardCanvas
      camera={{ x: 0, y: 0, zoom: 1 }}
      wheelMode="zoom"
      onMove={() => undefined}
      onPointer={() => undefined}
    >
      <span data-testid="object">Object</span>
      <textarea data-canvas-ignore="" aria-label="Object text" />
    </BoardCanvas>,
  );
}

describe("MOB-02, BUG-020: пальцы на холсте ведёт сам холст", () => {
  it("движение пальца по холсту и объектам не уходит браузеру — нет своей прокрутки и инерции", () => {
    renderCanvas();
    expect(touchMove(screen.getByTestId("board-canvas")).defaultPrevented).toBe(
      true,
    );
    expect(touchMove(screen.getByTestId("object")).defaultPrevented).toBe(true);
  });

  it("в поле правки текста палец работает как обычно (прокрутка, выделение)", () => {
    renderCanvas();
    expect(
      touchMove(screen.getByRole("textbox", { name: "Object text" }))
        .defaultPrevented,
    ).toBe(false);
  });
});
