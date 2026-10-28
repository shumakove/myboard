import * as Y from "yjs";
import { describe, expect, it } from "vitest";
import { createBoardDocument } from "../realtime/boardDocument";
import {
  dragCrop,
  FULL_CROP,
  maskClipPath,
  MANY_OBJECTS,
  mediaUrl,
  MIN_CROP,
  readCrop,
  readImage,
  viewCrop,
  type ImageCrop,
} from "./imageData";
import {
  createImage,
  croppedFrame,
  cropImage,
  fitSize,
  flipImages,
  manyOnScreen,
  replaceImage,
  setImageFields,
} from "./images";
import { createObject, readScene, writeFields } from "./sceneObjects";

const MEDIA = "0f8b1c3e-9a6d-4e2b-8c1f-2a3b4c5d6e7f";
const OTHER = "1a2b3c4d-5e6f-4a1b-9c2d-3e4f5a6b7c8d";
const PHOTO = {
  media: MEDIA,
  mime: "image/png",
  natural: { width: 800, height: 400 },
};

function expectCrop(actual: ImageCrop, expected: ImageCrop) {
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(actual[key]).toBeCloseTo(expected[key]);
  }
}

function imageOf(board: ReturnType<typeof createBoardDocument>, id: string) {
  const found = readScene(board.objects).find((o) => o.id === id);
  if (found?.image == null) throw new Error("нет изображения");
  return found;
}

describe("IMG-01: изображение в документе", () => {
  it("новое изображение — файл media, пропорции исходника, центр в точке вставки", () => {
    const board = createBoardDocument();
    const id = createImage(board.objects, { x: 100, y: 100 }, PHOTO, "Alice");
    const image = imageOf(board, id);
    expect(image.type).toBe("image");
    expect(image.image).toEqual({
      media: MEDIA,
      mime: "image/png",
      crop: FULL_CROP,
      mask: "none",
      flipX: false,
      flipY: false,
    });
    // 800×400 → большая сторона 480.
    expect(image).toMatchObject({ x: -140, y: -20, width: 480, height: 240 });
    expect(image.meta.createdBy).toBe("Alice");
  });

  it("маленький исходник встаёт в своём размере", () => {
    expect(fitSize({ width: 120, height: 90 })).toEqual({
      width: 120,
      height: 90,
    });
    expect(fitSize({ width: 300, height: 1200 })).toEqual({
      width: 120,
      height: 480,
    });
  });

  it("адрес файла — только /api/media/{id}; чужой адрес в документе не загружается", () => {
    expect(mediaUrl(MEDIA)).toBe(`/api/media/${MEDIA}`);
    expect(mediaUrl("https://evil.example/x.png")).toBeNull();
    expect(mediaUrl("../../api/boards")).toBeNull();
    expect(mediaUrl("")).toBeNull();
  });

  it("испорченные поля читаются значениями по умолчанию", () => {
    expect(
      readImage({ media: 1, mask: "blob", flipX: "yes", crop: { x: "a" } }),
    ).toEqual({
      media: "",
      mime: "",
      crop: FULL_CROP,
      mask: "none",
      flipX: false,
      flipY: false,
    });
    expect(readCrop({ x: -1, y: 0.9, width: 2, height: 0.5 })).toEqual({
      x: 0,
      y: 0.5,
      width: 1,
      height: 0.5,
    });
  });

  it("COL-01: изображение и его правки доходят до второго участника", () => {
    const one = createBoardDocument();
    const two = createBoardDocument();
    one.doc.on("update", (update: Uint8Array) => {
      Y.applyUpdate(two.doc, update);
    });
    const id = createImage(one.objects, { x: 0, y: 0 }, PHOTO, "Alice");
    setImageFields(one.objects, [imageOf(one, id)], { mask: "circle" }, "A");
    expect(imageOf(two, id).image?.mask).toBe("circle");
    expect(imageOf(two, id).image?.media).toBe(MEDIA);
  });
});

