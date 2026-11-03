import { useCallback, useMemo, useState } from "react";
import type { Size } from "../canvas/camera";
import type { SceneObject } from "./sceneObjects";

/**
 * BUG-032: новый файл на низком экране показывается загрузившему по его виду, а в документ
 * идёт размер без учёта экрана: другие участники и экраны мелкий объект не получают. Это
 * вид одного клиента, поэтому он живёт в памяти, а не в документе.
 */
export interface LocalFit {
  /** Размер в документе на момент загрузки. */
  stored: Size;
  /** Размер на экране загрузившего. */
  shown: Size;
}

/** Показанный размер действует, пока размер в документе не менялся. */
export function applyLocalFits(
  scene: SceneObject[],
  fits: ReadonlyMap<string, LocalFit>,
): SceneObject[] {
  if (fits.size === 0) return scene;
  return scene.map((object) => {
    const fit = fits.get(object.id);
    if (
      fit === undefined ||
      object.width !== fit.stored.width ||
      object.height !== fit.stored.height
    ) {
      return object;
    }
    return { ...object, ...fit.shown };
  });
}

/** Сцена с размерами по виду и запись нового такого размера. */
export function useLocalFits(scene: SceneObject[]): {
  scene: SceneObject[];
  fit: (id: string, stored: Size, shown: Size) => void;
} {
  const [fits, setFits] = useState<ReadonlyMap<string, LocalFit>>(new Map());
  const fit = useCallback((id: string, stored: Size, shown: Size) => {
    if (stored.width === shown.width && stored.height === shown.height) return;
    setFits((current) => new Map(current).set(id, { stored, shown }));
  }, []);
  return {
    scene: useMemo(() => applyLocalFits(scene, fits), [scene, fits]),
    fit,
  };
}
