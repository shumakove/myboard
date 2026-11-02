import type * as Y from "yjs";
import { MINIMAP_SIZE } from "../canvas/minimapFit";
import type { CameraView, Point } from "../realtime/messages";
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
/** Самая узкая панель плеера и аудио: уже элементы управления не помещаются. */
const PLAYER_NARROWEST = 280;
/** Самая узкая панель страниц PDF: две кнопки и номер страницы. */
export const PDF_MIN_WIDTH = 300;
/**
 * Высота кадра и страницы не меньше этой, сколько бы места ни было в виде. Над миникартой
 * самого низкого холста (min-height 320 px) остаётся 194 px: панель плеера и такой кадр входят.
 */
const PICTURE_MIN_HEIGHT = 80;
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

/** Поле между новым объектом и краем вида, px. */
const VIEW_EDGE = 8;
/** Отступ миникарты от края вида и зазор до объекта, px. */
const MINIMAP_CLEARANCE = 12;
/** Верх вида под панелью выделения: одна строка 44 px с полями, px. */
const SELECTION_BAR_CLEARANCE = 68;
const NO_LIMIT: Size = { width: Infinity, height: Infinity };

/**
 * BUG-030, BUG-031, MOB-06, UI-04: сколько единиц доски может занять новый объект, чтобы
 * его кнопки сразу были на экране и не лежали под миникартой. Если объект в центре вида
 * может дотянуться до миникарты по горизонтали, ему доступна высота между панелью
 * выделения и миникартой; встать туда помогает `centerClearOfMinimap`. На самом низком
 * холсте эта высота меньше объекта: минимум кадра важнее панели выделения.
 */
export function roomInView(viewport: Size, zoom: number): Size {
  if (viewport.width === 0 || viewport.height === 0) return NO_LIMIT;
  const reachesMinimap =
    viewport.width / 2 + (VIEW_MAX_SIDE * zoom) / 2 > minimapLeft(viewport);
  return {
    width: (viewport.width - 2 * VIEW_EDGE) / zoom,
    height:
      (reachesMinimap
        ? minimapTop(viewport) - SELECTION_BAR_CLEARANCE
        : viewport.height - 2 * VIEW_EDGE) / zoom,
  };
}

/**
 * BUG-031: центр нового объекта. Объект стоит там, где просили, а если при этом заходит на
 * миникарту — поднимается ровно настолько, чтобы низ с кнопками оказался над ней.
 */
export function centerClearOfMinimap(
  center: Point,
  size: Size,
  camera: CameraView,
  viewport: Size,
): Point {
  if (viewport.width === 0 || viewport.height === 0) return center;
  const { zoom } = camera;
  const right =
    viewport.width / 2 + (center.x - camera.x + size.width / 2) * zoom;
  const bottom =
    viewport.height / 2 + (center.y - camera.y + size.height / 2) * zoom;
  const overlap = bottom - minimapTop(viewport);
  if (right <= minimapLeft(viewport) || overlap <= 0) return center;
  return { x: center.x, y: center.y - overlap / zoom };
}

function minimapLeft(viewport: Size): number {
  return viewport.width - MINIMAP_SIZE.width - MINIMAP_CLEARANCE;
}

function minimapTop(viewport: Size): number {
  return viewport.height - MINIMAP_SIZE.height - MINIMAP_CLEARANCE;
}

/** Рамка объекта PDF: страница и панель страниц под ней, не больше `room`. */
export function pdfFrame(page: Size, room: Size = NO_LIMIT): Size {
  const fitted = fitSize(page, VIEW_MAX_SIDE);
  const pageRoom = Math.max(PICTURE_MIN_HEIGHT, room.height - PDF_BAR_HEIGHT);
  const scale = Math.min(
    1,
    room.width / fitted.width,
    pageRoom / fitted.height,
  );
  return {
    width: Math.max(PDF_MIN_WIDTH, fitted.width * scale),
    height: fitted.height * scale + PDF_BAR_HEIGHT,
  };
}

/**
 * Рамка видео: кадр в пропорциях ролика и панель плеера под ним, не больше `room`.
 * Панель важнее кадра: в рамке уже панели кадр вписывается с полями.
 */
export function videoFrame(natural: Size | null, room: Size = NO_LIMIT): Size {
  const source = natural ?? DEFAULT_VIDEO;
  const scale = VIEW_MAX_SIDE / Math.max(source.width, source.height);
  const width = Math.max(
    PLAYER_NARROWEST,
    Math.min(room.width, Math.max(VIDEO_MIN_WIDTH, source.width * scale)),
  );
  const picture = Math.min(
    (width * source.height) / source.width,
    Math.max(PICTURE_MIN_HEIGHT, room.height - VIDEO_BAR_HEIGHT),
  );
  return { width, height: picture + VIDEO_BAR_HEIGHT };
}

/** Рамка аудио: панель плеера не шире `room`. */
export function audioFrame(room: Size = NO_LIMIT): Size {
  const { width, height } = OBJECT_TYPES.audio;
  return {
    width: Math.max(PLAYER_NARROWEST, Math.min(room.width, width)),
    height,
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
