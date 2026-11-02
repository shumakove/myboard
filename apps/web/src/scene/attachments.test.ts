import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createBoardDocument } from "../realtime/boardDocument";
import {
  createAttachment,
  extractPdfPages,
  PDF_BAR_HEIGHT,
  audioFrame,
  centerClearOfMinimap,
  PDF_MIN_WIDTH,
  pdfFrame,
  roomInView,
  renameAttachment,
  VIDEO_BAR_HEIGHT,
  videoFrame,
} from "./attachments";
import type { Size } from "./images";
import { OBJECT_TYPES } from "./objectTypes";
import { objectMap, readScene } from "./sceneObjects";

const ID = "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f";
const FILE = { media: ID, mime: "x/y", name: "a.bin", size: 5 };

function find(
  objects: ReturnType<typeof createBoardDocument>["objects"],
  id: string,
) {
  const object = readScene(objects).find((o) => o.id === id);
  if (object === undefined) throw new Error(id);
  return object;
}

describe("createAttachment", () => {
  it("FIL-01: ярлык с центром в точке хранит файл, имя и размер", () => {
    const { objects } = createBoardDocument();
    const id = createAttachment(
      objects,
      "file",
      { x: 100, y: 50 },
      FILE,
      "Alice",
    );
    const object = find(objects, id);
    expect(object.type).toBe("file");
    expect(object.attachment).toMatchObject({
      media: ID,
      name: "a.bin",
      size: 5,
      page: null,
    });
    expect(object.x + object.width / 2).toBe(100);
    expect(object.y + object.height / 2).toBe(50);
    expect(object.width).toBe(OBJECT_TYPES.file.width);
    expect(object.meta.createdBy).toBe("Alice");
  });
});

describe("рамки PDF и видео", () => {
  it("FIL-02: страница в пропорциях и панель страниц под ней", () => {
    expect(pdfFrame({ width: 600, height: 800 })).toEqual({
      width: 360,
      height: 480 + PDF_BAR_HEIGHT,
    });
  });

  it("FIL-03: кадр в пропорциях ролика и панель плеера под ним", () => {
    expect(videoFrame({ width: 1920, height: 1080 })).toEqual({
      width: 480,
      height: 270 + VIDEO_BAR_HEIGHT,
    });
  });

  it("FIL-03: узкий кадр не сжимает панель плеера", () => {
    const frame = videoFrame({ width: 1080, height: 1920 });
    expect(frame.width).toBe(420);
    expect(frame.height).toBeCloseTo((420 * 1920) / 1080 + VIDEO_BAR_HEIGHT);
  });

  it("FIL-03: браузер не прочитал размер — кадр по умолчанию", () => {
    expect(videoFrame(null)).toEqual({
      width: 480,
      height: 270 + VIDEO_BAR_HEIGHT,
    });
  });
});

