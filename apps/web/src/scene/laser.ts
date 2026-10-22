import { useCallback, useEffect, useRef, useState } from "react";
import type { LaserTrail, Point } from "../realtime/messages";

/**
 * DRW-05: лазерная указка. След — временные линии в памяти вкладки; остальные видят его
 * в состоянии присутствия (`awareness`, поле `laser`). В документ доски, снимки и
 * резервные копии он не попадает (ARCHITECTURE.md, раздел 6).
 */

/** Через столько после появления точка следа исчезает, мс. */
export const LASER_FADE_MS = 3000;
/** Предел точек следа: состояние присутствия ограничено сервером (4 КБ). */
export const LASER_MAX_POINTS = 100;
/** Как часто след укорачивается, мс. */
export const LASER_TICK_MS = 100;
/** Новая точка следа — не ближе этого к прошлой, единиц доски. */
const LASER_STEP = 4;

interface TimedPoint extends Point {
  at: number;
}

/** След из нескольких линий: каждая — точки одного движения указателя. */
export type TimedTrail = TimedPoint[][];

/** Новая линия следа с первой точкой. */
export function beginLine(
  trail: TimedTrail,
  at: Point,
  now: number,
): TimedTrail {
  return limit([...trail, [{ ...at, at: now }]]);
}

/** Точка в конец последней линии; слишком близкая к прошлой — пропускается. */
export function extendLine(
  trail: TimedTrail,
  at: Point,
  now: number,
): TimedTrail {
  const line = trail.at(-1);
  if (line === undefined) return beginLine(trail, at, now);
  const last = line.at(-1);
  if (last && Math.hypot(at.x - last.x, at.y - last.y) < LASER_STEP) {
    return trail;
  }
  return limit([...trail.slice(0, -1), [...line, { ...at, at: now }]]);
}

/** Без точек старше LASER_FADE_MS; пустые линии убираются. */
export function fade(trail: TimedTrail, now: number): TimedTrail {
  return trail
    .map((line) => line.filter((p) => now - p.at < LASER_FADE_MS))
    .filter((line) => line.length > 0);
}

/** Не больше LASER_MAX_POINTS точек: старые уходят первыми. */
function limit(trail: TimedTrail): TimedTrail {
  let extra =
    trail.reduce((sum, line) => sum + line.length, 0) - LASER_MAX_POINTS;
  if (extra <= 0) return trail;
  const kept: TimedTrail = [];
  for (const line of trail) {
    const drop = Math.min(extra, line.length);
    extra -= drop;
    if (drop < line.length) kept.push(line.slice(drop));
  }
  return kept;
}

/** След для канала: линии плоскими массивами `[x0, y0, x1, y1, …]` целых координат. */
export function encodeTrail(trail: TimedTrail): LaserTrail | null {
  if (trail.length === 0) return null;
  return trail.map((line) =>
    line.flatMap((p) => [Math.round(p.x), Math.round(p.y)]),
  );
}

/**
 * Свой лазер: след для отрисовки, начало и продолжение линии. Каждое изменение следа
 * уходит в `share`; пустой след — `null`.
 */
export function useLaser(share: (trail: LaserTrail | null) => void): {
  trail: TimedTrail;
  begin: (at: Point) => void;
  add: (at: Point) => void;
} {
  const [trail, setTrail] = useState<TimedTrail>([]);
  const latestShare = useRef(share);
  useEffect(() => {
    latestShare.current = share;
  });
  const shared = useRef<TimedTrail>([]);

  useEffect(() => {
    const same =
      shared.current === trail ||
      (shared.current.length === 0 && trail.length === 0);
    if (same) return;
    shared.current = trail;
    latestShare.current(encodeTrail(trail));
  }, [trail]);

  // След укорачивается, пока он есть.
  const empty = trail.length === 0;
  useEffect(() => {
    if (empty) return;
    const timer = setInterval(() => {
      setTrail((current) => {
        const next = fade(current, Date.now());
        return sameLength(next, current) ? current : next;
      });
    }, LASER_TICK_MS);
    return () => {
      clearInterval(timer);
    };
  }, [empty]);

  const begin = useCallback((at: Point) => {
    setTrail((current) => beginLine(fade(current, Date.now()), at, Date.now()));
  }, []);
  const add = useCallback((at: Point) => {
    setTrail((current) => extendLine(current, at, Date.now()));
  }, []);
  return { trail, begin, add };
}

function sameLength(a: TimedTrail, b: TimedTrail): boolean {
  return (
    a.length === b.length && a.every((line, i) => line.length === b[i]?.length)
  );
}

/** Линии следа из канала: `[x0, y0, x1, y1, …]` → точки. */
export function trailPoints(trail: readonly (readonly number[])[]): Point[][] {
  return trail.map((line) => {
    const points: Point[] = [];
    for (let i = 0; i + 1 < line.length; i += 2) {
      points.push({ x: line[i] as number, y: line[i + 1] as number });
    }
    return points;
  });
}
