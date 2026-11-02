import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { AttachmentType } from "./attachmentData";
import { fitSize, type Size } from "./images";
import { OBJECT_TYPES } from "./objectTypes";
import {
  createObject,
  objectMap,
  touch,
  transact,
  type SceneObject,
} from "./sceneObjects";

/** Файлы на доске (T7.2): постановка, переименование, извлечение страниц PDF. */

/** Высота панели страниц PDF под страницей, единицы доски. */
export const PDF_BAR_HEIGHT = 56;
/** Высота панели видеоплеера под кадром: две строки элементов управления (UI-04). */
export const VIDEO_BAR_HEIGHT = 112;
/** Наибольшая сторона страницы и кадра на доске; ширина кадра — не меньше панели плеера. */
const VIEW_MAX_SIDE = 480;
const VIDEO_MIN_WIDTH = 420;
/** Кадр по умолчанию, если браузер не прочитал размер ролика. */
const DEFAULT_VIDEO: Size = { width: 640, height: 360 };
/** Промежуток между извлечёнными страницами. */
const PAGE_GAP = 24;

/** Загруженный файл для нового объекта. */
export interface UploadedAttachment {
  media: string;
  mime: string;
  name: string;
  size: number;
  /** FIL-02: страниц в PDF. */
  pages?: number;
  /** FIL-02: номер извлечённой страницы. */
  page?: number;
}

/** Рамка объекта PDF: страница и панель страниц под ней. */
export function pdfFrame(page: Size): Size {
  const fitted = fitSize(page, VIEW_MAX_SIDE);
  return { width: fitted.width, height: fitted.height + PDF_BAR_HEIGHT };
}

/** Рамка видео: кадр в пропорциях ролика и панель плеера под ним. */
export function videoFrame(natural: Size | null): Size {
  const source = natural ?? DEFAULT_VIDEO;
  const scale = VIEW_MAX_SIDE / Math.max(source.width, source.height);
  const width = Math.max(VIDEO_MIN_WIDTH, source.width * scale);
  return {
    width,
    height: (width * source.height) / source.width + VIDEO_BAR_HEIGHT,
  };
}

/** Новый объект файла с центром в `center`; возвращает id. */
export function createAttachment(
  objects: Y.Map<unknown>,
  type: AttachmentType,
  center: Point,
  file: UploadedAttachment,
  actor: string,
  size: Size = OBJECT_TYPES[type],
): string {
  return placeAttachment(
    objects,
    type,
    { x: center.x - size.width / 2, y: center.y - size.height / 2 },
    file,
    actor,
    size,
  );
}

function placeAttachment(
  objects: Y.Map<unknown>,
  type: AttachmentType,
  at: Point,
  file: UploadedAttachment,
  actor: string,
  size: Size,
): string {
  let id = "";
  transact(objects, () => {
    id = createObject(objects, type, at, "", actor, {}, size);
    const map = objectMap(objects, id);
    if (map === null) return;
    for (const [key, value] of Object.entries(file)) map.set(key, value);
  });
  return id;
}

/** FIL-01: новое имя ярлыка; пустое имя не записывается, заблокированный не меняется. */
export function renameAttachment(
  objects: Y.Map<unknown>,
  object: SceneObject,
  name: string,
  actor: string,
): void {
  const next = name.trim();
  if (object.attachment === null || object.locked || next === "") return;
  transact(objects, () => {
    const map = objectMap(objects, object.id);
    if (map === null) return;
    map.set("name", next);
    touch(map, actor);
  });
}

/**
 * FIL-02: выбранные страницы — отдельные объекты правее исходного PDF, по странице на
 * объект; исходный PDF остаётся. Возвращает id новых объектов.
 */
export function extractPdfPages(
  objects: Y.Map<unknown>,
  pdf: SceneObject,
  pages: readonly number[],
  actor: string,
): string[] {
  const source = pdf.attachment;
  if (source === null || pdf.type !== "pdf") return [];
  const chosen = [...new Set(pages)]
    .filter((page) => page >= 1 && page <= source.pages)
    .sort((a, b) => a - b);
  const size = {
    width: pdf.width,
    height: Math.max(1, pdf.height - PDF_BAR_HEIGHT),
  };
  const ids: string[] = [];
  transact(objects, () => {
    for (const [index, page] of chosen.entries()) {
      ids.push(
        placeAttachment(
          objects,
          "pdf",
          { x: pdf.x + (pdf.width + PAGE_GAP) * (index + 1), y: pdf.y },
          {
            media: source.media,
            mime: source.mime,
            name: source.name,
            size: source.size,
            pages: source.pages,
            page,
          },
          actor,
          size,
        ),
      );
    }
  });
  return ids;
}