describe("BUG-030, BUG-031, MOB-06: новый объект помещается в вид телефона", () => {
  /** Pixel 7: область холста шириной во весь экран, миникарта в правом нижнем углу. */
  const PHONE = { width: 412, height: 590 };
  /** Верхний край миникарты: отступ 8 px и высота 110 px от низа области холста. */
  const minimapTop = (viewport: Size) => viewport.height - 8 - 110;
  const AT_ORIGIN = { x: 0, y: 0, zoom: 1 };

  /** Верх и низ рамки на экране, поставленной в центр вида с учётом миникарты. */
  function verticalSpan(frame: Size, viewport: Size = PHONE) {
    const center = centerClearOfMinimap(
      { x: 0, y: 0 },
      frame,
      AT_ORIGIN,
      viewport,
    );
    const middle = viewport.height / 2 + center.y;
    return [middle - frame.height / 2, middle + frame.height / 2] as const;
  }

  it("ширина и высота — без миникарты: низ рамки выше её верхнего края", () => {
    const room = roomInView(PHONE, 1);
    expect(room.width).toBeLessThan(PHONE.width);
    const [top, bottom] = verticalSpan(room);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(bottom).toBeLessThanOrEqual(minimapTop(PHONE));
  });

  it("широкий вид: объект не достаёт до миникарты, её высота не вычитается", () => {
    const desktop = { width: 1440, height: 800 };
    expect(roomInView(desktop, 1).height).toBeGreaterThan(
      desktop.height - 2 * 16 - 1,
    );
  });

  it("единицы доски: при масштабе 50 % в вид входит вдвое больше", () => {
    const full = roomInView(PHONE, 1);
    const half = roomInView(PHONE, 0.5);
    expect(half.width).toBeCloseTo(full.width * 2);
    expect(half.height).toBeCloseTo(full.height * 2);
  });

  it("размер вида ещё неизвестен — без ограничения", () => {
    const frame = videoFrame(
      { width: 1920, height: 1080 },
      roomInView({ width: 0, height: 0 }, 1),
    );
    expect(frame.width).toBe(480);
  });

  it("FIL-02: PDF — панель страниц над миникартой, ширина вмещает панель", () => {
    const frame = pdfFrame({ width: 600, height: 800 }, roomInView(PHONE, 1));
    const [, bottom] = verticalSpan(frame);
    expect(bottom).toBeLessThanOrEqual(minimapTop(PHONE));
    expect(frame.width).toBeGreaterThanOrEqual(PDF_MIN_WIDTH);
    expect(frame.width).toBeLessThanOrEqual(PHONE.width);
  });

  it("FIL-03: широкий ролик шириной в вид, панель плеера над миникартой", () => {
    const frame = videoFrame(
      { width: 1920, height: 1080 },
      roomInView(PHONE, 1),
    );
    expect(frame.width).toBeLessThanOrEqual(PHONE.width);
    expect(frame.width).toBeGreaterThan(360);
    const [, bottom] = verticalSpan(frame);
    expect(bottom).toBeLessThanOrEqual(minimapTop(PHONE));
  });

  it("FIL-03: вертикальный ролик не выше вида, кадр вписан в рамку", () => {
    const room = roomInView(PHONE, 1);
    const frame = videoFrame({ width: 1080, height: 1920 }, room);
    expect(frame.height).toBeLessThanOrEqual(room.height);
    expect(frame.width).toBeLessThanOrEqual(room.width);
  });

  it("FIL-04: аудио не шире вида", () => {
    expect(
      audioFrame(roomInView({ width: 360, height: 590 }, 1)).width,
    ).toBeLessThanOrEqual(360);
    expect(audioFrame().width).toBe(400);
  });

  // Области холста из замеров BUG-031: окна 360×640, 320×568, 839×412.
  describe.each([
    ["360×640", { width: 334, height: 388 }],
    ["320×568", { width: 294, height: 316 }],
    ["839×412", { width: 455, height: 318 }],
  ])("BUG-031, окно %s", (_title, viewport) => {
    const room = roomInView(viewport, 1);

    it("FIL-02: PDF целиком над миникартой, страница различима", () => {
      const frame = pdfFrame({ width: 600, height: 800 }, room);
      const [top, bottom] = verticalSpan(frame, viewport);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(minimapTop(viewport));
      expect(frame.height - PDF_BAR_HEIGHT).toBeGreaterThanOrEqual(80);
    });

    it("FIL-03: видео целиком над миникартой, кадр не пропадает", () => {
      const frame = videoFrame({ width: 1920, height: 1080 }, room);
      const [top, bottom] = verticalSpan(frame, viewport);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(bottom).toBeLessThanOrEqual(minimapTop(viewport));
      expect(frame.height - VIDEO_BAR_HEIGHT).toBeGreaterThanOrEqual(80);
    });

    it("FIL-04: аудио над миникартой", () => {
      const [, bottom] = verticalSpan(audioFrame(room), viewport);
      expect(bottom).toBeLessThanOrEqual(minimapTop(viewport));
    });
  });

  it("BUG-031: там, где хватает места, верх объекта не под панелью выделения", () => {
    const viewport = { width: 334, height: 388 };
    const frame = pdfFrame(
      { width: 600, height: 800 },
      roomInView(viewport, 1),
    );
    expect(verticalSpan(frame, viewport)[0]).toBeGreaterThanOrEqual(60);
  });

  describe("BUG-031: centerClearOfMinimap", () => {
    const LOW = { width: 294, height: 316 };
    const FRAME = { width: 280, height: 186 };

    it("объект, не задевающий миникарту, остаётся в центре вида", () => {
      const center = { x: 40, y: -30 };
      const small = { width: 200, height: 100 };
      expect(centerClearOfMinimap(center, small, AT_ORIGIN, LOW)).toEqual(
        center,
      );
    });

    it("объект левее миникарты не поднимается, даже если ниже её верха", () => {
      const center = { x: 0, y: 0 };
      const desktop = { width: 1440, height: 400 };
      const tall = { width: 480, height: 380 };
      expect(centerClearOfMinimap(center, tall, AT_ORIGIN, desktop)).toEqual(
        center,
      );
    });

    it("сдвинутая камера: поднимается относительно вида, x не меняется", () => {
      const camera = { x: 500, y: 700, zoom: 1 };
      const center = centerClearOfMinimap(
        { x: 500, y: 700 },
        FRAME,
        camera,
        LOW,
      );
      expect(center.x).toBe(500);
      const bottom = LOW.height / 2 + center.y - 700 + FRAME.height / 2;
      expect(bottom).toBeCloseTo(LOW.height - 110 - 12);
    });

    it("масштаб: сдвиг считается в единицах доски", () => {
      const camera = { x: 0, y: 0, zoom: 0.5 };
      const big = { width: 560, height: 500 };
      const center = centerClearOfMinimap({ x: 0, y: 0 }, big, camera, LOW);
      const bottom = LOW.height / 2 + (center.y + big.height / 2) * 0.5;
      expect(bottom).toBeCloseTo(LOW.height - 110 - 12);
    });

    it("следующий файл со сдвигом тоже остаётся над миникартой", () => {
      const center = centerClearOfMinimap(
        { x: 24, y: 24 },
        FRAME,
        AT_ORIGIN,
        LOW,
      );
      const bottom = LOW.height / 2 + center.y + FRAME.height / 2;
      expect(bottom).toBeLessThanOrEqual(minimapTop(LOW));
    });

    it("размер вида ещё неизвестен — центр не меняется", () => {
      const center = { x: 1, y: 2 };
      expect(
        centerClearOfMinimap(center, FRAME, AT_ORIGIN, { width: 0, height: 0 }),
      ).toEqual(center);
    });
  });
});

