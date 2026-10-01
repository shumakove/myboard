import { useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnectionStatus } from "./boardConnection";
import { createBoardDocument, type BoardDocument } from "./boardDocument";
import { socketUrl, type PageAddress } from "./socketUrl";

/** Кто открывает доску: владелец по id или участник по токену ссылки (SHR-02). */
export type BoardTarget =
  { kind: "owner"; boardId: string } | { kind: "participant"; token: string };

/** Адрес канала доски из адреса страницы (без `localhost`, ARCHITECTURE.md, раздел 10). */
export function boardSocketUrl(
  target: BoardTarget,
  page: PageAddress = window.location,
): string {
  const query =
    target.kind === "owner"
      ? `board=${encodeURIComponent(target.boardId)}`
      : `token=${encodeURIComponent(target.token)}`;
  return `${socketUrl(page)}?${query}`;
}

/**
 * Документ доски, синхронизированный с сервером (COL-01), и состояние связи.
 * `checkAccess` вызывается после разрыва: `false` — доступа нет, переподключения не будет.
 */
export function useBoardConnection(
  target: BoardTarget,
  checkAccess: () => Promise<boolean>,
): { board: BoardDocument; status: ConnectionStatus } {
  const url = boardSocketUrl(target);
  const [state, setState] = useState(() => initialState(url));
  if (state.url !== url) {
    // Другая доска — своя копия документа (обновление состояния при смене свойства).
    setState(initialState(url));
  }
  const { board } = state;
  const checkAccessRef = useRef(checkAccess);
  useEffect(() => {
    checkAccessRef.current = checkAccess;
  });

  useEffect(() => {
    const connection = new BoardConnection({
      doc: board.doc,
      url,
      onStatus: (status) => {
        setState((current) =>
          current.board === board ? { ...current, status } : current,
        );
      },
      checkAccess: () => checkAccessRef.current(),
    });
    return () => {
      connection.destroy();
    };
  }, [board, url]);

  return { board, status: state.status };
}

interface ConnectionState {
  url: string;
  board: BoardDocument;
  status: ConnectionStatus;
}

function initialState(url: string): ConnectionState {
  return { url, board: createBoardDocument(), status: "connecting" };
}
