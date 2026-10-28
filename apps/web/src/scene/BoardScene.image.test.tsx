import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import { createImage } from "./images";
import { MANY_OBJECTS } from "./imageData";
import { createObject, writeFields } from "./sceneObjects";
import { click, element, object, renderScene, scene } from "./testScene";

// T7.1: изображения через интерфейс сцены (IMG-01…IMG-07). jsdom не загружает картинок,
// поэтому размер файла и удаление фона подменены; сеть — двойник fetch.
vi.mock("./imageSource", () => ({
  naturalSize: vi.fn((file: Blob) =>
    file.type === "image/png" && file.size === 0
      ? Promise.reject(new Error("broken"))
      : Promise.resolve({ width: 800, height: 400 }),
  ),
  withoutBackground: vi.fn(() =>
    Promise.resolve({
      blob: new Blob(["png"], { type: "image/png" }),
      size: { width: 800, height: 400 },
    }),
  ),
}));

const IDS = [
  "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f",
  "1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d",
  "2b3c4d5e-6f7a-4b2c-8d3e-4f5a6b7c8d9e",
];

interface Upload {
  url: string;
  mime: string;
  body: unknown;
}

let uploads: Upload[] = [];

/** Сервер media: каждый POST — новый файл, ответ `status` (по умолчанию 201). */
function serveMedia(status = 201) {
  uploads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const mime = (init.headers as Record<string, string>)["Content-Type"];
      uploads.push({ url, mime: mime ?? "", body: init.body });
      const id = IDS[uploads.length - 1] ?? IDS[0];
      const body =
        status === 201
          ? { id, name: "x", mime, size: 3, url: `/api/media/${String(id)}` }
          : { detail: "error" };
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

beforeEach(() => {
  serveMedia();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function png(name = "photo.png") {
  return new File(["png"], name, { type: "image/png" });
}

function images(board: ReturnType<typeof createBoardDocument>) {
  return scene(board).filter((o) => o.type === "image");
}

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function imageGroup() {
  return within(selectionBar()).getByRole("group", { name: "Image" });
}

function uploadInput() {
  return screen.getByLabelText<HTMLInputElement>("Upload image");
}

/** Изображение на доске, выделенное щелчком. */
function placedImage(mime = "image/png") {
  const board = createBoardDocument();
  const id = createImage(
    board.objects,
    { x: 0, y: 0 },
    { media: IDS[0] ?? "", mime, natural: { width: 400, height: 200 } },
    "Alice",
  );
  renderScene(board);
  click(element(id), [0, 0]);
  return { board, id };
}

function pasteFiles(files: File[]) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files, getData: () => "" },
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

describe("IMG-01: загрузка изображения на доску", () => {
  it("инструмент Image открывает выбор файла; файл загружается и встаёт в центре вида", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    const open = vi.spyOn(uploadInput(), "click");

    // Инструмент — в полном списке All tools (закрепляется там же, CVS-24).
    await user.click(
      within(screen.getByRole("toolbar", { name: "Tools" })).getByRole(
        "button",
        { name: "All tools" },
      ),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "All tools" })).getByRole(
        "button",
        { name: "Image" },
      ),
    );
    expect(open).toHaveBeenCalled();
    await user.upload(uploadInput(), png());

    await waitFor(() => {
      expect(images(board)).toHaveLength(1);
    });
    const [image] = images(board);
    expect(uploads).toEqual([
      {
        url: "/api/boards/test-board/media?name=photo.png",
        mime: "image/png",
        body: expect.any(File) as unknown,
      },
    ]);
    expect(image?.image?.media).toBe(IDS[0]);
    // 800×400 → 480×240 с центром в центре вида (0, 0).
    expect(image).toMatchObject({ x: -240, y: -120, width: 480, height: 240 });
    const view = element(image?.id ?? "");
    expect(view).toHaveAttribute("aria-label", "Image");
    expect(view.querySelector("img")).toHaveAttribute(
      "src",
      `/api/media/${String(IDS[0])}`,
    );
    // Новое изображение выделено.
    expect(view).toHaveAttribute("aria-selected", "true");
  });

  it("клавиша G — тот же выбор файла; инструмент не остаётся активным", () => {
    renderScene();
    const open = vi.spyOn(uploadInput(), "click");
    fireEvent.keyDown(document.body, { code: "KeyG", key: "g" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(
      within(screen.getByRole("toolbar", { name: "Tools" })).getByRole(
        "button",
        { name: "Select" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("картинка из буфера обмена загружается и встаёт изображением", async () => {
    const board = createBoardDocument();
    renderScene(board);

    const event = pasteFiles([png("clipboard.png")]);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => {
      expect(images(board)).toHaveLength(1);
    });
    expect(uploads[0]?.url).toBe(
      "/api/boards/test-board/media?name=clipboard.png",
    );
  });

  it("несколько файлов сразу — несколько изображений со сдвигом", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    await user.upload(uploadInput(), [png("a.png"), png("b.png")]);
    await waitFor(() => {
      expect(images(board)).toHaveLength(2);
    });
    const [a, b] = images(board);
    expect((b?.x ?? 0) - (a?.x ?? 0)).toBe(24);
  });

  it("файл больше лимита сервера — сообщение, изображения нет", async () => {
    serveMedia(413);
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    await user.upload(uploadInput(), png());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file is too large to upload.",
    );
    expect(images(board)).toHaveLength(0);
  });

  it("не изображение — сообщение без загрузки на сервер", async () => {
    const board = createBoardDocument();
    renderScene(board);
    pasteFiles([new File(["x"], "doc.bmp", { type: "image/bmp" })]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file type is not supported. Use PNG, JPEG, GIF, WebP or SVG.",
    );
    expect(uploads).toHaveLength(0);
    pasteFiles([new File([], "broken.png", { type: "image/png" })]);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This file is not an image that can be shown.",
    );
    expect(uploads).toHaveLength(0);
    expect(images(board)).toHaveLength(0);
  });
});

describe("IMG-07: SVG", () => {
  it("SVG загружается со своим типом и показывается изображением", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    await user.upload(
      uploadInput(),
      new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }),
    );
    await waitFor(() => {
      expect(images(board)).toHaveLength(1);
    });
    expect(uploads[0]?.mime).toBe("image/svg+xml");
    expect(images(board)[0]?.image?.mime).toBe("image/svg+xml");
  });
});

