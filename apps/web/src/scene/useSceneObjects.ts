import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { readScene, type SceneObject } from "./sceneObjects";

/** Объекты сцены; пересчитываются после любой правки `objects` — своей или чужой. */
export function useSceneObjects(objects: Y.Map<unknown>): SceneObject[] {
  const [scene, setScene] = useState(() => readScene(objects));
  useEffect(() => {
    const update = () => {
      setScene(readScene(objects));
    };
    update();
    objects.observeDeep(update);
    return () => {
      objects.unobserveDeep(update);
    };
  }, [objects]);
  return scene;
}
