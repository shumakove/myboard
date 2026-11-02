/**
 * Изображение (T7.1) в документе — поля `Y.Map` объекта `type: "image"`:
 * - `media` — id файла модуля `media`; сам файл — `/api/media/{id}` (IMG-01, IMG-07);
 * - `mime` — тип файла: GIF воспроизводится по наведению при многих объектах (IMG-06);
 * - `crop` — видимая часть исходника `{x, y, width, height}` в долях 0…1 (IMG-02, IMG-04);
 * - `mask` — форма маски (IMG-02), `flipX`, `flipY` — отражение (IMG-03);
 * - оформление `stroke`, `strokeWidth` — обводка (IMG-03), `radius` — скругление (IMG-02).
 * Каждое поле — свой ключ `Y.Map`: одновременные правки разных свойств сливаются.
 */

export const IMAGE_TYPE = "image";

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const FULL_CROP: ImageCrop = { x: 0, y: 0, width: 1, height: 1 };

/** Наименьшая видимая часть исходника по каждой оси — доля. */
export const MIN_CROP = 0.02;

export type ImageMask =
  "none" | "circle" | "triangle" | "diamond" | "hexagon" | "star";

export interface ImageShape {
  media: string;
  mime: string;
  crop: ImageCrop;
  mask: ImageMask;
  flipX: boolean;
  flipY: boolean;
}

/** Типы, которые принимает сервер (`app/media/service.py`, `ALLOWED_TYPES`). */
export const IMAGE_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
];

export function isImageType(mime: string): boolean {
  return IMAGE_TYPES.includes(mime.toLowerCase());
}

/**
 * IMG-06: столько объектов в видимой части доски и больше — GIF стоит на первом кадре
 * и воспроизводится по наведению (docs/decisions.md, T7.1).
 */
export const MANY_OBJECTS = 30;

/** IMG-02: маски — CSS `clip-path` и контур обводки в рамке 0…100. */
export const MASKS: readonly {
  value: ImageMask;
  label: string;
  points: string | null;
}[] = [
  { value: "none", label: "None", points: null },
  { value: "circle", label: "Circle", points: null },
  { value: "triangle", label: "Triangle", points: "50,0 100,100 0,100" },
  { value: "diamond", label: "Diamond", points: "50,0 100,50 50,100 0,50" },
  {
    value: "hexagon",
    label: "Hexagon",
    points: "25,0 75,0 100,50 75,100 25,100 0,50",
  },
  {
    value: "star",
    label: "Star",
    points:
      "50,0 61.8,35.1 98.6,35.1 68.8,56.8 80.2,91.9 50,70.2 19.8,91.9 31.2,56.8 1.4,35.1 38.2,35.1",
  },
];

/** CSS `clip-path` маски; без маски — `undefined`. */
export function maskClipPath(mask: ImageMask): string | undefined {
  if (mask === "circle") return "ellipse(50% 50% at 50% 50%)";
  const points = MASKS.find((m) => m.value === mask)?.points;
  if (points == null) return undefined;
  const pairs = points.split(" ").map((pair) =>
    pair
      .split(",")
      .map((v) => `${v}%`)
      .join(" "),
  );
  return `polygon(${pairs.join(", ")})`;
}

const MEDIA_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Адрес файла модуля `media`; чужие адреса в документе не загружаются. */
export function mediaUrl(id: string): string | null {
  return MEDIA_ID.test(id) ? `/api/media/${id}` : null;
}

export function readImage(record: Record<string, unknown>): ImageShape {
  const mask = MASKS.find((m) => m.value === record.mask)?.value ?? "none";
  return {
    media: typeof record.media === "string" ? record.media : "",
    mime: typeof record.mime === "string" ? record.mime : "",
    crop: readCrop(record.crop),
    mask,
    flipX: record.flipX === true,
    flipY: record.flipY === true,
  };
}

/** Обрезка в границах исходника; испорченная запись — весь исходник. */
export function readCrop(value: unknown): ImageCrop {
  if (typeof value !== "object" || value === null) return FULL_CROP;
  const { x, y, width, height } = value as Record<string, unknown>;
  if (![x, y, width, height].every(isNumber)) return FULL_CROP;
  return clampCrop({
    x: x as number,
    y: y as number,
    width: width as number,
    height: height as number,
  });
}

/** Обрезка внутри 0…1 и не меньше `MIN_CROP` по каждой оси. */
export function clampCrop(crop: ImageCrop): ImageCrop {
  const width = clamp(crop.width, MIN_CROP, 1);
  const height = clamp(crop.height, MIN_CROP, 1);
  return {
    x: clamp(crop.x, 0, 1 - width),
    y: clamp(crop.y, 0, 1 - height),
    width,
    height,
  };
}

/**
 * Обрезка в системе показа: у отражённого изображения видимая часть зеркальна части
 * исходника. Преобразование обратно — то же самое.
 */
export function viewCrop(crop: ImageCrop, image: ImageShape): ImageCrop {
  return {
    ...crop,
    x: image.flipX ? 1 - crop.x - crop.width : crop.x,
    y: image.flipY ? 1 - crop.y - crop.height : crop.y,
  };
}

/** IMG-03: CSS-преобразование отражения; без отражения — `undefined`. */
export function flipTransform(image: ImageShape): string | undefined {
  if (!image.flipX && !image.flipY) return undefined;
  return `scale(${image.flipX ? "-1" : "1"}, ${image.flipY ? "-1" : "1"})`;
}

/** Что тянут при обрезке: сторону или угол рамки обрезки, либо её целиком. */
export type CropHandle =
  "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se" | "move";

/**
 * IMG-02: обрезка после протяжки `handle` на `dx`, `dy` долей исходника. Противоположные
 * стороны остаются на месте; рамка не выходит за исходник и не меньше `MIN_CROP`.
 */
export function dragCrop(
  start: ImageCrop,
  handle: CropHandle,
  dx: number,
  dy: number,
): ImageCrop {
  if (handle === "move") {
    return clampCrop({ ...start, x: start.x + dx, y: start.y + dy });
  }
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("w")) left = clamp(left + dx, 0, right - MIN_CROP);
  if (handle.includes("e")) right = clamp(right + dx, left + MIN_CROP, 1);
  if (handle.includes("n")) top = clamp(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes("s")) bottom = clamp(bottom + dy, top + MIN_CROP, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
