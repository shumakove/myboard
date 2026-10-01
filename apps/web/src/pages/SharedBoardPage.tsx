import { useEffect, useState, type SubmitEvent } from "react";
import { useParams } from "wouter";
import {
  joinSharedBoard,
  LINK_UNAVAILABLE,
  openSharedBoard,
  SharingApiError,
  sharingErrorMessage,
  type SharedBoard,
} from "../sharing/sharingApi";
import "../account/account.css";

type PageState =
  | { status: "loading" }
  | { status: "ready"; board: SharedBoard }
  | { status: "unavailable" }
  | { status: "failed"; message: string };

/**
 * `/b/{token}` — участник по ссылке без учётной записи (SHR-02): сначала имя на сессию
 * (SHR-03), затем доска. Отозванная и несуществующая ссылка — один отказ (SHR-05).
 * Холст — T4.1, T5.*; переход к объекту `?object={id}` — SHR-07, T5.5.
 */
export function SharedBoardPage() {
  const { token } = useParams<{ token: string }>();
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

  if (state.status === "loading") {
    return (
      <main className="account">
        <h1>Shared board</h1>
        <p>Loading…</p>
      </main>
    );
  }
  if (state.status !== "ready") {
    return (
      <main className="account">
        <h1>Board unavailable</h1>
        <p role="alert">
          {state.status === "failed" ? state.message : LINK_UNAVAILABLE}
        </p>
      </main>
    );
  }
  const { board } = state;
  return (
    <main className="account">
      <h1>{board.title}</h1>
      {board.participant === null ? (
        <NameForm
          token={token}
          onJoined={(joined) => {
            setState({ status: "ready", board: joined });
          }}
          onUnavailable={() => {
            setState({ status: "unavailable" });
          }}
        />
      ) : (
        <>
          <p>You joined as {board.participant.name}.</p>
          <p>The canvas is not available yet.</p>
        </>
      )}
    </main>
  );
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
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      <p>Enter your name to join the board.</p>
      <label>
        Your name
        <input
          name="name"
          autoComplete="nickname"
          maxLength={200}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="account-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        Join board
      </button>
    </form>
  );
}
