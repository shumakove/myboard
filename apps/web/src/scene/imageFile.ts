/**
 * FLP-01: картинка стороны флип-карточки из файла пользователя — уменьшенная копия
 * в виде data URL, которая хранится в документе доски (docs/decisions.md, T6.11).
 */

/** Наибольшая сторона картинки, px. */
export const IMAGE_MAX_SIDE = 640;
/** Предел длины data URL в PNG: больше — перекодируется в JPEG. */
const PNG_LIMIT = 400_000;
const JPEG_QUALITY = 0.85;

/** Файл → data URL не больше `IMAGE_MAX_SIDE` по большей стороне. */
export async function imageToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("not an image");
  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(
      1,
      IMAGE_MAX_SIDE / Math.max(image.width, image.height),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no canvas");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Прозрачность сохраняет PNG; фото и большой PNG — JPEG на белом фоне.
    if (file.type !== "image/jpeg") {
      const png = canvas.toDataURL("image/png");
      if (png.length <= PNG_LIMIT) return png;
    }
    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  } finally {
    image.close();
  }
}
