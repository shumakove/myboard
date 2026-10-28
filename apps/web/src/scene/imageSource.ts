import { clearBackground } from "./backgroundRemoval";
import type { Size } from "./images";

/** Размер SVG без собственных размеров (только `viewBox` или ничего). */
export const SVG_FALLBACK: Size = { width: 300, height: 300 };

/** Наибольшая сторона картинки, из которой убирают фон (IMG-05), пиксели. */
const RASTER_MAX_SIDE = 2048;

/** Картинка из адреса, загруженная браузером. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("The image cannot be shown."));
    };
    image.src = src;
  });
}

function sizeOf(image: HTMLImageElement): Size {
  return image.naturalWidth > 0 && image.naturalHeight > 0
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : SVG_FALLBACK;
}

/**
 * IMG-01, IMG-07: собственный размер файла изображения в пикселях; файл, который браузер
 * не может показать, — ошибка (до загрузки на сервер).
 */
export async function naturalSize(file: Blob): Promise<Size> {
  const url = URL.createObjectURL(file);
  try {
    return sizeOf(await loadImage(url));
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * IMG-05: копия изображения по адресу `src` без фона — PNG с прозрачностью. GIF теряет
 * анимацию (берётся первый кадр), SVG растрируется в своём размере.
 */
export async function withoutBackground(
  src: string,
): Promise<{ blob: Blob; size: Size }> {
  const image = await loadImage(src);
  const natural = sizeOf(image);
  const scale = Math.min(
    1,
    RASTER_MAX_SIDE / Math.max(natural.width, natural.height),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(natural.width * scale));
  canvas.height = Math.max(1, Math.round(natural.height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("The image cannot be processed.");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  clearBackground(pixels.data, canvas.width, canvas.height);
  context.putImageData(pixels, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (blob === null) throw new Error("The image cannot be processed.");
  return { blob, size: { width: canvas.width, height: canvas.height } };
}
