import type { Point } from "../realtime/messages";
import { strokePath } from "./drawingShape";

/**
 * DRW-05: след лазерной указки в координатах доски. Толщина — в экранных px, при любом
 * масштабе. Объектом доски не является и нажатий не ловит.
 */
export function LaserView({
  lines,
  color,
  label,
}: {
  lines: readonly (readonly Point[])[];
  color: string;
  label: string;
}) {
  if (lines.length === 0) return null;
  return (
    <svg
      className="laser-trail"
      aria-label={label}
      role="img"
      style={{ color }}
    >
      {lines.map((line, index) => (
        <path
          key={index}
          className="laser-line"
          d={strokePath(line)}
          stroke="currentColor"
        />
      ))}
    </svg>
  );
}
