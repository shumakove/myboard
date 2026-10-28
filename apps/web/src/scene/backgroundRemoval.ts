/**
 * IMG-05: удаление фона изображения в браузере (docs/decisions.md, T7.1). Фон — цвет,
 * который чаще всего встречается по краю картинки; прозрачными становятся пиксели этого
 * цвета (с допуском), связанные с краем. Объект внутри, даже того же цвета, но отделённый
 * от края своим контуром, остаётся.
 */

/** Допуск цвета фона: евклидово расстояние в RGB. */
export const BACKGROUND_TOLERANCE = 48;

/** Пиксель с меньшей непрозрачностью уже считается фоном. */
const TRANSPARENT = 16;

/**
 * Делает фон прозрачным прямо в данных RGBA (`ImageData.data`). Возвращает число
 * очищенных пикселей.
 */
export function clearBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = BACKGROUND_TOLERANCE,
): number {
  const border = borderPixels(width, height);
  const background = dominantColor(data, border);
  const limit = tolerance * tolerance;
  const matches = (pixel: number): boolean => {
    const at = pixel * 4;
    if ((data[at + 3] ?? 0) < TRANSPARENT) return true;
    if (background === null) return false;
    const dr = (data[at] ?? 0) - background[0];
    const dg = (data[at + 1] ?? 0) - background[1];
    const db = (data[at + 2] ?? 0) - background[2];
    return dr * dr + dg * dg + db * db <= limit;
  };

  const seen = new Uint8Array(width * height);
  const stack: number[] = [];
  for (const pixel of border) {
    if (!seen[pixel] && matches(pixel)) {
      seen[pixel] = 1;
      stack.push(pixel);
    }
  }
  let cleared = 0;
  while (stack.length > 0) {
    const pixel = stack.pop() as number;
    data[pixel * 4 + 3] = 0;
    cleared += 1;
    const x = pixel % width;
    const neighbours = [
      x > 0 ? pixel - 1 : -1,
      x < width - 1 ? pixel + 1 : -1,
      pixel - width,
      pixel + width,
    ];
    for (const next of neighbours) {
      if (next < 0 || next >= width * height || seen[next]) continue;
      seen[next] = 1;
      if (matches(next)) stack.push(next);
    }
  }
  return cleared;
}

/** Индексы пикселей по краю картинки. */
function borderPixels(width: number, height: number): number[] {
  const pixels = new Set<number>();
  for (let x = 0; x < width; x++) {
    pixels.add(x);
    pixels.add((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pixels.add(y * width);
    pixels.add(y * width + width - 1);
  }
  return [...pixels];
}

/**
 * Средний цвет самой частой группы непрозрачных пикселей края (группа — цвет с точностью
 * до 16 по каждому каналу). Прозрачных пикселей на краю не меньше — фон уже прозрачный,
 * цвета у него нет: `null`.
 */
function dominantColor(
  data: Uint8ClampedArray,
  pixels: readonly number[],
): [number, number, number] | null {
  const groups = new Map<number, { count: number; sum: number[] }>();
  let transparent = 0;
  for (const pixel of pixels) {
    const at = pixel * 4;
    if ((data[at + 3] ?? 0) < TRANSPARENT) {
      transparent += 1;
      continue;
    }
    const rgb = [data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0];
    const key = ((rgb[0] ?? 0) >> 4) * 256 + ((rgb[1] ?? 0) >> 4) * 16;
    const bucket = key + ((rgb[2] ?? 0) >> 4);
    const group = groups.get(bucket) ?? { count: 0, sum: [0, 0, 0] };
    group.count += 1;
    rgb.forEach((value, i) => {
      group.sum[i] = (group.sum[i] ?? 0) + value;
    });
    groups.set(bucket, group);
  }
  let best: { count: number; sum: number[] } | null = null;
  for (const group of groups.values()) {
    if (best === null || group.count > best.count) best = group;
  }
  if (best === null || transparent >= best.count) return null;
  const { count, sum } = best;
  return [(sum[0] ?? 0) / count, (sum[1] ?? 0) / count, (sum[2] ?? 0) / count];
}
