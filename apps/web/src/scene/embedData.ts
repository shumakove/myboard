/**
 * Встраивание и ссылки (T7.3) в документе — поля `Y.Map` объекта:
 * - `iframe`: `src` — адрес встроенной страницы (EMB-01);
 * - `linkcard`: `url` — адрес, `text` — название страницы, `media` — её изображение, файл
 *   этой доски (EMB-02);
 * - у любого объекта: `link` — внешний адрес или `linkObject` — id объекта этой доски (EMB-03).
 *
 * Документ пишут все участники, поэтому адрес проверяется при каждом чтении: строка
 * с другой схемой (`javascript:`) до `src` и `href` не доходит.
 */

export const IFRAME_TYPE = "iframe";
export const LINK_CARD_TYPE = "linkcard";

export interface EmbedShape {
  /** `null` — в документе нет допустимого адреса. */
  src: string | null;
}

export interface LinkCardShape {
  url: string | null;
  /** Id файла изображения или `null`. */
  media: string | null;
}

/** EMB-03: куда ведёт ссылка объекта. */
export type ObjectLink =
  { kind: "url"; url: string } | { kind: "object"; id: string };

/** Код iframe, разобранный до того, что нужно объекту. */
export interface IframeCode {
  src: string;
  width: number | null;
  height: number | null;
}

/** Границы размера нового объекта из атрибутов кода, единицы доски. */
const CODE_MIN_SIDE = 120;
const CODE_MAX_SIDE = 1600;

/** Самый длинный принимаемый адрес (как `LinkPreviewIn` на сервере). */
export const URL_MAX_LENGTH = 2048;

/** Адрес http(s) в нормальной записи; всё остальное — `null`. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > URL_MAX_LENGTH) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Адрес из поля ввода: `example.com` читается как `https://example.com`. */
export function typedUrl(text: string): string | null {
  const value = text.trim();
  if (value === "") return null;
  return webUrl(
    /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`,
  );
}

/** Имя хоста для подписи; адрес — уже проверенный. */
export function hostOf(url: string): string {
  return new URL(url).host;
}

function codeSide(value: string | null): number | null {
  if (value === null || !/^\d+(px)?$/i.test(value.trim())) return null;
  const side = Number.parseInt(value, 10);
  return Math.min(Math.max(side, CODE_MIN_SIDE), CODE_MAX_SIDE);
}

/**
 * EMB-01: код вида `<iframe src="https://…" width="…" height="…"></iframe>`. Разбор — через
 * `DOMParser`: документ инертен, ничего не загружается и не исполняется. От кода берутся
 * только адрес и размер; другой текст, адрес не http(s) — `null`.
 */
export function parseIframeCode(code: string): IframeCode | null {
  if (!/^\s*<iframe[\s>]/i.test(code)) return null;
  const { body, head } = new DOMParser().parseFromString(code, "text/html");
  const [frame, ...others] = [...body.querySelectorAll("iframe")];
  if (frame === undefined || others.length > 0 || head.childElementCount > 0) {
    return null;
  }
  frame.remove();
  if (body.childElementCount > 0 || body.textContent.trim() !== "") return null;
  const src = webUrl(frame.getAttribute("src"));
  return src === null
    ? null
    : {
        src,
        width: codeSide(frame.getAttribute("width")),
        height: codeSide(frame.getAttribute("height")),
      };
}

export function readEmbed(record: Record<string, unknown>): EmbedShape {
  return { src: webUrl(record.src) };
}

export function readLinkCard(record: Record<string, unknown>): LinkCardShape {
  return {
    url: webUrl(record.url),
    media: typeof record.media === "string" ? record.media : null,
  };
}

export function readObjectLink(
  record: Record<string, unknown>,
): ObjectLink | null {
  if (typeof record.linkObject === "string" && record.linkObject !== "") {
    return { kind: "object", id: record.linkObject };
  }
  const url = webUrl(record.link);
  return url === null ? null : { kind: "url", url };
}

/**
 * EMB-03: что ввёл участник. Ссылка на объект этой доски (SHR-07) становится переходом к нему:
 * адрес того же сайта с `?object={id}`, и такой объект на доске есть. Токен в ссылке не
 * запоминается: после сброса ссылки переход работает.
 */
export function resolveLink(
  text: string,
  hasObject: (id: string) => boolean,
  origin: string = window.location.origin,
): ObjectLink | null {
  const url = typedUrl(text);
  if (url === null) return null;
  const parsed = new URL(url);
  const id = parsed.searchParams.get("object");
  return parsed.origin === origin && id !== null && hasObject(id)
    ? { kind: "object", id }
    : { kind: "url", url };
}
