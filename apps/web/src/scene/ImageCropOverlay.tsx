import { useRef, useState, type PointerEvent } from "react";
import {
  dragCrop,
  flipTransform,
  mediaUrl,
  viewCrop,
  type CropHandle,
  type ImageCrop,
  type ImageShape,
} from "./imageData";
import { frameStyle } from "./objectStyle";
import type { SceneObject } from "./sceneObjects";

const HANDLES: readonly Exclude<CropHandle, "move">[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];

interface Drag {
  handle: CropHandle;
  x: number;
  y: number;
  start: ImageCrop;
}

/**
 * IMG-02: обрезка изображения на холсте. Исходник целиком виден полупрозрачным, рамку
 * обрезки тянут за стороны и углы или двигают целиком; отпускание записывает обрезку.
 * Слой лежит в системе изображения (та же рамка и поворот), `zoom` — масштаб вида.
 */
export function ImageCropOverlay({
  object,
  image,
  zoom,
  onCrop,
}: {
  object: SceneObject;
  image: ImageShape;
  zoom: number;
  /** Новая обрезка в долях исходника. */
  onCrop: (crop: ImageCrop) => void;
}) {
  const [draft, setDraft] = useState<ImageCrop | null>(null);
  const drag = useRef<Drag | null>(null);
  const src = mediaUrl(image.media);
  // Всё — в системе показа: у отражённого изображения обрезка зеркальна.
  const shown = viewCrop(image.crop, image);
  const fullWidth = object.width / image.crop.width;
  const fullHeight = object.height / image.crop.height;
  const place = (crop: ImageCrop) => ({
    left: (crop.x - shown.x) * fullWidth,
    top: (crop.y - shown.y) * fullHeight,
    width: crop.width * fullWidth,
    height: crop.height * fullHeight,
  });

  const start = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Маркер стороны или угла — по data-handle, иначе рамку двигают целиком.
    const handle =
      HANDLES.find((h) => h === (event.target as HTMLElement).dataset.handle) ??
      "move";
    drag.current = {
      handle,
      x: event.clientX,
      y: event.clientY,
      start: draft ?? shown,
    };
  };
  const move = (event: PointerEvent) => {
    const current = drag.current;
    if (current === null) return;
    // Сдвиг экрана → доска → система изображения (без поворота) → доли исходника.
    const bx = (event.clientX - current.x) / zoom;
    const by = (event.clientY - current.y) / zoom;
    const angle = (object.rotation * Math.PI) / 180;
    const lx = bx * Math.cos(angle) + by * Math.sin(angle);
    const ly = -bx * Math.sin(angle) + by * Math.cos(angle);
    setDraft(
      dragCrop(current.start, current.handle, lx / fullWidth, ly / fullHeight),
    );
  };
  const end = (event: PointerEvent) => {
    event.stopPropagation();
    if (drag.current === null) return;
    drag.current = null;
    if (draft !== null) onCrop(viewCrop(draft, image));
    setDraft(null);
  };
  const full = place({ x: 0, y: 0, width: 1, height: 1 });
  return (
    <div
      className="image-crop"
      role="group"
      aria-label="Crop image"
      style={frameStyle(object)}
    >
      {src !== null && (
        <img
          className="image-crop-source"
          src={src}
          alt=""
          draggable={false}
          style={{
            ...full,
            transform: flipTransform(image),
          }}
        />
      )}
      <div
        className="image-crop-box"
        aria-label="Crop area"
        style={place(draft ?? shown)}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        {HANDLES.map((handle) => (
          <span
            key={handle}
            className="image-crop-handle"
            data-handle={handle}
            aria-label={`Crop ${handle}`}
          />
        ))}
      </div>
    </div>
  );
}
