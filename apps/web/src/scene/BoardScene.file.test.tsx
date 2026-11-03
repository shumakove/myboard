import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { probeVideo } from "../media/mediaProbe";
import { readPdf, renderPdfPage } from "../media/pdfDocument";
import { createBoardDocument } from "../realtime/boardDocument";
import {
  createAttachment,
  PDF_BAR_HEIGHT,
  pdfFrame,
  VIDEO_BAR_HEIGHT,
} from "./attachments";
import { createImage } from "./images";
import { MANY_OBJECTS } from "./imageData";
import { createObject, objectMap } from "./sceneObjects";
import { click, element, object, renderScene, scene } from "./testScene";

// T7.2: файлы через интерфейс сцены (FIL-01…FIL-05). jsdom не читает роликов и PDF:
// проба ролика и pdf.js подменены; сеть — двойник fetch.
vi.mock("../media/mediaProbe", () => ({
  probeVideo: vi.fn(() => Promise.resolve({ width: 1920, height: 1080 })),
}));
vi.mock("../media/pdfDocument", () => ({
  readPdf: vi.fn(() =>
    Promise.resolve({ pages: 3, page: { width: 600, height: 800 } }),
  ),
  renderPdfPage: vi.fn(() => Promise.resolve()),
}));

const ID = "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f";
const FILE = { media: ID, mime: "x/y", name: "a.bin", size: 2048 };

interface Upload {
  url: string;
  mime: string;
}

let uploads: Upload[] = [];

