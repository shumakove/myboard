import { useEffect, useState } from "react";
import type { CameraView } from "../realtime/messages";
import { HOME } from "./camera";
import { loadCamera, saveCamera } from "./cameraStorage";

/** CVS-05: вид доски начинается с последнего в этом браузере и запоминается при каждом изменении. */
export function usePersistentCamera(boardId: string) {
  const [camera, setCamera] = useState<CameraView>(
    () => loadCamera(boardId) ?? HOME,
  );
  useEffect(() => {
    saveCamera(boardId, camera);
  }, [boardId, camera]);
  return [camera, setCamera] as const;
}
