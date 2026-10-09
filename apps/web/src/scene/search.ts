import type { SceneObject } from "./sceneObjects";

/** Найденный объект: отрывок текста вокруг совпадения и совпавшие теги. */
export interface SearchHit {
  object: SceneObject;
  /** Отрывок текста с совпадением; пустой, если совпали только теги. */
  snippet: string;
  tags: string[];
}

/** Длина отрывка текста в списке результатов, символов. */
const SNIPPET_LENGTH = 80;
/** Сколько символов показать перед совпадением. */
const SNIPPET_LEAD = 24;

/**
 * CVS-08: поиск по тексту объектов уже загруженного документа и по их тегам, без учёта
 * регистра. Запрос с «#» в начале ищет только по тегам. Результаты — в порядке чтения
 * доски: сверху вниз, слева направо.
 */
export function searchScene(
  scene: readonly SceneObject[],
  query: string,
): SearchHit[] {
  const trimmed = query.trim();
  const tagsOnly = trimmed.startsWith("#");
  const needle = normalize(tagsOnly ? trimmed.slice(1) : trimmed);
  if (needle === "") return [];

  const hits: SearchHit[] = [];
  for (const object of scene) {
    const text = flatten(object.text);
    const at = tagsOnly ? -1 : normalize(text).indexOf(needle);
    const tags = object.tags.filter((tag) =>
      normalize(stripHash(tag)).includes(needle),
    );
    if (at < 0 && tags.length === 0) continue;
    hits.push({
      object,
      snippet: at < 0 ? "" : snippet(text, at),
      tags,
    });
  }
  return hits.sort(
    (a, b) => a.object.y - b.object.y || a.object.x - b.object.x,
  );
}

function normalize(value: string): string {
  return value.toLocaleLowerCase();
}

function stripHash(tag: string): string {
  return tag.startsWith("#") ? tag.slice(1) : tag;
}

/** Текст объекта одной строкой: переводы строк и пробелы подряд — один пробел. */
function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Отрывок текста, в котором видно совпадение с позиции `at`. */
function snippet(text: string, at: number): string {
  if (text.length <= SNIPPET_LENGTH) return text;
  const start = Math.max(
    0,
    Math.min(at - SNIPPET_LEAD, text.length - SNIPPET_LENGTH),
  );
  const part = text.slice(start, start + SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${part}${start + SNIPPET_LENGTH < text.length ? "…" : ""}`;
}
