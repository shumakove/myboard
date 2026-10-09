import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { HOME } from "../canvas/camera";
import {
  createBoardDocument,
  type BoardDocument,
} from "../realtime/boardDocument";
import type { CameraView } from "../realtime/messages";
import { BoardScene } from "./BoardScene";
import type { ComponentProps } from "react";
import { BoardSettingsControls } from "./BoardSettingsControls";
import { createObject, readScene, type SceneObject } from "./sceneObjects";

/**
 * Помощники тестов сцены. jsdom не считает раскладку: область холста 0×0 в (0, 0),
 * центр вида — в (0, 0), масштаб 1. Поэтому координаты события — сразу координаты доски.
 */

export function renderScene(
  board: BoardDocument = createBoardDocument(),
  userName = "Alice",
  props: Pick<
    ComponentProps<typeof BoardScene>,
    "focusObject" | "boardLink"
  > = {},
) {
  const cameras: CameraView[] = [];
  function Harness() {
    const [camera, setCamera] = useState(HOME);
    cameras.push(camera);
    return (
      <>
        <BoardSettingsControls settings={board.settings} />
        <BoardScene
          board={board}
          camera={camera}
          wheelMode="zoom"
          userName={userName}
          onMove={setCamera}
          onPointer={() => undefined}
          onResize={() => undefined}
          {...props}
        />
      </>
    );
  }
  const { unmount } = render(<Harness />);
  return { board, camera: () => cameras.at(-1) ?? HOME, unmount };
}

export function canvas() {
  return screen.getByTestId("board-canvas");
}

export function element(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-object-id="${id}"]`);
  if (found === null) throw new Error(`нет объекта ${id}`);
  return found;
}

export function handle(name: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-handle="${name}"]`);
  if (found === null) throw new Error(`нет маркера ${name}`);
  return found;
}

export function scene(board: BoardDocument): SceneObject[] {
  return readScene(board.objects);
}

export function object(board: BoardDocument, id: string): SceneObject {
  const found = scene(board).find((o) => o.id === id);
  if (found === undefined) throw new Error(`нет объекта ${id}`);
  return found;
}

export function isSelected(id: string): boolean {
  return element(id).getAttribute("aria-selected") === "true";
}

export interface PointerOptions {
  pointerType?: string;
  shiftKey?: boolean;
  altKey?: boolean;
}

/** Нажатие на `target` в точке `from`, движение по точкам `path`, отпускание. */
export function drag(
  target: Element,
  from: [number, number],
  path: [number, number][],
  { pointerType = "mouse", ...keys }: PointerOptions = {},
) {
  const base = { pointerId: 1, pointerType, ...keys };
  fireEvent.pointerDown(target, {
    ...base,
    button: 0,
    clientX: from[0],
    clientY: from[1],
  });
  let last = from;
  for (const point of path) {
    fireEvent.pointerMove(canvas(), {
      ...base,
      clientX: point[0],
      clientY: point[1],
    });
    last = point;
  }
  fireEvent.pointerUp(canvas(), {
    ...base,
    button: 0,
    clientX: last[0],
    clientY: last[1],
  });
}

export function click(
  target: Element,
  at: [number, number],
  options?: PointerOptions,
) {
  drag(target, at, [], options);
}

/** Три объекта: стикеры A (0,0) и B (220,0), фигура C (600,0). */
export function threeObjects(board: BoardDocument) {
  const a = createObject(board.objects, "sticky", { x: 0, y: 0 });
  const b = createObject(board.objects, "sticky", { x: 220, y: 0 });
  const c = createObject(board.objects, "shape", { x: 600, y: 0 });
  return { a, b, c };
}
