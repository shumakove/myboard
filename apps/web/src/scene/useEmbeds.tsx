import { useCallback, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import type { Size } from "../canvas/camera";
import { readLinkPreview } from "../media/linkPreviewApi";
import type { Point } from "../realtime/messages";
import { EmbedCodeDialog, LinkCardDialog } from "./EmbedDialogs";
import {
  hostOf,
  parseIframeCode,
  resolveLink,
  type IframeCode,
} from "./embedData";
import { createEmbed, createLinkCard, setObjectLink } from "./embeds";
import type { LinkActions } from "./LinkControls";
import { OBJECT_TYPES } from "./objectTypes";
import { readScene, type SceneObject } from "./sceneObjects";

export type EmbedDialogKind = "iframe" | "linkcard";

/**
 * T7.3: встраивание и ссылки — диалоги Embed (EMB-01) и Link card (EMB-02), код iframe из
 * буфера (EMB-01), ссылка у выделенного объекта (EMB-03).
 */
export function useEmbeds({
  objects,
  boardId,
  units,
  actor,
  clear,
  select,
  pickObject,
}: {
  objects: Y.Map<unknown>;
  boardId: string;
  /** Выделенное (верхние объекты выделения). */
  units: readonly SceneObject[];
  actor: string;
  /** Центр нового объекта, чтобы его кнопки не легли под миникарту. */
  clear: (center: Point, size: Size) => Point;
  select: (ids: string[]) => void;
  /** Выбрать объект этой доски из списка; `null` — выбор отменён. */
  pickObject: (done: (id: string | null) => void) => void;
}): {
  open: (kind: EmbedDialogKind, at: Point) => void;
  /** Текст из буфера — код iframe? Тогда объект поставлен и вернётся `true`. */
  pasteCode: (text: string, at: Point) => boolean;
  actions: LinkActions | null;
  ui: ReactNode;
} {
  const [dialog, setDialog] = useState<{
    kind: EmbedDialogKind;
    at: Point;
  } | null>(null);

  const addEmbed = useCallback(
    (code: IframeCode, at: Point) => {
      const size = {
        width: code.width ?? OBJECT_TYPES.iframe.width,
        height: code.height ?? OBJECT_TYPES.iframe.height,
      };
      select([createEmbed(objects, clear(at, size), code, actor)]);
    },
    [objects, clear, actor, select],
  );

  const pasteCode = useCallback(
    (text: string, at: Point) => {
      const code = parseIframeCode(text);
      if (code === null) return false;
      addEmbed(code, at);
      return true;
    },
    [addEmbed],
  );

  const addCard = async (url: string, at: Point) => {
    const preview = await readLinkPreview(boardId, url);
    const center = clear(at, OBJECT_TYPES.linkcard);
    const id = createLinkCard(
      objects,
      center,
      {
        url,
        // Страница без названия или недоступна — карточка всё равно ведёт по адресу.
        title: preview.title ?? hostOf(url),
        media: preview.image?.id ?? null,
      },
      actor,
    );
    select([id]);
  };

  const [only] = units;
  const single = units.length === 1 && only?.locked === false ? only : null;
  const actions: LinkActions | null =
    single === null
      ? null
      : {
          current: single.link,
          attach: (text) => {
            const ids = new Set(readScene(objects).map((o) => o.id));
            const link = resolveLink(text, (id) => ids.has(id));
            if (link === null) return false;
            setObjectLink(objects, single.id, link, actor);
            return true;
          },
          pickObject: () => {
            pickObject((id) => {
              if (id !== null) {
                setObjectLink(
                  objects,
                  single.id,
                  { kind: "object", id },
                  actor,
                );
              }
            });
          },
          remove: () => {
            setObjectLink(objects, single.id, null, actor);
          },
        };

  const close = () => {
    setDialog(null);
  };
  const ui = (
    <>
      {dialog?.kind === "iframe" && (
        <EmbedCodeDialog
          onClose={close}
          onAdd={(code) => {
            addEmbed(code, dialog.at);
            close();
          }}
        />
      )}
      {dialog?.kind === "linkcard" && (
        <LinkCardDialog
          onClose={close}
          onAdd={async (url) => {
            await addCard(url, dialog.at);
            close();
          }}
        />
      )}
    </>
  );

  return {
    open: useCallback((kind, at) => {
      setDialog({ kind, at });
    }, []),
    pasteCode,
    actions,
    ui,
  };
}
