import { useCallback, useRef, useState, type ReactNode } from "react";
import type * as Y from "yjs";
import { uploadMedia, UploadError } from "../media/mediaApi";
import type { Point } from "../realtime/messages";
import { Button, FloatingPanel } from "../ui";
import type { ImageActions } from "./ImageControls";
import { ImageCropOverlay } from "./ImageCropOverlay";
import { IMAGE_TYPES, isImageType, mediaUrl } from "./imageData";
import {
  createImage,
  cropImage,
  flipImages,
  replaceImage,
  setImageFields,
  type UploadedImage,
} from "./images";
import { naturalSize, withoutBackground } from "./imageSource";
import { readScene, type SceneObject } from "./sceneObjects";

const NOT_AN_IMAGE = "This file is not an image that can be shown.";
const UNSUPPORTED =
  "This file type is not supported. Use PNG, JPEG, GIF, WebP or SVG.";

/** Сдвиг каждого следующего изображения, если их вставили несколько сразу. */
const CASCADE = 24;

type Status = { kind: "busy" | "error"; text: string } | null;

/**
 * T7.1: изображения на доске — загрузка из файла и из буфера (IMG-01, IMG-07), действия
 * панели выделения (IMG-02…IMG-05), обрезка на холсте (IMG-02), строка состояния загрузки.
 */
export function useImages({
  objects,
  boardId,
  units,
  actor,
  zoom,
  select,
}: {
  objects: Y.Map<unknown>;
  boardId: string;
  /** Выделенное (верхние объекты выделения). */
  units: readonly SceneObject[];
  actor: string;
  zoom: number;
  select: (ids: string[]) => void;
}): {
  /** Открыть выбор файла; изображения встанут с центром в `at`. */
  pick: (at: Point) => void;
  /** Вставить файлы изображений (буфер обмена) с центром в `at`. */
  insert: (files: readonly File[], at: Point) => void;
  actions: ImageActions | null;
  /** Слой обрезки поверх объектов доски. */
  overlay: ReactNode;
  /** Скрытое поле выбора файла и строка состояния. */
  ui: ReactNode;
} {
  const [status, setStatus] = useState<Status>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Point>({ x: 0, y: 0 });

  /** Проверить и загрузить файл; собственный размер — до загрузки. */
  const upload = useCallback(
    async (file: Blob, name: string): Promise<UploadedImage> => {
      const mime = file.type.toLowerCase();
      if (!isImageType(mime)) throw new UploadError(415, UNSUPPORTED);
      const natural = await naturalSize(file).catch(() => {
        throw new UploadError(0, NOT_AN_IMAGE);
      });
      const media = await uploadMedia(boardId, file, name, mime);
      return { media: media.id, mime: media.mime, natural };
    },
    [boardId],
  );

  /** Долгое действие с файлом: строка «идёт», затем ошибка или ничего. */
  const run = useCallback(async (text: string, work: () => Promise<void>) => {
    setStatus({ kind: "busy", text });
    try {
      await work();
      setStatus(null);
    } catch (error) {
      setStatus({
        kind: "error",
        text: error instanceof UploadError ? error.message : NOT_AN_IMAGE,
      });
    }
  }, []);

  const insert = useCallback(
    (files: readonly File[], at: Point) => {
      if (files.length === 0) return;
      void run("Uploading image…", async () => {
        const ids: string[] = [];
        let failure: Error | null = null;
        for (const [index, file] of files.entries()) {
          try {
            const image = await upload(file, file.name);
            const shift = index * CASCADE;
            ids.push(
              createImage(
                objects,
                { x: at.x + shift, y: at.y + shift },
                image,
                actor,
              ),
            );
          } catch (error) {
            failure =
              error instanceof Error ? error : new UploadError(0, NOT_AN_IMAGE);
          }
        }
        if (ids.length > 0) select(ids);
        if (failure !== null) throw failure;
      });
    },
    [run, upload, objects, actor, select],
  );

  const pick = useCallback((at: Point) => {
    target.current = at;
    input.current?.click();
  }, []);

  const images = units.filter((o) => o.image !== null && !o.locked);
  const [single] = images;
  /** Свежий объект документа: его могли изменить другие участники. */
  const fresh = (id: string) => readScene(objects).find((o) => o.id === id);
  const busy = status?.kind === "busy";
  const croppingId =
    images.length === 1 && single?.id === cropping ? cropping : null;

  const actions: ImageActions | null =
    images.length === 0
      ? null
      : {
          mask: images.every((o) => o.image?.mask === single?.image?.mask)
            ? (single?.image?.mask ?? null)
            : null,
          setMask: (mask) => {
            setImageFields(objects, images, { mask }, actor);
          },
          flip: (axis) => {
            flipImages(objects, images, axis, actor);
          },
          single:
            images.length === 1 && single !== undefined
              ? {
                  cropping: croppingId !== null,
                  toggleCrop: () => {
                    setCropping(croppingId === null ? single.id : null);
                  },
                  busy,
                  replace: (file) => {
                    void run("Uploading image…", async () => {
                      const image = await upload(file, file.name);
                      const current = fresh(single.id);
                      if (current !== undefined)
                        replaceImage(objects, current, image, actor);
                    });
                  },
                  removeBackground: () => {
                    const src = mediaUrl(single.image?.media ?? "");
                    if (src === null) return;
                    void run("Removing background…", async () => {
                      const result = await withoutBackground(src).catch(() => {
                        throw new UploadError(0, NOT_AN_IMAGE);
                      });
                      const media = await uploadMedia(
                        boardId,
                        result.blob,
                        "background-removed.png",
                        "image/png",
                      );
                      const current = fresh(single.id);
                      if (current === undefined) return;
                      replaceImage(
                        objects,
                        current,
                        {
                          media: media.id,
                          mime: media.mime,
                          natural: result.size,
                        },
                        actor,
                      );
                    });
                  },
                }
              : null,
        };

  const croppedImage = croppingId !== null ? single : undefined;
  const overlay =
    croppedImage?.image != null ? (
      <ImageCropOverlay
        object={croppedImage}
        image={croppedImage.image}
        zoom={zoom}
        onCrop={(crop) => {
          const current = fresh(croppedImage.id);
          if (current !== undefined) cropImage(objects, current, crop, actor);
        }}
      />
    ) : null;

  const ui = (
    <>
      <input
        ref={input}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        multiple
        hidden
        aria-label="Upload image"
        onChange={(event) => {
          const field = event.currentTarget;
          const files = [...(field.files ?? [])];
          field.value = "";
          insert(files, target.current);
        }}
      />
      {status !== null && (
        <FloatingPanel
          role={status.kind === "error" ? "alert" : "status"}
          className="board-notice"
        >
          {status.text}
          {status.kind === "error" && (
            <Button
              variant="ghost"
              onClick={() => {
                setStatus(null);
              }}
            >
              Dismiss
            </Button>
          )}
        </FloatingPanel>
      )}
    </>
  );

  return { pick, insert, actions, overlay, ui };
}
