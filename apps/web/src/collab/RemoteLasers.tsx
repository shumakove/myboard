import type { PeerPresence } from "../realtime/boardPresence";
import { trailPoints } from "../scene/laser";
import { LaserView } from "../scene/LaserView";
import { peerColor } from "./peerColor";

/** DRW-05: следы лазера других участников — цветом участника, из их присутствия. */
export function RemoteLasers({ peers }: { peers: readonly PeerPresence[] }) {
  return (
    <>
      {peers.map(({ peer, name, self, state }) =>
        self || !state.laser ? null : (
          <LaserView
            key={peer}
            lines={trailPoints(state.laser)}
            color={peerColor(peer)}
            label={`${name}'s laser`}
          />
        ),
      )}
    </>
  );
}
