import { useCallback, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import { probeVideo } from "../media/mediaProbe";
import { uploadMedia, UploadError, type Media } from "../media/mediaApi";
import { readPdf } from "../media/pdfDocument";
import type { RunFileTask } from "../media/useFileTask";
import type { Size } from "../canvas/camera";
import type { Point } from "../realtime/messages";
import {
  classifyFile,
  downloadUrl,
  GENERIC_TYPE,
  type AttachmentType,
} from "./attachmentData";
import {
  audioFrame,
  createAttachment,
  extractPdfPages,
  pdfFrame,
  renameAttachment,
  videoFrame,
  type UploadedAttachment,
} from "./attachments";
import type { FileActions } from "./FileControls";
import { OBJECT_TYPES } from "./objectTypes";
import { PdfExtractDialog } from "./PdfExtractDialog";
import { readScene, type SceneObject } from "./sceneObjects";

const BAD_PDF = "This PDF could not be opened.";

/** Сдвиг каждого следующего файла, если их загрузили несколько сразу. */
const CASCADE = 24;

/**
 * T7.2: файлы на доске — инструмент File: PDF, видео и аудио своими объектами, всё
 * остальное — ярлыком (FIL-01…FIL-04), действия панели выделения (FIL-01, FIL-02).
 */
export function useFiles({
  objects,
  boardId,
  units,
  actor,
  room,
  clear,
  reveal,
  fit,
  select,
  run,
}: {
  objects: Y.Map<unknown>;
  boardId: string;
  /** Выделенное (верхние объекты выделения). */
  units: readonly SceneObject[];
  actor: string;
  /** Сколько места в виде занять новому объекту (BUG-030). */
  room: () => Size;
  /** Центр нового объекта, чтобы его кнопки не легли под миникарту (BUG-031). */
  clear: (center: Point, size: Size) => Point;
  /** Показать холст целиком: страница телефона могла быть прокручена (BUG-031). */
  reveal: () => void;
  /** Показать этому клиенту новый объект по его виду (BUG-032). */
  fit: (id: string, stored: Size, shown: Size) => void;
  select: (ids: string[]) => void;
  run: RunFileTask;
}): {
  /** Открыть выбор файла; файлы встанут с центром в `at`. */
  pick: (at: Point) => void;
  actions: FileActions | null;
  /** Скрытое поле выбора файла и диалог страниц PDF. */
  ui: ReactNode;
} {
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Point>({ x: 0, y: 0 });
  const [extracting, setExtracting] = useState<string | null>(null);

  const place = useCallback(
    async (file: File, at: Point): Promise<string> => {
      // BUG-032: размер в документе не зависит от экрана, по виду — только показ.
      const put = (
        kind: AttachmentType,
        source: UploadedAttachment,
        size: Size = OBJECT_TYPES[kind],
        shown: Size = size,
      ) => {
        const id = createAttachment(
          objects,
          kind,
          clear(at, shown),
          source,
          actor,
          size,
          shown,
        );
        fit(id, size, shown);
        return id;
      };

      const { type, mime } = classifyFile(file);
      if (type === "pdf") {
        const info = await readPdf(file).catch(() => {
          throw new UploadError(0, BAD_PDF);
        });
        const media = await uploadMedia(boardId, file, file.name, mime);
        return put(
          "pdf",
          { ...uploaded(media), pages: info.pages },
          pdfFrame(info.page),
          pdfFrame(info.page, room()),
        );
      }
      if (type === "video") {
        const probe = await probeVideo(file);
        const media = await uploadMedia(boardId, file, file.name, mime);
        // FIL-04: в `.webm` может не быть кадра — тогда это аудио.
        return probe !== null && probe.width === 0
          ? put("audio", uploaded(media), audioFrame(), audioFrame(room()))
          : put(
              "video",
              uploaded(media),
              videoFrame(probe),
              videoFrame(probe, room()),
            );
      }
      if (type === "audio") {
        const media = await uploadMedia(boardId, file, file.name, mime);
        return put("audio", uploaded(media), audioFrame(), audioFrame(room()));
      }
      const media = await uploadMedia(
        boardId,
        file,
        file.name,
        GENERIC_TYPE,
        "file",
      );
      return put(type, uploaded(media));
    },
    [objects, boardId, actor, room, clear, fit],
  );

  const insert = useCallback(
    (files: readonly File[], at: Point) => {
      if (files.length === 0) return;
      void run("Uploading file…", async () => {
        const ids: string[] = [];
        let failure: UploadError | null = null;
        for (const [index, file] of files.entries()) {
          const shift = index * CASCADE;
          try {
            ids.push(await place(file, { x: at.x + shift, y: at.y + shift }));
          } catch (error) {
            failure =
              error instanceof UploadError
                ? error
                : new UploadError(0, "The upload failed. Try again.");
          }
        }
        if (ids.length > 0) {
          select(ids);
          reveal();
        }
        if (failure !== null) throw failure;
      });
    },
    [run, place, select, reveal],
  );

  const pick = useCallback((at: Point) => {
    target.current = at;
    input.current?.click();
  }, []);

  const fileActions = (object: SceneObject): FileActions | null => {
    const file = object.attachment;
    if (file === null) return null;
    if (object.type === "file") {
      return {
        name: file.name,
        rename: object.locked
          ? null
          : (name) => {
              renameAttachment(objects, object, name, actor);
            },
        download: downloadUrl(file.media, file.name),
        extract: null,
      };
    }
    if (object.type === "pdf" && file.page === null && !object.locked) {
      return {
        name: file.name,
        rename: null,
        download: null,
        extract: () => {
          setExtracting(object.id);
        },
      };
    }
    return null;
  };

  const [only] = units;
  const single = units.length === 1 ? only : undefined;
  const source = single?.id === extracting ? single : undefined;
  const ui = (
    <>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        aria-label="Upload file"
        onChange={(event) => {
          const field = event.currentTarget;
          const files = [...(field.files ?? [])];
          field.value = "";
          insert(files, target.current);
        }}
      />
      {source?.attachment != null && (
        <PdfExtractDialog
          pages={source.attachment.pages}
          onClose={() => {
            setExtracting(null);
          }}
          onExtract={(pages) => {
            setExtracting(null);
            // BUG-032: размер страниц — из документа, а не показанный этому клиенту.
            const stored = readScene(objects).find((o) => o.id === source.id);
            select(extractPdfPages(objects, stored ?? source, pages, actor));
          }}
        />
      )}
    </>
  );

  return {
    pick,
    actions: single === undefined ? null : fileActions(single),
    ui,
  };
}

function uploaded(media: Media): UploadedAttachment {
  return {
    media: media.id,
    mime: media.mime,
    name: media.name,
    size: media.size,
  };
}
