import { useCallback, useEffect, useState } from "react";
import { BoardCanvas, type CameraUpdate } from "../canvas/BoardCanvas";
import { HOME } from "../canvas/camera";
import type { BoardPresence } from "../realtime/boardPresence";
import type { CameraView } from "../realtime/messages";
import { usePresence } from "../realtime/usePresence";
import { peerColor } from "./peerColor";
import { PresencePanel } from "./PresencePanel";
import { RemoteCursors } from "./RemoteCursors";
import "./collab.css";

/**
 * Холст доски вместе с присутствием: чужие курсоры с именами (COL-02) и их скрытие
 * (COL-03), «смотреть глазами участника» (COL-04), список присутствующих (COL-09).
 *
 * Слежение: вид повторяет камеру выбранного участника, пока наблюдатель не нажмёт
 * Stop following или не сдвинет вид сам; уход участника тоже прекращает слежение.
 */
export function BoardWorkspace({ presence }: { presence: BoardPresence }) {
  const { peers } = usePresence(presence);
  const [camera, setCamera] = useState<CameraView>(HOME);
  const [following, setFollowing] = useState<string | null>(null);
  const [cursorsShown, setCursorsShown] = useState(true);
  const followed = peers.find((p) => p.peer === following && !p.self);

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
  }, [presence, following]);

  const move = useCallback((update: CameraUpdate) => {
    setFollowing(null);
    setCamera(update);
  }, []);

  function follow(peer: string) {
    const view = peers.find((p) => p.peer === peer)?.state.camera;
    if (view) setCamera(view);
    setFollowing(peer);
  }

  return (
    <div className="board-workspace">
      <div
        className="board-stage"
        style={
          followed ? { outlineColor: peerColor(followed.peer) } : undefined
        }
        data-following={followed ? "true" : undefined}
      >
        <BoardCanvas
          camera={camera}
          onMove={move}
          onPointer={(cursor) => {
            presence.setLocal({ cursor });
          }}
        >
          {cursorsShown && <RemoteCursors peers={peers} zoom={camera.zoom} />}
        </BoardCanvas>
        {followed && (
          <p className="follow-banner">
            Following {followed.name}
            <button
              type="button"
              onClick={() => {
                setFollowing(null);
              }}
            >
              Stop following
            </button>
          </p>
        )}
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
