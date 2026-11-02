import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { MediaPlayer } from "./MediaPlayer";

const SRC = "/api/media/0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f";

// jsdom не воспроизводит: play и pause только меняют состояние и шлют события.
let play: MockInstance;
let pause: MockInstance;

beforeEach(() => {
  let paused = true;
  vi.spyOn(HTMLMediaElement.prototype, "paused", "get").mockImplementation(
    () => paused,
  );
  play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockImplementation(function (this: HTMLMediaElement) {
      paused = false;
      this.dispatchEvent(new Event("play"));
      return Promise.resolve();
    });
  pause = vi
    .spyOn(HTMLMediaElement.prototype, "pause")
    .mockImplementation(function (this: HTMLMediaElement) {
      paused = true;
      this.dispatchEvent(new Event("pause"));
    });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function player(kind: "video" | "audio") {
  const { container } = render(<MediaPlayer kind={kind} src={SRC} />);
  const media = container.querySelector<HTMLMediaElement>(kind);
  if (media === null) throw new Error(kind);
  Object.defineProperty(media, "duration", { value: 125, configurable: true });
  fireEvent.durationChange(media);
  return { media, container };
}

describe.each(["video", "audio"] as const)("%s: FIL-03, FIL-04", (kind) => {
  it("Play запускает ролик, Pause ставит на паузу", async () => {
    const user = userEvent.setup();
    const { media, container } = player(kind);
    expect(media.getAttribute("src")).toBe(SRC);

    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(".media-player")?.getAttribute("data-playing"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Pause" }));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("перемотка меняет позицию ролика и показанное время", () => {
    const { media } = player(kind);
    expect(screen.getByText("0:00 / 2:05")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Seek" }), {
      target: { value: "65" },
    });
    expect(media.currentTime).toBe(65);
    expect(screen.getByText("1:05 / 2:05")).toBeInTheDocument();
  });

  it("файл не воспроизводится — сообщение вместо панели", () => {
    const { media } = player(kind);
    fireEvent.error(media);
    expect(screen.getByText(/can't be played/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  });

  it("панель сама обрабатывает нажатия: холст их не получает", () => {
    const { container } = player(kind);
    expect(
      container
        .querySelector(".media-controls")
        ?.hasAttribute("data-canvas-ignore"),
    ).toBe(true);
  });
});

describe("video: FIL-03", () => {
  it("громкость меняется", () => {
    const { media } = player("video");
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
      target: { value: "0.25" },
    });
    expect(media.volume).toBe(0.25);
  });

  it("скорость меняется", async () => {
    const user = userEvent.setup();
    const { media } = player("video");
    await user.selectOptions(screen.getByLabelText("Speed"), "1.5");
    expect(media.playbackRate).toBe(1.5);
  });

  it("Full screen разворачивает плеер, Exit full screen сворачивает", async () => {
    const user = userEvent.setup();
    const { container } = player("video");
    const root = container.querySelector<HTMLElement>(".media-player");
    if (root === null) throw new Error("player");
    let current: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      get: () => current,
      configurable: true,
    });
    const enter = vi.fn(() => {
      current = root;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      current = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    root.requestFullscreen = enter;
    document.exitFullscreen = exit;

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(enter).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(exit).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Full screen" }),
    ).toBeInTheDocument();
    Reflect.deleteProperty(document, "fullscreenElement");
  });

  it("телефон без полного экрана элемента: полный экран у самого видео", async () => {
    const user = userEvent.setup();
    const { media, container } = player("video");
    const root = container.querySelector<HTMLElement>(".media-player");
    Object.defineProperty(root, "requestFullscreen", { value: undefined });
    const enter = vi.fn();
    Object.defineProperty(media, "webkitEnterFullscreen", { value: enter });

    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(enter).toHaveBeenCalled();
  });
});

describe("audio: FIL-04", () => {
  it("только пауза и перемотка", () => {
    player("audio");
    expect(screen.queryByRole("slider", { name: "Volume" })).toBeNull();
    expect(screen.queryByLabelText("Speed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
  });
});

describe("нет адреса файла", () => {
  it("чужой адрес в документе: плеера нет", () => {
    render(<MediaPlayer kind="video" src={null} />);
    expect(screen.getByText("Video can't be played")).toBeInTheDocument();
  });
});
