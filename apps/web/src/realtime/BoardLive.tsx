import { useEffect } from "react";
import { BoardWorkspace } from "../collab/BoardWorkspace";
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
 * Совместная работа на доске: держит канал документа (COL-01), показывает состояние связи,
 * холст с камерой (CVS-01…CVS-05), курсоры участников и список присутствующих
 * (COL-02…COL-04, COL-09) и сцену с объектами (T5.2).
 */
export function BoardLive({
  boardId,
  target,
  checkAccess,
  onClosed,
}: {
  /** Id доски — ключ запомненного вида камеры (CVS-05). */
  boardId: string;
  target: BoardTarget;
  checkAccess: () => Promise<boolean>;
  onClosed?: () => void;
}) {
  const { board, presence, status } = useBoardConnection(target, checkAccess);

  useEffect(() => {
    if (status === "closed") onClosed?.();
  }, [status, onClosed]);

  return (
    <>
      <p role="status" data-status={status}>
        {STATUS_TEXT[status]}
      </p>
      {status !== "closed" && (
        <BoardWorkspace
          key={boardId}
          boardId={boardId}
          board={board}
          presence={presence}
        />
      )}
    </>
  );
}