describe("renameAttachment: FIL-01", () => {
  it("новое имя пишется в документ и видно второму участнику", () => {
    const a = createBoardDocument();
    const b = createBoardDocument();
    a.doc.on("update", (update: Uint8Array) => {
      Y.applyUpdate(b.doc, update);
    });
    const id = createAttachment(
      a.objects,
      "file",
      { x: 0, y: 0 },
      FILE,
      "Alice",
    );
    renameAttachment(a.objects, find(a.objects, id), "  report.bin ", "Alice");
    expect(find(b.objects, id).attachment?.name).toBe("report.bin");
  });

  it("пустое имя не записывается", () => {
    const { objects } = createBoardDocument();
    const id = createAttachment(objects, "file", { x: 0, y: 0 }, FILE, "Alice");
    renameAttachment(objects, find(objects, id), "   ", "Alice");
    expect(find(objects, id).attachment?.name).toBe("a.bin");
  });

  it("CVS-19: заблокированный файл не переименовывается", () => {
    const { objects } = createBoardDocument();
    const id = createAttachment(objects, "file", { x: 0, y: 0 }, FILE, "Alice");
    objectMap(objects, id)?.set("locked", true);
    renameAttachment(objects, find(objects, id), "b.bin", "Alice");
    expect(find(objects, id).attachment?.name).toBe("a.bin");
  });
});

describe("extractPdfPages: FIL-02", () => {
  function pdf() {
    const { objects } = createBoardDocument();
    const id = createAttachment(
      objects,
      "pdf",
      { x: 0, y: 0 },
      { ...FILE, name: "doc.pdf", pages: 5 },
      "Alice",
      pdfFrame({ width: 600, height: 800 }),
    );
    return { objects, source: find(objects, id) };
  }

  it("каждая выбранная страница — отдельный объект, исходный PDF на месте", () => {
    const { objects, source } = pdf();
    const ids = extractPdfPages(objects, source, [4, 2], "Bob");
    expect(ids).toHaveLength(2);
    const [first, second] = ids.map((id) => find(objects, id));
    expect(first?.attachment).toMatchObject({ media: ID, page: 2, pages: 5 });
    expect(second?.attachment).toMatchObject({ media: ID, page: 4 });
    expect(first?.meta.createdBy).toBe("Bob");
    expect(find(objects, source.id).attachment?.page).toBeNull();
    expect(readScene(objects)).toHaveLength(3);
  });

  it("страницы встают правее исходного PDF и не накладываются", () => {
    const { objects, source } = pdf();
    const [first, second] = extractPdfPages(objects, source, [1, 2], "Bob").map(
      (id) => find(objects, id),
    );
    expect(first?.x).toBeGreaterThan(source.x + source.width);
    expect(second?.x).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0));
    expect(first?.height).toBe(source.height - PDF_BAR_HEIGHT);
  });

  it("несуществующие страницы и повторы отбрасываются", () => {
    const { objects, source } = pdf();
    expect(extractPdfPages(objects, source, [0, 6, 3, 3], "Bob")).toHaveLength(
      1,
    );
  });

  it("извлечение — одна правка: отмена убирает все страницы сразу", () => {
    const board = createBoardDocument();
    const id = createAttachment(
      board.objects,
      "pdf",
      { x: 0, y: 0 },
      { ...FILE, pages: 3 },
      "Alice",
    );
    let updates = 0;
    board.doc.on("update", () => {
      updates += 1;
    });
    extractPdfPages(board.objects, find(board.objects, id), [1, 2, 3], "Alice");
    expect(updates).toBe(1);
  });
});
