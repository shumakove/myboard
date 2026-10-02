import { useEffect, useRef, useState } from "react";
import { BoardConnection, type ConnectionStatus } from "./boardConnection";
import { BoardPresence } from "./boardPresence";
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
 * Документ доски, синхронизированный с сервером (COL-01), присутствие на доске
 * (COL-02…COL-04, COL-09) и состояние связи.
 * `checkAccess` вызывается после разрыва: `false` — доступа нет, переподключения не будет.
 */
export function useBoardConnection(
  target: BoardTarget,
  checkAccess: () => Promise<boolean>,
): {
  board: BoardDocument;
  presence: BoardPresence;
  status: ConnectionStatus;
} {
  const url = boardSocketUrl(target);
  const [state, setState] = useState(() => initialState(url));
  if (state.url !== url) {
    // Другая доска — своя копия документа (обновление состояния при смене свойства).
    setState(initialState(url));
  }
  const { board, presence } = state;
  const checkAccessRef = useRef(checkAccess);
  useEffect(() => {
    checkAccessRef.current = checkAccess;
  });

  useEffect(() => {
    const connection = new BoardConnection({
      doc: board.doc,
      url,
      presence,
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
  }, [board, presence, url]);

  return { board, presence, status: state.status };
}

interface ConnectionState {
  url: string;
  board: BoardDocument;
  presence: BoardPresence;
  status: ConnectionStatus;
}

function initialState(url: string): ConnectionState {
  return {
    url,
    board: createBoardDocument(),
    presence: new BoardPresence(),
    status: "connecting",
  };
}