function serveMedia(status = 201) {
  uploads = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const mime = (init.headers as Record<string, string>)["Content-Type"];
      uploads.push({ url, mime: mime ?? "" });
      const name = new URL(url, "http://x").searchParams.get("name");
      const body =
        status === 201
          ? { id: ID, name, mime, size: 2048, url: `/api/media/${ID}` }
          : { detail: "error" };
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

beforeEach(() => {
  serveMedia();
  vi.mocked(readPdf).mockClear();
  vi.mocked(renderPdfPage).mockClear();
  vi.mocked(probeVideo).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

function fileInput() {
  return screen.getByLabelText<HTMLInputElement>("Upload file");
}

function selectionBar() {
  return screen.getByRole("toolbar", { name: "Selection" });
}

function placed(type: "file" | "pdf" | "video" | "audio", extra = {}) {
  const board = createBoardDocument();
  const id = createAttachment(
    board.objects,
    type,
    { x: 0, y: 0 },
    { ...FILE, ...extra },
    "Alice",
    type === "pdf" ? pdfFrame({ width: 600, height: 800 }) : undefined,
  );
  renderScene(board);
  return { board, id };
}

/** Размер рамки объекта на экране этого клиента, единицы доски. */
function shownSize(id: string) {
  const { width, height } = element(id).style;
  return { width: parseFloat(width), height: parseFloat(height) };
}

function upload(name: string, type: string) {
  fireEvent.change(fileInput(), {
    target: { files: [new File(["data"], name, { type })] },
  });
}

describe("FIL-01: ярлык файла", () => {
  it("инструмент File открывает выбор файла; файл встаёт ярлыком и выделяется", async () => {
    const user = userEvent.setup();
    const board = createBoardDocument();
    renderScene(board);
    const open = vi.spyOn(fileInput(), "click");

    await user.click(
      within(screen.getByRole("toolbar", { name: "Tools" })).getByRole(
        "button",
        { name: /^All tools/ },
      ),
    );
    await user.click(
      within(screen.getByRole("dialog", { name: "All tools" })).getByRole(
        "button",
        { name: "File" },
      ),
    );
    expect(open).toHaveBeenCalled();

    upload("report final.docx", "application/msword");
    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    const [shortcut] = scene(board);
    expect(shortcut?.type).toBe("file");
    expect(shortcut?.attachment?.name).toBe("report final.docx");
    expect(uploads[0]?.mime).toBe("application/octet-stream");
    expect(uploads[0]?.url).toContain("kind=file");
    expect(screen.getByText("report final.docx")).toBeInTheDocument();
    expect(screen.getByText("2 KB")).toBeInTheDocument();
    expect(element(shortcut?.id ?? "")).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("сервер отказал — сообщение, объекта нет", async () => {
    serveMedia(413);
    const board = createBoardDocument();
    renderScene(board);
    upload("big.zip", "application/zip");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The file is too large to upload.",
    );
    expect(scene(board)).toHaveLength(0);
  });

  it("имя меняется в панели выделения и попадает в документ и ссылку скачивания", async () => {
    const user = userEvent.setup();
    const { board, id } = placed("file");
    click(element(id), [0, 0]);

    const field = within(selectionBar()).getByLabelText("File name");
    await user.clear(field);
    expect(object(board, id).attachment?.name).toBe("a.bin");
    await user.type(field, "итог.bin{Enter}");

    expect(object(board, id).attachment?.name).toBe("итог.bin");
    expect(screen.getByText("итог.bin")).toBeInTheDocument();
    const download = within(selectionBar()).getByRole("link", {
      name: "Download",
    });
    expect(download).toHaveAttribute("download", "итог.bin");
    expect(download.getAttribute("href")).toBe(
      `/api/media/${ID}?download=${encodeURIComponent("итог.bin")}`,
    );
  });

  it("CVS-19: у заблокированного ярлыка скачивание есть, переименования нет", () => {
    const board = createBoardDocument();
    const id = createAttachment(
      board.objects,
      "file",
      { x: 0, y: 0 },
      FILE,
      "A",
    );
    objectMap(board.objects, id)?.set("locked", true);
    renderScene(board);
    click(element(id), [0, 0]);
    expect(within(selectionBar()).queryByLabelText("File name")).toBeNull();
    expect(
      within(selectionBar()).getByRole("link", { name: "Download" }),
    ).toBeInTheDocument();
  });
});

describe("FIL-02: PDF постранично", () => {
  it("PDF загружается объектом с числом страниц и рисует первую страницу", async () => {
    const board = createBoardDocument();
    renderScene(board);
    upload("doc.pdf", "application/pdf");
    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    const [pdf] = scene(board);
    expect(pdf?.type).toBe("pdf");
    expect(pdf?.attachment?.pages).toBe(3);
    expect(uploads[0]?.mime).toBe("application/pdf");
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(renderPdfPage).toHaveBeenLastCalledWith(
      `/api/media/${ID}`,
      1,
      expect.any(HTMLCanvasElement),
      expect.any(AbortSignal),
    );
  });

  it("не PDF под видом PDF не загружается", async () => {
    vi.mocked(readPdf).mockRejectedValueOnce(new Error("broken"));
    const board = createBoardDocument();
    renderScene(board);
    upload("bad.pdf", "application/pdf");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This PDF could not be opened.",
    );
    expect(uploads).toHaveLength(0);
    expect(scene(board)).toHaveLength(0);
  });

  it("листание меняет страницу у этого участника и не меняет документ", async () => {
    const user = userEvent.setup();
    const { board } = placed("pdf", { pages: 3 });
    const updates = vi.fn();
    board.doc.on("update", updates);

    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(renderPdfPage).toHaveBeenLastCalledWith(
      `/api/media/${ID}`,
      2,
      expect.any(HTMLCanvasElement),
      expect.any(AbortSignal),
    );
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    expect(updates).not.toHaveBeenCalled();
  });

  it("файл недоступен — надпись вместо страницы", async () => {
    vi.mocked(renderPdfPage).mockRejectedValueOnce(new Error("404"));
    placed("pdf", { pages: 3 });
    expect(await screen.findByText("PDF unavailable")).toBeInTheDocument();
  });

  it("выбранные страницы становятся отдельными выделенными объектами", async () => {
    const user = userEvent.setup();
    const { board, id } = placed("pdf", { pages: 3 });
    click(element(id), [0, 0]);

    await user.click(
      within(selectionBar()).getByRole("button", { name: "Extract pages" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Extract pages" });
    expect(within(dialog).getAllByRole("checkbox")).toHaveLength(3);
    expect(
      within(dialog).getByRole("button", { name: "Extract" }),
    ).toBeDisabled();
    await user.click(within(dialog).getByLabelText("Page 3"));
    await user.click(within(dialog).getByLabelText("Page 1"));
    await user.click(within(dialog).getByRole("button", { name: "Extract" }));

    expect(screen.queryByRole("dialog", { name: "Extract pages" })).toBeNull();
    const pages = scene(board).filter((o) => o.attachment?.page != null);
    expect(pages.map((o) => o.attachment?.page).sort()).toEqual([1, 3]);
    for (const page of pages) {
      expect(element(page.id)).toHaveAttribute("aria-selected", "true");
    }
    // Извлечённая страница показана без листания и сама не извлекается.
    expect(screen.getAllByRole("button", { name: "Next page" })).toHaveLength(
      1,
    );
    expect(object(board, id).attachment?.page).toBeNull();
  });

  it("у извлечённой страницы нет Extract pages", () => {
    const { id } = placed("pdf", { pages: 3, page: 2 });
    click(element(id), [0, 0]);
    expect(
      within(selectionBar()).queryByRole("button", { name: "Extract pages" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(renderPdfPage).toHaveBeenLastCalledWith(
      `/api/media/${ID}`,
      2,
      expect.any(HTMLCanvasElement),
      expect.any(AbortSignal),
    );
  });
});

describe("BUG-030, BUG-031, MOB-06: новый объект на телефоне", () => {
  function canvasOf(width: number, height: number) {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(
      width,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
      height,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe.each([
    ["высокий холст", 388, 590],
    ["окно 360×640", 334, 388],
    ["окно 320×568", 294, 316],
    ["окно 839×412", 455, 318],
  ])("%s", (_title, width, height) => {
    it.each([
      ["a.mp4", "video/mp4", "video"],
      ["a.pdf", "application/pdf", "pdf"],
      ["a.mp3", "audio/mpeg", "audio"],
    ])("%s встаёт в вид над миникартой", async (name, type, kind) => {
      canvasOf(width, height);
      const board = createBoardDocument();
      renderScene(board);
      upload(name, type);
      await waitFor(() => {
        expect(scene(board)).toHaveLength(1);
      });
      const [placedObject] = scene(board);
      expect(placedObject?.type).toBe(kind);
      // Камера в начале координат: центр вида — точка (0, 0) доски. Размер — показанный.
      const top = height / 2 + (placedObject?.y ?? NaN);
      const bottom = top + shownSize(placedObject?.id ?? "").height;
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(height - 8 - 110);
    });
  });

  describe("BUG-032: размер в документе не зависит от экрана загрузившего", () => {
    const LOW_WIDTH = 294;
    const LOW_HEIGHT = 316;

    async function uploaded(name: string, type: string) {
      canvasOf(LOW_WIDTH, LOW_HEIGHT);
      const board = createBoardDocument();
      renderScene(board);
      upload(name, type);
      await waitFor(() => {
        expect(scene(board)).toHaveLength(1);
      });
      const [only] = scene(board);
      if (only === undefined) throw new Error(name);
      return { board, id: only.id, stored: only };
    }

    it.each([
      ["a.mp4", "video/mp4", 480, 270 + VIDEO_BAR_HEIGHT],
      ["a.pdf", "application/pdf", 360, 480 + PDF_BAR_HEIGHT],
      ["a.mp3", "audio/mpeg", 400, 96],
    ])(
      "%s: в документе размер без учёта экрана, загрузившему — по его виду",
      async (name, type, width, height) => {
        const { id, stored } = await uploaded(name, type);
        expect(stored.width).toBe(width);
        expect(stored.height).toBe(height);
        expect(shownSize(id).width).toBeLessThan(width);
      },
    );

    it("второй клиент получает размер из документа, а не размер телефона", async () => {
      const { board, id } = await uploaded("a.mp4", "video/mp4");
      const other = createBoardDocument();
      Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(board.doc));
      expect(object(other, id).width).toBe(480);
    });

    it("после правки размера в документе показывается она, а не размер под экран", async () => {
      const { board, id } = await uploaded("a.mp4", "video/mp4");
      act(() => {
        objectMap(board.objects, id)?.set("width", 500);
        objectMap(board.objects, id)?.set("height", 400);
      });
      expect(shownSize(id)).toEqual({ width: 500, height: 400 });
    });

    it("FIL-02: страницы, извлечённые на телефоне, получают размер документа", async () => {
      const user = userEvent.setup();
      const { board, stored } = await uploaded("a.pdf", "application/pdf");
      await user.click(
        within(selectionBar()).getByRole("button", { name: "Extract pages" }),
      );
      const dialog = screen.getByRole("dialog", { name: "Extract pages" });
      await user.click(within(dialog).getByLabelText("Page 2"));
      await user.click(within(dialog).getByRole("button", { name: "Extract" }));
      const extracted = scene(board).find((o) => o.attachment?.page === 2);
      expect(extracted?.width).toBe(stored.width);
      expect(extracted?.height).toBe(stored.height - PDF_BAR_HEIGHT);
    });

    it.each([
      ["a.mp4", "video/mp4"],
      ["a.pdf", "application/pdf"],
    ])(
      "%s: панель выделения помечена для переноса под объект",
      async (name, type) => {
        await uploaded(name, type);
        expect(selectionBar()).toHaveClass("selection-bar--below");
      },
    );

    it("у других объектов панель выделения на своём месте", async () => {
      await uploaded("a.mp3", "audio/mpeg");
      expect(selectionBar()).not.toHaveClass("selection-bar--below");
    });
  });

  it("прокрученная страница возвращает холст в окно", async () => {
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    const board = createBoardDocument();
    renderScene(board);
    expect(scroll).not.toHaveBeenCalled();
    upload("a.mp4", "video/mp4");
    await waitFor(() => {
      expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    });
    expect(scroll.mock.contexts[0]).toBe(screen.getByTestId("board-canvas"));
  });
});

describe("FIL-03, FIL-04: видео и аудио", () => {
  it.each([
    ["a.mp4", "video/mp4"],
    ["a.m4v", "video/x-m4v"],
    ["a.mov", "video/quicktime"],
    ["a.webm", "video/webm"],
  ])("FIL-03: %s — видео с размером кадра ролика", async (name, type) => {
    const board = createBoardDocument();
    renderScene(board);
    upload(name, type);
    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    const [video] = scene(board);
    expect(video?.type).toBe("video");
    expect(video?.width).toBe(480);
    expect(uploads[0]?.mime).toBe(type);
    expect(element(video?.id ?? "").querySelector("video")).toHaveAttribute(
      "src",
      `/api/media/${ID}`,
    );
  });

  it.each([
    ["a.mp3", "audio/mpeg"],
    ["a.m4a", "audio/x-m4a"],
    ["a.wav", "audio/wav"],
    ["a.webm", "audio/webm"],
  ])("FIL-04: %s — аудио", async (name, type) => {
    const board = createBoardDocument();
    renderScene(board);
    upload(name, type);
    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    const [audio] = scene(board);
    expect(audio?.type).toBe("audio");
    expect(element(audio?.id ?? "").querySelector("audio")).toHaveAttribute(
      "src",
      `/api/media/${ID}`,
    );
  });

  it("FIL-04: .webm с типом видео, но без кадра — аудио", async () => {
    vi.mocked(probeVideo).mockResolvedValueOnce({ width: 0, height: 0 });
    const board = createBoardDocument();
    renderScene(board);
    upload("voice.webm", "video/webm");
    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    expect(scene(board)[0]?.type).toBe("audio");
  });

  it("FIL-03: браузер не прочитал ролик — объект видео с кадром по умолчанию", async () => {
    vi.mocked(probeVideo).mockResolvedValueOnce(null);
    const board = createBoardDocument();
    renderScene(board);
    upload("a.mov", "video/quicktime");
    await waitFor(() => {
      expect(scene(board)).toHaveLength(1);
    });
    expect(scene(board)[0]?.type).toBe("video");
    expect(scene(board)[0]?.width).toBe(480);
  });

  it("нажатие на панель плеера не выделяет объект", async () => {
    const user = userEvent.setup();
    const { id } = placed("video");
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(element(id)).toHaveAttribute("aria-selected", "false");
    vi.restoreAllMocks();
  });
});

describe("FIL-05: воспроизведение только у запустившего", () => {
  it.each(["video", "audio"] as const)(
    "%s: запуск и перемотка не пишут в документ",
    async (type) => {
      const user = userEvent.setup();
      const { board, id } = placed(type);
      const play = vi
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockResolvedValue(undefined);
      const updates = vi.fn();
      board.doc.on("update", updates);

      await user.click(screen.getByRole("button", { name: "Play" }));
      const media = element(id).querySelector(type);
      if (media === null) throw new Error(type);
      fireEvent.play(media);
      expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
      expect(play).toHaveBeenCalledTimes(1);

      // Чужая правка документа не останавливает и не перезапускает ролик.
      createObject(board.objects, "sticky", { x: 900, y: 900 }, "x", "Bob");
      await screen.findByRole("button", { name: "Pause" });
      expect(element(id).querySelector(type)).toBe(media);
      expect(play).toHaveBeenCalledTimes(1);

      expect(updates).toHaveBeenCalledTimes(1);
      vi.restoreAllMocks();
    },
  );

  it("GIF: наведение запускает только у этого участника — документ не меняется", () => {
    const board = createBoardDocument();
    for (let index = 0; index < MANY_OBJECTS; index += 1) {
      createObject(board.objects, "sticky", { x: 0, y: 0 }, "", "A");
    }
    const id = createImage(
      board.objects,
      { x: 0, y: 0 },
      { media: ID, mime: "image/gif", natural: { width: 80, height: 80 } },
      "A",
    );
    renderScene(board);
    const updates = vi.fn();
    board.doc.on("update", updates);
    const view = element(id).querySelector(".image-view");
    if (view === null) throw new Error("view");
    fireEvent.pointerEnter(view);
    expect(updates).not.toHaveBeenCalled();
  });
});
