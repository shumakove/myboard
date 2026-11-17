import type * as Y from "yjs";
import type { Point } from "../realtime/messages";
import type { Size } from "../canvas/camera";
import { IFRAME_TYPE, LINK_CARD_TYPE, type ObjectLink } from "./embedData";
import { placeInFrames } from "./frames";
import { OBJECT_TYPES } from "./objectTypes";
import {
  createObject,
  objectMap,
  readScene,
  touch,
  transact,
} from "./sceneObjects";

/** Встраивание и ссылки (T7.3): постановка объектов и ссылка у объекта. */

/** Карточка без изображения — только название и адрес. */
export const LINK_CARD_PLAIN_HEIGHT = 96;

function place(
  objects: Y.Map<unknown>,
  type: typeof IFRAME_TYPE | typeof LINK_CARD_TYPE,
  center: Point,
  text: string,
  fields: Record<string, unknown>,
  actor: string,
  size: Size,
): string {
  let id = "";
  transact(objects, () => {
    id = createObject(
      objects,
      type,
      { x: center.x - size.width / 2, y: center.y - size.height / 2 },
      text,
      actor,
      {},
      size,
    );
    const map = objectMap(objects, id);
    if (map === null) return;
    for (const [key, value] of Object.entries(fields)) map.set(key, value);
    // FRM-01: новый объект внутри фрейма попадает в него.
    placeInFrames(objects, readScene(objects), [id], actor);
  });
  return id;
}

/** EMB-01: встроенная страница; размер — из кода, иначе размер типа. */
export function createEmbed(
  objects: Y.Map<unknown>,
  center: Point,
  code: { src: string; width: number | null; height: number | null },
  actor: string,
): string {
  const spec = OBJECT_TYPES.iframe;
  return place(objects, IFRAME_TYPE, center, "", { src: code.src }, actor, {
    width: code.width ?? spec.width,
    height: code.height ?? spec.height,
  });
}

/** EMB-02: карточка ссылки; название — текст объекта, его находит поиск по доске (CVS-08). */
export function createLinkCard(
  objects: Y.Map<unknown>,
  center: Point,
  card: { url: string; title: string; media: string | null },
  actor: string,
): string {
  const spec = OBJECT_TYPES.linkcard;
  const fields = card.media === null ? {} : { media: card.media };
  return place(
    objects,
    LINK_CARD_TYPE,
    center,
    card.title,
    { url: card.url, ...fields },
    actor,
    {
      width: spec.width,
      height: card.media === null ? LINK_CARD_PLAIN_HEIGHT : spec.height,
    },
  );
}

/** EMB-03: ссылка у объекта; `null` убирает её. */
export function setObjectLink(
  objects: Y.Map<unknown>,
  id: string,
  link: ObjectLink | null,
  actor: string,
): void {
  transact(objects, () => {
    const map = objectMap(objects, id);
    if (map === null) return;
    map.delete("link");
    map.delete("linkObject");
    if (link?.kind === "url") map.set("link", link.url);
    if (link?.kind === "object") map.set("linkObject", link.id);
    touch(map, actor);
  });
}
