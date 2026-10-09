import { useCallback, useEffect, useState, type SubmitEvent } from "react";
import { useParams, useSearch } from "wouter";
import {
  joinSharedBoard,
  LINK_UNAVAILABLE,
  openSharedBoard,
  SharingApiError,
  sharingErrorMessage,
  type SharedBoard,
} from "../sharing/sharingApi";
import { BoardLive } from "../realtime/BoardLive";
import { linkedObjectId, sharedBoardUrl } from "../sharing/objectLink";
import "../account/account.css";
import { Button, FloatingPanel, TextField } from "../ui";

type PageState =
  | { status: "loading" }
  | { status: "ready"; board: SharedBoard }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

/**
 * `/b/{token}` — участник по ссылке без учётной записи (SHR-02): сначала имя на сессию
 * (SHR-03), затем доска. Отозванная и несуществующая ссылка — один отказ (SHR-05).
 * Документ доски синхронизируется по `/api/ws` с теми же правами, что у владельца
 * (COL-01, SHR-04). `?object={id}` — ссылка на объект: после загрузки документа вид
 * переходит к нему (SHR-07); с отозванным токеном — тот же отказ.
 */
export function SharedBoardPage() {
  const { token } = useParams<{ token: string }>();
  const objectId = linkedObjectId(useSearch());
  const [state, setState] = useState<PageState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    openSharedBoard(token)
      .then((board) => {
        if (active) setState({ status: "ready", board });
      })
      .catch((err: unknown) => {
        if (active) setState(failure(err));
      });
    return () => {
      active = false;
    };
  }, [token]);

  // Канал закрыт без доступа (сброс ссылки, сессия отозвана): заново спросить сервер,
  // чтобы показать отказ или форму имени.
  const recheck = useCallback(() => {
    openSharedBoard(token).then(
      (board) => {
        setState({ status: "ready", board });
      },
      (err: unknown) => {
        setState(failure(err));
      },
    );
  }, [token]);

  if (state.status === "loading") {
    return (
      <main className="auth-page">
        <FloatingPanel className="auth-card">
          <h1>Shared board</h1>
          <p>Loading…</p>
        </FloatingPanel>
      </main>
    );
  }
  if (state.status !== "ready") {
    return (
      <main className="auth-page">
        <FloatingPanel className="auth-card">
          <h1>Board unavailable</h1>
          <p role="alert">
            {state.status === "failed" ? state.message : LINK_UNAVAILABLE}
          </p>
        </FloatingPanel>
      </main>
    );
  }
  const { board } = state;
  if (board.participant === null) {
    return (
      <main className="auth-page">
        <FloatingPanel className="auth-card">
          <h1>{board.title}</h1>
          <NameForm
            token={token}
            onJoined={(joined) => {
              setState({ status: "ready", board: joined });
            }}
            onUnavailable={() => {
              setState({ status: "unavailable" });
            }}
          />
        </FloatingPanel>
      </main>
    );
  }
  return (
    <main className="board-page">
      <FloatingPanel className="board-header">
        <h1>{board.title}</h1>
        <p className="board-header-note">
          You joined as {board.participant.name}.
        </p>
      </FloatingPanel>
      <BoardLive
        boardId={board.id}
        target={{ kind: "participant", token }}
        checkAccess={() => participantHasAccess(token)}
        onClosed={recheck}
        userName={board.participant.name}
        objectId={objectId}
        boardLink={() => Promise.resolve(sharedBoardUrl(token))}
      />
    </main>
  );
}

/** После разрыва канала: ссылка действует и сессия участника жива? */
async function participantHasAccess(token: string): Promise<boolean> {
  try {
    return (await openSharedBoard(token)).participant !== null;
  } catch (err: unknown) {
    return !(err instanceof SharingApiError && err.status === 404);
  }
}

function failure(err: unknown): PageState {
  return err instanceof SharingApiError && err.status === 404
    ? { status: "unavailable" }
    : { status: "failed", message: sharingErrorMessage(err) };
}

/** SHR-03: отображаемое имя на эту сессию. */
function NameForm({
  token,
  onJoined,
  onUnavailable,
}: {
  token: string;
  onJoined: (board: SharedBoard) => void;
  onUnavailable: () => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter your name.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      onJoined(await joinSharedBoard(token, name));
    } catch (err: unknown) {
      if (err instanceof SharingApiError && err.status === 404) {
        onUnavailable();
        return;
      }
      setError(sharingErrorMessage(err));
      setPending(false);
    }
  }

  return (
    <form className="ui-form" onSubmit={(event) => void submit(event)}>
      <p>Enter your name to join the board.</p>
      <TextField
        label="Your name"
        name="name"
        autoComplete="nickname"
        maxLength={200}
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      {error && (
        <p role="alert" className="ui-error">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending}>
        Join board
      </Button>
    </form>
  );
}
