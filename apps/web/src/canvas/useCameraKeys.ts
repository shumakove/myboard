import { useEffect, useRef } from "react";
import type { CameraUpdate } from "./BoardCanvas";
import { cameraKeyAction, isTypingTarget } from "./keyboard";

/**
 * CVS-02: «+»/«−» и стрелки управляют видом, пока фокус не в поле ввода.
 * Клавиши слушаются на всей странице — щёлкать по холсту перед ними не нужно.
 */
export function useCameraKeys(onMove: (update: CameraUpdate) => void): void {
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented || isTypingTarget(event.target)) return;
      const action = cameraKeyAction(event);
      if (action === null) return;
      event.preventDefault(); // стрелки не прокручивают страницу
      onMoveRef.current(action);
    }
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener("keydown", keydown);
    };
  }, []);
}