describe("IMG-02: маска, скругление, обрезка", () => {
  it("маска формы — clip-path изображения и общая для всех", async () => {
    const user = userEvent.setup();
    const { board, id } = placedImage();
    await user.selectOptions(
      within(imageGroup()).getByLabelText("Mask"),
      "circle",
    );
    expect(object(board, id).image?.mask).toBe("circle");
    const clip = element(id).querySelector<HTMLElement>(".image-clip");
    expect(clip?.style.clipPath).toBe("ellipse(50% 50% at 50% 50%)");
  });

  it("скругление углов — Corners в панели выделения", async () => {
    const user = userEvent.setup();
    const { board, id } = placedImage();
    await user.selectOptions(
      within(selectionBar()).getByLabelText("Corners"),
      "24",
    );
    expect(object(board, id).style.radius).toBe(24);
    const clip = element(id).querySelector<HTMLElement>(".image-clip");
    expect(clip?.style.borderRadius).toBe("24px");
  });

  it("Crop: протяжка правой стороны рамки обрезки уменьшает видимую часть", async () => {
    const user = userEvent.setup();
    const { board, id } = placedImage();
    // 400×200 исходника → 400×200 на доске.
    await user.click(
      within(imageGroup()).getByRole("button", { name: "Crop" }),
    );
    const box = screen.getByLabelText("Crop area");
    const east = box.querySelector('[data-handle="e"]') as HTMLElement;
    const pointer = { pointerId: 7, pointerType: "mouse", button: 0 };
    fireEvent.pointerDown(east, { ...pointer, clientX: 400, clientY: 100 });
    fireEvent.pointerMove(box, { ...pointer, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(box, { ...pointer, clientX: 300, clientY: 100 });

    const cropped = object(board, id);
    expect(cropped.image?.crop.width).toBeCloseTo(0.75);
    expect(cropped.width).toBeCloseTo(300);
    expect(cropped.x).toBeCloseTo(-200);
    // Исходник растянут на всю ширину, видимая часть — левые три четверти.
    const source = element(id).querySelector<HTMLElement>(".image-source");
    expect(source?.style.width).toMatch(/^133\.3/);

    await user.click(
      within(imageGroup()).getByRole("button", { name: "Done cropping" }),
    );
    expect(screen.queryByLabelText("Crop area")).toBeNull();
  });

  it("рамку обрезки двигают целиком в пределах исходника", () => {
    const board = createBoardDocument();
    const id = createImage(
      board.objects,
      { x: 0, y: 0 },
      {
        media: IDS[0] ?? "",
        mime: "image/png",
        natural: { width: 400, height: 200 },
      },
      "Alice",
    );
    writeFields(
      board.objects,
      new Map([
        [
          id,
          {
            x: -100,
            y: -100,
            width: 200,
            height: 200,
            crop: { x: 0, y: 0, width: 0.5, height: 1 },
          },
        ],
      ]),
      "Alice",
    );
    renderScene(board);
    click(element(id), [0, 0]);
    fireEvent.click(within(imageGroup()).getByRole("button", { name: "Crop" }));
    const box = screen.getByLabelText("Crop area");
    const pointer = { pointerId: 7, pointerType: "mouse", button: 0 };
    fireEvent.pointerDown(box, { ...pointer, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(box, { ...pointer, clientX: 500, clientY: 0 });
    fireEvent.pointerUp(box, { ...pointer, clientX: 500, clientY: 0 });
    const moved = object(board, id);
    expect(moved.image?.crop).toEqual({ x: 0.5, y: 0, width: 0.5, height: 1 });
    expect(moved.x).toBeCloseTo(100);
  });
});

describe("IMG-03: обводка и отражение", () => {
  it("Border width и Border задают обводку", async () => {
    const user = userEvent.setup();
    const { board, id } = placedImage();
    await user.selectOptions(
      within(selectionBar()).getByLabelText("Border width"),
      "4",
    );
    expect(object(board, id).style.strokeWidth).toBe(4);
    const stroke = element(id).querySelector<HTMLElement>(".image-stroke");
    expect(stroke?.style.borderWidth).toBe("4px");
    expect(stroke?.style.borderStyle).toBe("solid");
  });

  it("с маской обводка идёт по её контуру", async () => {
    const user = userEvent.setup();
    const { id } = placedImage();
    await user.selectOptions(
      within(selectionBar()).getByLabelText("Border width"),
      "2",
    );
    await user.selectOptions(
      within(imageGroup()).getByLabelText("Mask"),
      "star",
    );
    expect(
      element(id).querySelector("svg.image-stroke polygon"),
    ).not.toBeNull();
  });

  it("Flip horizontal и Flip vertical отражают изображение", async () => {
    const user = userEvent.setup();
    const { board, id } = placedImage();
    const flip = element(id).querySelector<HTMLElement>(".image-flip");
    await user.click(
      within(imageGroup()).getByRole("button", { name: "Flip horizontal" }),
    );
    expect(object(board, id).image).toMatchObject({
      flipX: true,
      flipY: false,
    });
    expect(flip?.style.transform).toBe("scale(-1, 1)");
    await user.click(
      within(imageGroup()).getByRole("button", { name: "Flip vertical" }),
    );
    expect(flip?.style.transform).toBe("scale(-1, -1)");
  });
});

describe("IMG-04: замена с сохранением обрезки", () => {
  it("Replace image загружает другой файл; обрезка и отражение остаются", async () => {
    const user = userEvent.setup();
    const { board, id } = placedImage();
    writeFields(
      board.objects,
      new Map([
        [id, { crop: { x: 0.25, y: 0, width: 0.5, height: 1 }, flipX: true }],
      ]),
      "Alice",
    );
    await user.upload(
      within(imageGroup()).getByLabelText("Replacement image"),
      new File(["jpg"], "new.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => {
      expect(object(board, id).image?.media).toBe(IDS[0]);
    });
    await waitFor(() => {
      expect(object(board, id).image?.mime).toBe("image/jpeg");
    });
    expect(object(board, id).image).toMatchObject({
      crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
      flipX: true,
    });
    expect(uploads[0]?.url).toBe("/api/boards/test-board/media?name=new.jpg");
  });
});

describe("IMG-05: удаление фона", () => {
  it("Remove background загружает PNG без фона и ставит его вместо исходника", async () => {
    const user = userEvent.setup();
    serveMedia();
    uploads.push({ url: "", mime: "", body: null }); // следующий id — второй
    const { board, id } = placedImage("image/jpeg");
    await user.click(
      within(imageGroup()).getByRole("button", { name: "Remove background" }),
    );
    await waitFor(() => {
      expect(object(board, id).image?.media).toBe(IDS[1]);
    });
    expect(object(board, id).image?.mime).toBe("image/png");
    expect(uploads[1]).toMatchObject({
      url: "/api/boards/test-board/media?name=background-removed.png",
      mime: "image/png",
    });
  });
});

describe("IMG-06: GIF", () => {
  it("немного объектов на экране — GIF воспроизводится сразу", () => {
    const board = createBoardDocument();
    const id = createImage(
      board.objects,
      { x: 0, y: 0 },
      {
        media: IDS[0] ?? "",
        mime: "image/gif",
        natural: { width: 100, height: 100 },
      },
      "Alice",
    );
    renderScene(board);
    const view = element(id).querySelector(".image-view");
    expect(view).toHaveAttribute("data-playing", "true");
    expect(view?.querySelector("img.image-source")).not.toBeNull();
  });

  it("много объектов на экране — GIF стоит, по наведению играет", () => {
    const board = createBoardDocument();
    for (let i = 0; i < MANY_OBJECTS; i++) {
      createObject(board.objects, "sticky", { x: -100, y: -100 });
    }
    const id = createImage(
      board.objects,
      { x: 0, y: 0 },
      {
        media: IDS[0] ?? "",
        mime: "image/gif",
        natural: { width: 100, height: 100 },
      },
      "Alice",
    );
    renderScene(board);
    const view = element(id).querySelector(".image-view") as HTMLElement;
    expect(view).toHaveAttribute("data-playing", "false");
    expect(view.querySelector("canvas")).not.toBeNull();
    expect(view.querySelector("img")).toBeNull();

    fireEvent.pointerEnter(view);
    expect(view).toHaveAttribute("data-playing", "true");
    expect(view.querySelector("img")).toHaveAttribute(
      "src",
      `/api/media/${String(IDS[0])}`,
    );
    fireEvent.pointerLeave(view);
    expect(view).toHaveAttribute("data-playing", "false");
  });
});
