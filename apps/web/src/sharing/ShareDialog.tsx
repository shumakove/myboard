import { useEffect, useRef, useState } from "react";
import { copyText } from "./copyText";
import {
  getShareLink,
  resetShareLink,
  sharingErrorMessage,
  type ShareLink,
} from "./sharingApi";
import "./sharing.css";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; link: ShareLink }
  | { status: "failed"; message: string };

type Notice = { kind: "info" | "error"; text: string } | null;

/**
 * Диалог Share владельца доски: показать и скопировать ссылку (SHR-01),
 * сбросить её (SHR-06). Сброс подтверждается внутри диалога, без `confirm`.
 */
export function ShareDialog({
  boardId,
  onClose,
}: {
  boardId: string;
  onClose: () => void;
}) {
  const [state, setState] = useState<LinkState>({ status: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    getShareLink(boardId)
      .then((link) => {
        if (active) setState({ status: "ready", link });
      })
      .catch((err: unknown) => {
        if (active)
          setState({ status: "failed", message: sharingErrorMessage(err) });
      });
    return () => {
      active = false;
    };
  }, [boardId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function copy(url: string) {
    const copied = await copyText(url, field.current);
    setNotice(
      copied
        ? { kind: "info", text: "Link copied." }
        : { kind: "error", text: "Copy failed. Select the link and copy it." },
    );
  }

  async function reset() {
    setResetting(true);
    try {
      const link = await resetShareLink(boardId);
      setState({ status: "ready", link });
      setNotice({
        kind: "info",
        text: "New link created. The previous link no longer works.",
      });
    } catch (err: unknown) {
      setNotice({ kind: "error", text: sharingErrorMessage(err) });
    } finally {
      setResetting(false);
      setConfirming(false);
    }
  }

  return (
    <div className="share-backdrop">
      <div
        className="share-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-title"
      >
        <h2 id="share-title">Share board</h2>
        {state.status === "loading" && <p>Loading…</p>}
        {state.status === "failed" && <p role="alert">{state.message}</p>}
        {state.status === "ready" && (
          <>
            <p>Anyone with this link can open and edit the board.</p>
            <div className="share-link">
              <input
                ref={field}
                aria-label="Board link"
                readOnly
                value={state.link.url}
                onFocus={(event) => {
                  event.currentTarget.select();
                }}
              />
              <button type="button" onClick={() => void copy(state.link.url)}>
                Copy link
              </button>
            </div>
            {confirming ? (
              <div
                className="share-confirm"
                role="group"
                aria-label="Confirm reset"
              >
                <p>
                  Reset the link? The current link will stop working and people
                  who joined by it will lose access.
                </p>
                <div className="share-actions">
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={() => void reset()}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    disabled={resetting}
                    onClick={() => {
                      setConfirming(false);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setNotice(null);
                  setConfirming(true);
                }}
              >
                Reset link
              </button>
            )}
          </>
        )}
        {notice && (
          <p
            role={notice.kind === "error" ? "alert" : "status"}
            className={notice.kind === "error" ? "share-error" : undefined}
          >
            {notice.text}
          </p>
        )}
        <div className="share-actions share-footer">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
