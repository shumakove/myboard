import type { PeerPresence } from "../realtime/boardPresence";
import { peerColor } from "./peerColor";
import { Button } from "../ui";

/**
 * COL-09: кто сейчас на доске. Отсюда же — слежение за участником (COL-04) и скрытие
 * чужих курсоров (COL-03).
 */
export function PresencePanel({
  peers,
  following,
  onFollow,
  cursorsShown,
  onToggleCursors,
}: {
  peers: readonly PeerPresence[];
  following: string | null;
  onFollow: (peer: string) => void;
  cursorsShown: boolean;
  onToggleCursors: () => void;
}) {
  const nameOf = (peer: string) => peers.find((p) => p.peer === peer)?.name;
  return (
    <aside className="presence ui-panel" aria-label="People on this board">
      <h2>On this board ({peers.length})</h2>
      <ul>
        {peers.map(({ peer, name, self, state }) => {
          const watching = state.following
            ? nameOf(state.following)
            : undefined;
          return (
            <li key={peer}>
              <span
                className="presence-dot"
                style={{ background: peerColor(peer) }}
                aria-hidden="true"
              />
              <span className="presence-name">
                {name}
                {self && " (you)"}
                {watching !== undefined && (
                  <span className="presence-note"> · following {watching}</span>
                )}
              </span>
              {!self && (
                <Button
                  variant="ghost"
                  disabled={following === peer}
                  aria-label={
                    following === peer ? `Following ${name}` : `Follow ${name}`
                  }
                  onClick={() => {
                    onFollow(peer);
                  }}
                >
                  {following === peer ? "Following" : "Follow"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button onClick={onToggleCursors}>
        {cursorsShown ? "Hide cursors" : "Show cursors"}
      </Button>
    </aside>
  );
}
