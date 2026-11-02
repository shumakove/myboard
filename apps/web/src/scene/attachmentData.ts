import { mediaUrl } from "./imageData";

/**
 * Файлы на доске (T7.2) в документе — поля `Y.Map` объекта одного из типов `file`, `pdf`,
 * `video`, `audio`:
 * - `media` — id файла модуля `media`, `mime` — его объявленный тип;
 * - `name` — имя на доске, у ярлыка его можно изменить (FIL-01), `size` — размер в байтах;
 * - `pages` — число страниц PDF; `page` — у страницы, извлечённой из PDF, её номер (FIL-02).
 * Открытая страница PDF и состояние плеера в документ не входят: они свои у каждого
 * участника (FIL-05, docs/decisions.md, T7.2).
 */

export type AttachmentType = "file" | "pdf" | "video" | "audio";

export function isAttachmentType(type: string): type is AttachmentType {
  return (
    type === "file" || type === "pdf" || type === "video" || type === "audio"
  );
}

export interface AttachmentShape {
  media: string;
  mime: string;
  name: string;
  size: number;
  pages: number;
  /** Извлечённая страница (нумерация с 1); у PDF целиком и других типов — `null`. */
  page: number | null;
}

/** FIL-01: тип ярлыка — сервер принимает его только с `kind=file` и не показывает файл. */
export const GENERIC_TYPE = "application/octet-stream";

/** Самое длинное имя файла на сервере (`app/media/models.py`, `NAME_MAX_LENGTH`). */
export const NAME_MAX_LENGTH = 255;

const PDF_MIME = "application/pdf";

/**
 * Типы, которые принимает сервер (`app/media/service.py`): FIL-03 — mp4, m4v, mov, webm;
 * FIL-04 — mp3, m4a, wav, webm. Варианты — то, что объявляют браузеры и системы.
 */
const VIDEO_TYPES: readonly string[] = [
  "video/mp4",
  "video/x-m4v",
  "video/quicktime",
  "video/webm",
];
const AUDIO_TYPES: readonly string[] = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/webm",
];

/** Тип по расширению: система может не знать тип файла и объявить пустой. */
const BY_EXTENSION: Readonly<Record<string, string>> = {
  pdf: PDF_MIME,
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
};

function objectTypeOf(mime: string): AttachmentType | null {
  if (mime === PDF_MIME) return "pdf";
  if (VIDEO_TYPES.includes(mime)) return "video";
  if (AUDIO_TYPES.includes(mime)) return "audio";
  return null;
}

/**
 * Каким объектом станет файл и с каким типом он загружается: PDF, видео и аудио из списка
 * требований — своими объектами, всё остальное — ярлыком (FIL-01).
 */
export function classifyFile(file: { name: string; type: string }): {
  type: AttachmentType;
  mime: string;
} {
  const declared = file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime =
    objectTypeOf(declared) !== null ? declared : BY_EXTENSION[extension];
  const type = mime === undefined ? null : objectTypeOf(mime);
  return mime === undefined || type === null
    ? { type: "file", mime: GENERIC_TYPE }
    : { type, mime };
}

/** FIL-01: адрес скачивания файла под именем с доски. */
export function downloadUrl(media: string, name: string): string | null {
  const url = mediaUrl(media);
  return url === null
    ? null
    : `${url}?${new URLSearchParams({ download: name }).toString()}`;
}

/** Размер файла для ярлыка: `820 KB`. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 ** 2) return `${String(Math.round(bytes / 1024))} KB`;
  const [value, unit] =
    bytes < 1024 ** 3 ? [bytes / 1024 ** 2, "MB"] : [bytes / 1024 ** 3, "GB"];
  return `${String(Math.round(value * 10) / 10)} ${unit}`;
}

export function readAttachment(
  record: Record<string, unknown>,
): AttachmentShape {
  return {
    media: typeof record.media === "string" ? record.media : "",
    mime: typeof record.mime === "string" ? record.mime : "",
    name: typeof record.name === "string" ? record.name : "",
    size: positive(record.size) ?? 0,
    pages: positive(record.pages) ?? 1,
    page: positive(record.page),
  };
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}
