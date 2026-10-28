import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  flipTransform,
  MASKS,
  maskClipPath,
  mediaUrl,
  type ImageCrop,
  type ImageShape,
} from "./imageData";
import type { SceneObject } from "./sceneObjects";

/**
 * Изображение на холсте (T7.1): видимая часть исходника по обрезке, маска и скругление
 * углов (IMG-02), обводка и отражение (IMG-03). GIF воспроизводится (IMG-06); `still` —
 * на экране много объектов: GIF стоит на первом кадре и играет, пока над ним указатель.
 */
export function ImageView({
  object,
  image,
  still,
}: {
  object: SceneObject;
  image: ImageShape;
  still: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(image.media);
  const gif = image.mime === "image/gif";
  const paused = gif && still && !hovered;
  const { crop, mask } = image;
  const radius = mask === "none" ? num(object.style.radius) : undefined;
  return (
    <div
      className="image-view"
      data-mask={mask}
      data-playing={gif ? String(!paused) : undefined}
      onPointerEnter={() => {
        setHovered(true);
      }}
      onPointerLeave={() => {
        setHovered(false);
      }}
    >
      <div
        className="image-clip"
        style={{ clipPath: maskClipPath(mask), borderRadius: radius }}
      >
        <div className="image-flip" style={{ transform: flipTransform(image) }}>
          {src === null || failed ? (
            <span className="image-missing">Image unavailable</span>
          ) : paused ? (
            <GifStill src={src} style={sourceStyle(crop)} />
          ) : (
            <img
              className="image-source"
              src={src}
              alt=""
              draggable={false}
              style={sourceStyle(crop)}
              onError={() => {
                setFailed(true);
              }}
            />
          )}
        </div>
      </div>
      <ImageStroke object={object} image={image} radius={radius} />
    </div>
  );
}

/** Положение исходника в рамке: видимая часть `crop` заполняет рамку. */
function sourceStyle(crop: ImageCrop): CSSProperties {
  return {
    left: `${String((-crop.x / crop.width) * 100)}%`,
    top: `${String((-crop.y / crop.height) * 100)}%`,
    width: `${String(100 / crop.width)}%`,
    height: `${String(100 / crop.height)}%`,
  };
}

/** IMG-06: первый кадр GIF — картинка, нарисованная на холсте, без анимации. */
function GifStill({ src, style }: { src: string; style: CSSProperties }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    const image = new Image();
    image.onload = () => {
      const target = canvas.current;
      if (!live || target === null) return;
      target.width = image.naturalWidth;
      target.height = image.naturalHeight;
      target.getContext("2d")?.drawImage(image, 0, 0);
    };
    image.src = src;
    return () => {
      live = false;
    };
  }, [src]);
  return (
    <canvas
      ref={canvas}
      className="image-source"
      aria-hidden="true"
      style={style}
    />
  );
}

/** IMG-03: обводка по контуру маски; без маски — по рамке со скруглением. */
function ImageStroke({
  object,
  image,
  radius,
}: {
  object: SceneObject;
  image: ImageShape;
  radius: number | undefined;
}) {
  const width = num(object.style.strokeWidth) ?? 0;
  const color =
    typeof object.style.stroke === "string" ? object.style.stroke : undefined;
  if (width <= 0 || color === undefined) return null;
  if (image.mask === "none") {
    return (
      <div
        className="image-stroke"
        style={{
          border: `${String(width)}px solid ${color}`,
          borderRadius: radius,
        }}
      />
    );
  }
  const points = MASKS.find((m) => m.value === image.mask)?.points ?? null;
  const shape = {
    fill: "none",
    stroke: color,
    strokeWidth: width,
    vectorEffect: "non-scaling-stroke",
  } as const;
  return (
    <svg
      className="image-stroke"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {points === null ? (
        <ellipse cx={50} cy={50} rx={50} ry={50} {...shape} />
      ) : (
        <polygon points={points} {...shape} />
      )}
    </svg>
  );
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
