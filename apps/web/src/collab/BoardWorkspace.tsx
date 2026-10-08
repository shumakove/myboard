import { useCallback, useEffect, useState } from "react";
import type { CameraUpdate } from "../canvas/BoardCanvas";
import { centerOn, ZOOM_STEP, zoomBy, type Size } from "../canvas/camera";
import { CameraControls } from "../canvas/CameraControls";
import { Minimap } from "../canvas/Minimap";
import { useSceneRects } from "../canvas/sceneBounds";
import { useCameraKeys } from "../canvas/useCameraKeys";
import { usePersistentCamera } from "../canvas/usePersistentCamera";
import { loadWheelMode, saveWheelMode, type WheelMode } from "../canvas/wheel";
import type { BoardDocument } from "../realtime/boardDocument";
import type { BoardPresence } from "../realtime/boardPresence";
import type { CameraView } from "../realtime/messages";
import { usePresence } from "../realtime/usePresence";
import { BoardScene } from "../scene/BoardScene";
import { BoardSettingsControls } from "../scene/BoardSettingsControls";
import { Button, FloatingPanel } from "../ui";
import { peerColor } from "./peerColor";
import { PresencePanel } from "./PresencePanel";
import { RemoteCursors } from "./RemoteCursors";
import "./collab.css";

/**
 * Холст доски вместе с присутствием: камера (CVS-01…CVS-05, MOB-02), сцена с объектами
 * (T5.2), чужие курсоры с именами (COL-02) и их скрытие (COL-03), «смотреть глазами
 * участника» (COL-04), список присутствующих (COL-09).
 *
 * Слежение: вид повторяет камеру выбранного участника, пока наблюдатель не нажмёт
 * Stop following или не сдвинет вид сам (мышь, колесо, клавиши, касания, миникарта);
 * уход участника тоже прекращает слежение.
 */
export function BoardWorkspace({
  boardId,
  board,
  presence,
  userName = "",
}: {
  boardId: string;
  board: BoardDocument;
  presence: BoardPresence;
  /** Имя из сессии — пока сервер не прислал присутствие (автор правок, CVS-22). */
  userName?: string;
}) {
  const { peers } = usePresence(presence);
  const [camera, setCamera] = usePersistentCamera(boardId);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [wheelMode, setWheelMode] = useState<WheelMode>(loadWheelMode);
  const rects = useSceneRects(board.objects);
  const [following, setFollowing] = useState<string | null>(null);
  const [cursorsShown, setCursorsShown] = useState(true);
  const followed = peers.find((p) => p.peer === following && !p.self);
  // Имя ставит сервер по сессии: владельцу — имя учётки, участнику — введённое имя.
  const selfName = peers.find((p) => p.self)?.name ?? userName;

  // Свой вид и слежение видны остальным: за этой вкладкой тоже можно следить.
  useEffect(() => {
    presence.setLocal({ camera, following });
  }, [presence, camera, following]);

  useEffect(() => {
    if (following === null) return;
    return presence.subscribe(() => {
      const target = presence
        .getSnapshot()
        .peers.find((p) => p.peer === following && !p.self);
      if (target === undefined) {
        setFollowing(null);
        return;
      }
      const view = target.state.camera;
      if (view)
        setCamera((current) => (sameView(current, view) ? current : view));
    });
  }, [presence, following, setCamera]);

  const move = useCallback(
    (update: CameraUpdate) => {
      setFollowing(null);
      setCamera(update);
    },
    [setCamera],
  );
  useCameraKeys(move);

  function follow(peer: string) {
    const view = peers.find((p) => p.peer === peer)?.state.camera;
    if (view) setCamera(view);
    setFollowing(peer);
  }

  return (
    <div className="board-workspace">
      <div className="board-main">
        <FloatingPanel className="board-bar">
          <CameraControls
            zoom={camera.zoom}
            onZoomIn={() => {
              move((current) => zoomBy(current, ZOOM_STEP));
            }}
            onZoomOut={() => {
              move((current) => zoomBy(current, 1 / ZOOM_STEP));
            }}
            wheelMode={wheelMode}
            onWheelMode={(mode) => {
              setWheelMode(mode);
              saveWheelMode(mode);
            }}
          />
          <BoardSettingsControls settings={board.settings} />
        </FloatingPanel>
        <BoardScene
          board={board}
          camera={camera}
          wheelMode={wheelMode}
          userName={selfName}
          stageStyle={
            followed ? { outlineColor: peerColor(followed.peer) } : undefined
          }
          stageAttributes={{ "data-following": followed ? "true" : undefined }}
          onMove={move}
          onPointer={(cursor) => {
            presence.setLocal({ cursor });
          }}
          onResize={setViewport}
          worldOverlay={
            cursorsShown && <RemoteCursors peers={peers} zoom={camera.zoom} />
          }
          stageOverlay={
            <>
              <Minimap
                camera={camera}
                viewport={viewport}
                rects={rects}
                onNavigate={(point) => {
                  move((current) => centerOn(current, point));
                }}
              />
              {followed && (
                <p className="follow-banner">
                  Following {followed.name}
                  <Button
                    onClick={() => {
                      setFollowing(null);
                    }}
                  >
                    Stop following
                  </Button>
                </p>
              )}
            </>
          }
        />
      </div>
      <PresencePanel
        peers={peers}
        following={followed ? followed.peer : null}
        onFollow={follow}
        cursorsShown={cursorsShown}
        onToggleCursors={() => {
          setCursorsShown((shown) => !shown);
        }}
      />
    </div>
  );
}

function sameView(a: CameraView, b: CameraView): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}
