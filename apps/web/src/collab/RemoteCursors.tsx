import type { PeerPresence } from "../realtime/boardPresence";
import { peerColor } from "./peerColor";

/**
 * COL-02: курсоры других участников с именами — в координатах доски, размер не зависит
 * от масштаба. Свой курсор не рисуется.
 */
export function RemoteCursors({
  peers,
  zoom,
}: {
  peers: readonly PeerPresence[];
  zoom: number;
}) {
  return (
    <>
      {peers.map(({ peer, name, self, state }) => {
        if (self || !state.cursor) return null;
        const color = peerColor(peer);
        return (
          <div
            key={peer}
            className="remote-cursor"
            aria-label={`${name}'s cursor`}
            style={{
              left: state.cursor.x,
              top: state.cursor.y,
              transform: `scale(${String(1 / zoom)})`,
              color,
            }}
          >
            <svg width="16" height="20" viewBox="0 0 16 20" aria-hidden="true">
              <path
                d="M1 1 L1 17 L5.5 12.5 L8.5 19 L11 18 L8 11.5 L14 11.5 Z"
                fill="currentColor"
                strokeWidth="1.2"
              />
            </svg>
            <span className="remote-cursor-name" style={{ background: color }}>
              {name}
            </span>
          </div>
        );
      })}
    </>
  );
}