describe("IMG-02: обрезка, маска", () => {
  it("обрезка правой половины: исходник на месте, рамка — его правая половина", () => {
    const frame = { x: 0, y: 0, width: 400, height: 200, rotation: 0 };
    const next = { x: 0.5, y: 0, width: 0.5, height: 1 };
    expect(croppedFrame(frame, FULL_CROP, next)).toEqual({
      x: 200,
      y: 0,
      width: 200,
      height: 200,
      rotation: 0,
    });
    // Обратно до целого — та же рамка, что была.
    expect(
      croppedFrame({ ...frame, x: 200, width: 200 }, next, FULL_CROP),
    ).toEqual(frame);
  });

  it("у повёрнутого изображения центр рамки сдвигается вдоль его осей", () => {
    const frame = { x: 0, y: 0, width: 400, height: 200, rotation: 90 };
    const cropped = croppedFrame(frame, FULL_CROP, {
      x: 0.5,
      y: 0,
      width: 0.5,
      height: 1,
    });
    // Центр (200, 100) уходит на 100 вдоль оси x изображения, то есть вниз по доске.
    expect(cropped.x + cropped.width / 2).toBeCloseTo(200);
    expect(cropped.y + cropped.height / 2).toBeCloseTo(200);
    expect(cropped.rotation).toBe(90);
  });

  it("cropImage записывает обрезку и рамку; заблокированное не меняется", () => {
    const board = createBoardDocument();
    const id = createImage(board.objects, { x: 240, y: 120 }, PHOTO, "A");
    cropImage(
      board.objects,
      imageOf(board, id),
      { x: 0, y: 0, width: 0.5, height: 0.5 },
      "A",
    );
    const cropped = imageOf(board, id);
    expect(cropped.image?.crop).toEqual({
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    });
    expect(cropped).toMatchObject({ x: 0, y: 0, width: 240, height: 120 });

    writeFields(board.objects, new Map([[id, { locked: true }]]), "A");
    cropImage(board.objects, imageOf(board, id), FULL_CROP, "A");
    expect(imageOf(board, id).image?.crop.width).toBe(0.5);
  });

  it("рамку обрезки тянут за стороны и углы в пределах исходника", () => {
    const start = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 };
    expectCrop(dragCrop(start, "e", 0.1, 0.5), {
      x: 0.2,
      y: 0.2,
      width: 0.7,
      height: 0.6,
    });
    const nw = dragCrop(start, "nw", -0.5, 0.1);
    expect(nw.x).toBe(0);
    expect(nw.y).toBeCloseTo(0.3);
    expect(nw.x + nw.width).toBeCloseTo(0.8);
    // Не меньше MIN_CROP и не за край.
    expect(dragCrop(start, "w", 5, 0).width).toBeCloseTo(MIN_CROP);
    expectCrop(dragCrop(start, "move", 1, 1), {
      x: 0.4,
      y: 0.4,
      width: 0.6,
      height: 0.6,
    });
  });

  it("у отражённого изображения обрезка в показе зеркальна исходнику", () => {
    const image = readImage({ flipX: true });
    const crop = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    expectCrop(viewCrop(crop, image), { ...crop, x: 0.6 });
    expectCrop(viewCrop(viewCrop(crop, image), image), crop);
  });

  it("маска — форма clip-path; без маски — без обрезки формы", () => {
    expect(maskClipPath("none")).toBeUndefined();
    expect(maskClipPath("circle")).toBe("ellipse(50% 50% at 50% 50%)");
    expect(maskClipPath("triangle")).toBe(
      "polygon(50% 0%, 100% 100%, 0% 100%)",
    );
  });
});

describe("IMG-03: отражение", () => {
  it("отражение по каждой оси переключается и не трогает другую", () => {
    const board = createBoardDocument();
    const id = createImage(board.objects, { x: 0, y: 0 }, PHOTO, "A");
    flipImages(board.objects, [imageOf(board, id)], "x", "A");
    expect(imageOf(board, id).image).toMatchObject({
      flipX: true,
      flipY: false,
    });
    flipImages(board.objects, [imageOf(board, id)], "y", "A");
    flipImages(board.objects, [imageOf(board, id)], "x", "A");
    expect(imageOf(board, id).image).toMatchObject({
      flipX: false,
      flipY: true,
    });
  });
});

describe("IMG-04: замена с сохранением обрезки", () => {
  it("новый файл, та же обрезка, маска и отражение; высота — по пропорциям нового", () => {
    const board = createBoardDocument();
    const id = createImage(board.objects, { x: 240, y: 120 }, PHOTO, "A");
    cropImage(
      board.objects,
      imageOf(board, id),
      { x: 0.25, y: 0, width: 0.5, height: 1 },
      "A",
    );
    setImageFields(
      board.objects,
      [imageOf(board, id)],
      { mask: "star", flipY: true },
      "A",
    );
    const before = imageOf(board, id);

    replaceImage(
      board.objects,
      before,
      {
        media: OTHER,
        mime: "image/jpeg",
        natural: { width: 400, height: 400 },
      },
      "Bob",
    );

    const after = imageOf(board, id);
    expect(after.image).toEqual({
      ...before.image,
      media: OTHER,
      mime: "image/jpeg",
    });
    // Видимая часть 0.5×1 квадратного исходника: высота вдвое больше ширины.
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.width * 2);
    expect(after.y + after.height / 2).toBe(before.y + before.height / 2);
    expect(after.meta.updatedBy).toBe("Bob");
  });
});

describe("IMG-06: много объектов на экране", () => {
  const view = { x: 0, y: 0, width: 1000, height: 1000 };

  it(`с ${String(MANY_OBJECTS)} объектов в видимой части — много`, () => {
    const board = createBoardDocument();
    for (let i = 0; i < MANY_OBJECTS - 1; i++) {
      createObject(board.objects, "sticky", { x: i * 10, y: 0 });
    }
    // Объекты вне вида не считаются.
    createObject(board.objects, "sticky", { x: 5000, y: 5000 });
    expect(manyOnScreen(readScene(board.objects), view)).toBe(false);
    createObject(board.objects, "sticky", { x: 500, y: 500 });
    expect(manyOnScreen(readScene(board.objects), view)).toBe(true);
  });
});
