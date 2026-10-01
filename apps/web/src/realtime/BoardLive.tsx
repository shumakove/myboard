import { useEffect } from "react";
import type { ConnectionStatus } from "./boardConnection";
import { useBoardConnection, type BoardTarget } from "./useBoardConnection";

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Connecting to the board…",
  online: "Live: changes are shared with everyone on the board.",
  offline:
    "Offline. Your changes will be sent when the connection is restored.",
  closed: "This board is no longer available.",
};

/**
 * Совместная работа на доске (COL-01): держит канал документа и показывает состояние связи.
 * Холст появится в T5.*.
 */
export function BoardLive({
  target,
  checkAccess,
  onClosed,
}: {
  target: BoardTarget;
  checkAccess: () => Promise<boolean>;
  onClosed?: () => void;
}) {
  const { status } = useBoardConnection(target, checkAccess);

  useEffect(() => {
    if (status === "closed") onClosed?.();
  }, [status, onClosed]);

  return (
    <p role="status" data-status={status}>
      {STATUS_TEXT[status]}
    </p>
  );
}
