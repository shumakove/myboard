import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { Rect } from "../canvas/camera";
import { boundsOf, type Frame } from "./geometry";
import {
  clampCrop,
  FULL_CROP,
  IMAGE_TYPE,
  MANY_OBJECTS,
  type ImageCrop,
  type ImageMask,
} from "./imageData";
import {
  createObject,
  objectMap,
  patchObjects,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

/** Изображение (T7.1): постановка, обрезка, маска, отражение и замена (IMG-01…IMG-04). */

export interface Size {
  width: number;
  height: number;
}

/** Загруженный файл изображения: id в `media`, тип и собственный размер в пикселях. */
export interface UploadedImage {
  media: string;
  mime: string;
  natural: Size;
}

/** Наибольшая сторона нового изображения на доске, единицы доски. */
export const IMAGE_MAX_SIDE = 480;

/** Размер нового изображения: пропорции исходника, большая сторона — не больше предела. */
export function fitSize(natural: Size, max = IMAGE_MAX_SIDE): Size {
  const width = Math.max(1, natural.width);
  const height = Math.max(1, natural.height);
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: width * scale, height: height * scale };
}

/**
 * IMG-06: на экране много объектов — не меньше `MANY_OBJECTS` пересекают видимую часть
 * доски `view`; тогда GIF играют только по наведению.
 */
export function manyOnScreen(
  scene: readonly SceneObject[],
  view: Rect,
): boolean {
  let count = 0;
  for (const object of scene) {
    const bounds = boundsOf([object]);
    if (bounds === null || !overlaps(bounds, view)) continue;
    count += 1;
    if (count >= MANY_OBJECTS) return true;
  }
  return false;
}

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/** IMG-01: изображение с центром в `center`; возвращает id. */
export function createImage(
  objects: Y.Map<unknown>,
  center: Point,
  image: UploadedImage,
  actor: string,
): string {
  const size = fitSize(image.natural);
  let id = "";
  transact(objects, () => {
    id = createObject(
      objects,
      IMAGE_TYPE,
      { x: center.x - size.width / 2, y: center.y - size.height / 2 },
      "",
      actor,
      {},
      size,
    );
    const map = objectMap(objects, id);
    if (map === null) return;
    map.set("media", image.media);
    map.set("mime", image.mime);
    map.set("crop", { ...FULL_CROP });
    map.set("mask", "none");
    map.set("flipX", false);
    map.set("flipY", false);
  });
  return id;
}

/** IMG-02, IMG-03: маска и отражение изображений; заблокированные не меняются (CVS-19). */
export function setImageFields(
  objects: Y.Map<unknown>,
  images: readonly SceneObject[],
  fields: Partial<{ mask: ImageMask; flipX: boolean; flipY: boolean }>,
  actor: string,
): void {
  transact(objects, () => {
    for (const image of images) {
      if (image.image === null || image.locked) continue;
      const map = objectMap(objects, image.id);
      if (map === null) continue;
      for (const [key, value] of Object.entries(fields)) map.set(key, value);
      touch(map, actor);
    }
  });
}

/** IMG-03: отразить по горизонтали или вертикали — каждое изображение относительно себя. */
export function flipImages(
  objects: Y.Map<unknown>,
  images: readonly SceneObject[],
  axis: "x" | "y",
  actor: string,
): void {
  transact(objects, () => {
    for (const image of images) {
      if (image.image === null) continue;
      const key = axis === "x" ? "flipX" : "flipY";
      setImageFields(objects, [image], { [key]: !image.image[key] }, actor);
    }
  });
}

/**
 * IMG-02: рамка изображения после обрезки `next`. Исходник остаётся на месте доски:
 * меняются видимая часть и рамка вокруг неё (с учётом поворота вокруг центра).
 */
export function croppedFrame(
  frame: Frame,
  crop: ImageCrop,
  next: ImageCrop,
): Frame {
  const fullWidth = frame.width / crop.width;
  const fullHeight = frame.height / crop.height;
  const width = next.width * fullWidth;
  const height = next.height * fullHeight;
  // Сдвиг центра в системе рамки (без поворота).
  const dx = (next.x - crop.x) * fullWidth + (width - frame.width) / 2;
  const dy = (next.y - crop.y) * fullHeight + (height - frame.height) / 2;
  const angle = (frame.rotation * Math.PI) / 180;
  const cx =
    frame.x + frame.width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle);
  const cy =
    frame.y + frame.height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle);
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    rotation: frame.rotation,
  };
}

/** IMG-02: обрезать изображение — новая видимая часть и рамка одной правкой. */
export function cropImage(
  objects: Y.Map<unknown>,
  image: SceneObject,
  next: ImageCrop,
  actor: string,
): void {
  if (image.image === null || image.locked) return;
  const crop = clampCrop(next);
  const frame = croppedFrame(image, image.image.crop, crop);
  transact(objects, () => {
    patchObjects(
      objects,
      new Map([
        [
          image,
          {
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
          },
        ],
      ]),
      actor,
    );
    objectMap(objects, image.id)?.set("crop", { ...crop });
  });
}

/**
 * IMG-04: заменить файл изображения другим, сохранив обрезку, маску, отражение и
 * оформление. Ширина рамки и центр остаются, высота следует пропорциям нового исходника
 * в той же обрезке.
 */
export function replaceImage(
  objects: Y.Map<unknown>,
  image: SceneObject,
  next: UploadedImage,
  actor: string,
): void {
  if (image.image === null || image.locked) return;
  const { crop } = image.image;
  const ratio =
    (Math.max(1, next.natural.height) * crop.height) /
    (Math.max(1, next.natural.width) * crop.width);
  const height = image.width * ratio;
  transact(objects, () => {
    patchObjects(
      objects,
      new Map([[image, { y: image.y + (image.height - height) / 2, height }]]),
      actor,
    );
    const map = objectMap(objects, image.id);
    map?.set("media", next.media);
    map?.set("mime", next.mime);
  });
}
