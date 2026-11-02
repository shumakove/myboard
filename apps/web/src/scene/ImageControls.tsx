import { useRef } from "react";
import { Button, SelectField } from "../ui";
import { IMAGE_TYPES, MASKS, type ImageMask } from "./imageData";

/** Действия с одним выделенным изображением. */
export interface SingleImageActions {
  /** IMG-02: идёт обрезка на холсте. */
  cropping: boolean;
  toggleCrop: () => void;
  /** IMG-04: заменить файл, сохранив обрезку. */
  replace: (file: File) => void;
  /** IMG-05: убрать фон. */
  removeBackground: () => void;
  /** Идёт загрузка или обработка: кнопки файла недоступны. */
  busy: boolean;
}

/** Действия с выделенными изображениями (T7.1). */
export interface ImageActions {
  /** Общая маска выделенных; разные — `null`. */
  mask: ImageMask | null;
  setMask: (mask: ImageMask) => void;
  /** IMG-03: отразить по горизонтали (`x`) или вертикали (`y`). */
  flip: (axis: "x" | "y") => void;
  single: SingleImageActions | null;
}

/**
 * Панель изображения в панели выделения: маска (IMG-02), отражение (IMG-03); у одного
 * изображения — Crop (IMG-02), Replace (IMG-04) и Remove background (IMG-05). Обводка
 * и скругление углов — общие свойства оформления панели (Border, Border width, Corners).
 */
export function ImageControls({ image }: { image: ImageActions }) {
  const { single } = image;
  return (
    <span role="group" aria-label="Image" className="selection-mindmap">
      <SelectField
        label="Mask"
        value={image.mask ?? ""}
        onChange={(event) => {
          image.setMask(event.target.value as ImageMask);
        }}
      >
        {image.mask === null && <option value="">Mixed</option>}
        {MASKS.map((mask) => (
          <option key={mask.value} value={mask.value}>
            {mask.label}
          </option>
        ))}
      </SelectField>
      <Button
        variant="ghost"
        onClick={() => {
          image.flip("x");
        }}
      >
        Flip horizontal
      </Button>
      <Button
        variant="ghost"
        onClick={() => {
          image.flip("y");
        }}
      >
        Flip vertical
      </Button>
      {single && <SingleControls single={single} />}
    </span>
  );
}

function SingleControls({ single }: { single: SingleImageActions }) {
  const file = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        variant="ghost"
        aria-pressed={single.cropping}
        onClick={single.toggleCrop}
      >
        {single.cropping ? "Done cropping" : "Crop"}
      </Button>
      <Button
        variant="ghost"
        disabled={single.busy}
        onClick={() => {
          file.current?.click();
        }}
      >
        Replace image
      </Button>
      <input
        ref={file}
        type="file"
        accept={IMAGE_TYPES.join(",")}
        hidden
        aria-label="Replacement image"
        onChange={(event) => {
          const input = event.currentTarget;
          const picked = input.files?.[0];
          input.value = "";
          if (picked !== undefined) single.replace(picked);
        }}
      />
      <Button
        variant="ghost"
        disabled={single.busy}
        onClick={single.removeBackground}
      >
        Remove background
      </Button>
    </>
  );
}
