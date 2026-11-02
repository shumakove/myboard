import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "../ui";
import {
  hostOf,
  type EmbedShape,
  type LinkCardShape,
  type ObjectLink,
} from "./embedData";
import { mediaUrl } from "./imageData";

/**
 * Встроенная страница получает свой скрипт и своё происхождение, но не может увести вкладку
 * доски (нет `allow-top-navigation`).
 */
const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox";

/** Чужая страница не узнаёт адрес доски (в нём токен ссылки). */
const NO_REFERRER = "no-referrer";

/**
 * EMB-01: внешняя страница на холсте. Фрейм забирает себе все нажатия, поэтому в обычном
 * состоянии он их не получает: объект двигают и выделяют, как любой другой. Interact
 * включает работу со страницей только у этого участника и только до нажатия вне объекта.
 */
export function EmbedView({ embed }: { embed: EmbedShape }) {
  const root = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);

  useEffect(() => {
    if (!live) return;
    const leave = (event: PointerEvent) => {
      if (!(
        event.target instanceof Node && root.current?.contains(event.target)
      ))
        setLive(false);
    };
    window.addEventListener("pointerdown", leave, true);
    return () => {
      window.removeEventListener("pointerdown", leave, true);
    };
  }, [live]);

  const { src } = embed;
  if (src === null) {
    return <p className="embed-empty">This embed has no valid address.</p>;
  }
  const host = hostOf(src);
  return (
    <div
      ref={root}
      className="embed-object"
      data-live={live ? "true" : "false"}
    >
      <div className="embed-bar">
        <span className="embed-host">{host}</span>
        <Button
          variant="ghost"
          data-canvas-ignore=""
          aria-pressed={live}
          onClick={() => {
            setLive((on) => !on);
          }}
        >
          {live ? "Stop interacting" : "Interact"}
        </Button>
        <a
          className={buttonClass("ghost")}
          data-canvas-ignore=""
          href={src}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open
        </a>
      </div>
      <iframe
        className="embed-frame"
        title={`Embedded page from ${host}`}
        src={src}
        sandbox={FRAME_SANDBOX}
        allow="fullscreen"
        referrerPolicy={NO_REFERRER}
        loading="lazy"
      />
    </div>
  );
}

/**
 * EMB-02: карточка ссылки — изображение, название и адрес. Ссылка сама обрабатывает свои
 * нажатия (`data-canvas-ignore`), поэтому открывается и у заблокированной карточки.
 */
export function LinkCardView({
  card,
  title,
}: {
  card: LinkCardShape;
  title: string;
}) {
  const image = card.media === null ? null : mediaUrl(card.media);
  const { url } = card;
  const name = title !== "" ? title : url === null ? "Link" : hostOf(url);
  return (
    <div className="link-card">
      {image !== null && (
        <img
          className="link-card-image"
          src={image}
          alt=""
          draggable={false}
          referrerPolicy={NO_REFERRER}
        />
      )}
      <div className="link-card-text">
        {url === null ? (
          <span className="link-card-title">{name}</span>
        ) : (
          <a
            className="link-card-title"
            data-canvas-ignore=""
            draggable={false}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {name}
          </a>
        )}
        {url !== null && <span className="link-card-host">{hostOf(url)}</span>}
      </div>
    </div>
  );
}

/** EMB-03: значок ссылки в углу объекта; работает и у заблокированного. */
export function ObjectLinkBadge({
  link,
  onOpenObject,
}: {
  link: ObjectLink;
  onOpenObject: (id: string) => void;
}) {
  if (link.kind === "url") {
    return (
      <a
        className="object-link"
        data-canvas-ignore=""
        draggable={false}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open link"
        title={link.url}
      >
        <LinkIcon />
      </a>
    );
  }
  return (
    <button
      type="button"
      className="object-link"
      data-canvas-ignore=""
      aria-label="Go to linked object"
      title="Go to linked object"
      onClick={() => {
        onOpenObject(link.id);
      }}
    >
      <LinkIcon />
    </button>
  );
}

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1" />
      <path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1" />
    </svg>
  );
}
