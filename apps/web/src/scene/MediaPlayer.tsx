import { useEffect, useRef, useState } from "react";
import { Button, SelectField } from "../ui";

/** FIL-03: скорости воспроизведения. */
const RATES: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** Safari на телефоне открывает полный экран только у самого видео. */
function enterVideoFullscreen(media: HTMLMediaElement | null): void {
  (
    media as { webkitEnterFullscreen?: () => void } | null
  )?.webkitEnterFullscreen?.();
}

/**
 * Плеер на доске: пауза и перемотка (FIL-03, FIL-04), у видео ещё громкость, скорость и
 * полный экран (FIL-03). FIL-05: всё состояние — в этом компоненте и в браузере этого
 * участника; в документ и по сети не передаётся. Панель сама обрабатывает свои нажатия
 * (`data-canvas-ignore`), поэтому работает и у заблокированного объекта.
 */
export function MediaPlayer({
  kind,
  src,
}: {
  kind: "video" | "audio";
  src: string | null;
}) {
  const media = useRef<HTMLMediaElement | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setFullscreen(
        root.current !== null && document.fullscreenElement === root.current,
      );
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
    };
  }, []);

  if (src === null || failed) {
    return (
      <div className="media-player" data-kind={kind} data-failed="true">
        <span className="media-missing">
          {kind === "video" ? "Video" : "Audio"} can&apos;t be played
        </span>
      </div>
    );
  }

  const element = {
    ref: (node: HTMLMediaElement | null) => {
      media.current = node;
    },
    className: "media-source",
    src,
    preload: "metadata",
    onPlay: () => {
      setPlaying(true);
    },
    onPause: () => {
      setPlaying(false);
    },
    onTimeUpdate: () => {
      setTime(media.current?.currentTime ?? 0);
    },
    onDurationChange: () => {
      const value = media.current?.duration ?? 0;
      setDuration(Number.isFinite(value) ? value : 0);
    },
    onError: () => {
      setFailed(true);
    },
  };

  const toggle = () => {
    const player = media.current;
    if (player === null) return;
    if (player.paused) void player.play().catch(() => undefined);
    else player.pause();
  };

  const toggleFullscreen = () => {
    const frame = root.current;
    if (frame !== null && document.fullscreenElement === frame) {
      void document.exitFullscreen();
    } else if (typeof frame?.requestFullscreen === "function") {
      void frame.requestFullscreen();
    } else {
      enterVideoFullscreen(media.current);
    }
  };

  return (
    <div
      ref={root}
      className="media-player"
      data-kind={kind}
      data-playing={String(playing)}
    >
      {kind === "video" ? (
        <video {...element} playsInline />
      ) : (
        <audio {...element} />
      )}
      <div className="media-controls" data-canvas-ignore="">
        <div className="media-row">
          <Button variant="ghost" onClick={toggle}>
            {playing ? "Pause" : "Play"}
          </Button>
          <input
            type="range"
            className="media-seek"
            aria-label="Seek"
            min={0}
            max={duration}
            step="any"
            value={Math.min(time, duration)}
            disabled={duration === 0}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (media.current !== null) media.current.currentTime = value;
              setTime(value);
            }}
          />
          <span className="media-time">
            {clock(time)} / {clock(duration)}
          </span>
        </div>
        {kind === "video" && (
          <div className="media-row">
            <label className="media-volume">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setVolume(value);
                  if (media.current !== null) media.current.volume = value;
                }}
              />
            </label>
            <SelectField
              label="Speed"
              value={String(rate)}
              onChange={(event) => {
                const value = Number(event.target.value);
                setRate(value);
                if (media.current !== null) media.current.playbackRate = value;
              }}
            >
              {RATES.map((value) => (
                <option key={value} value={value}>
                  {value}×
                </option>
              ))}
            </SelectField>
            <Button variant="ghost" onClick={toggleFullscreen}>
              {fullscreen ? "Exit full screen" : "Full screen"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Время ролика: `1:05`. */
function clock(seconds: number): string {
  const whole = Math.floor(seconds);
  const rest = whole % 60;
  return `${String(Math.floor(whole / 60))}:${rest < 10 ? "0" : ""}${String(rest)}`;
}
