import { useEffect, useState } from "react";
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
 * (COL-02…COL-04, COL-09) и сцену с объектами (T5.2). Объект из ссылки (SHR-07)
 * передаётся сцене после первой сверки документа с сервером: раньше его ещё нет.
 */
export function BoardLive({
  boardId,
  target,
  checkAccess,
  onClosed,
  userName,
  objectId = null,
  boardLink,
}: {
  /** Id доски — ключ запомненного вида камеры (CVS-05). */
  boardId: string;
  target: BoardTarget;
  checkAccess: () => Promise<boolean>;
  onClosed?: () => void;
  /** Имя из сессии: владельцу — имя учётки, участнику — введённое имя (CVS-22). */
  userName?: string;
  /** SHR-07: `?object={id}` ссылки. */
  objectId?: string | null;
  /** SHR-07: действующая ссылка на доску — для ссылки на объект. */
  boardLink?: () => Promise<string>;
}) {
  const { board, presence, status } = useBoardConnection(target, checkAccess);
  const [loaded, setLoaded] = useState(false);
  if (status === "online" && !loaded) setLoaded(true);

  useEffect(() => {
    if (status === "closed") onClosed?.();
  }, [status, onClosed]);

  return (
    <>
      <p className="board-status" role="status" data-status={status}>
        {STATUS_TEXT[status]}
      </p>
      {status !== "closed" && (
        <BoardWorkspace
          key={boardId}
          boardId={boardId}
          board={board}
          presence={presence}
          userName={userName}
          focusObject={loaded ? objectId : null}
          boardLink={boardLink}
        />
      )}
    </>
  );
}
