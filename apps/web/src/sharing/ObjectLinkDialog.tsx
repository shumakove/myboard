import { useEffect, useRef, useState } from "react";
import { Button, Dialog, Input } from "../ui";
import { copyText } from "./copyText";
import { objectLink } from "./objectLink";
import { sharingErrorMessage } from "./sharingApi";
import "./sharing.css";

type LinkState =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "failed"; message: string };

type Notice = { kind: "info" | "error"; text: string } | null;

/**
 * SHR-07: «Copy link to object» — ссылка на доску с id объекта. Ссылка показывается
 * в поле: без защищённого контекста (http в локальной сети) копируется его выделение.
 */
export function ObjectLinkDialog({
  objectId,
  boardLink,
  onClose,
}: {
  objectId: string;
  /** Действующая ссылка на доску. */
  boardLink: () => Promise<string>;
  onClose: () => void;
}) {
  const [state, setState] = useState<LinkState>({ status: "loading" });
  const [notice, setNotice] = useState<Notice>(null);
  const field = useRef<HTMLInputElement>(null);

  // Ссылка запрашивается один раз на объект, а не при каждой перерисовке доски.
  const load = useRef(boardLink);
  useEffect(() => {
    let active = true;
    load
      .current()
      .then((url) => {
        if (active)
          setState({ status: "ready", url: objectLink(url, objectId) });
      })
      .catch((err: unknown) => {
        if (active)
          setState({ status: "failed", message: sharingErrorMessage(err) });
      });
    return () => {
      active = false;
    };
  }, [objectId]);

  async function copy(url: string) {
    const copied = await copyText(url, field.current);
    setNotice(
      copied
        ? { kind: "info", text: "Link copied." }
        : { kind: "error", text: "Copy failed. Select the link and copy it." },
    );
  }

  return (
    <Dialog title="Link to object" onClose={onClose}>
      {state.status === "loading" && <p>Loading…</p>}
      {state.status === "failed" && <p role="alert">{state.message}</p>}
      {state.status === "ready" && (
        <>
          <p>Anyone with the board link opens the board at this object.</p>
          <div className="share-link">
            <Input
              ref={field}
              aria-label="Object link"
              readOnly
              value={state.url}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
            <Button variant="primary" onClick={() => void copy(state.url)}>
              Copy link
            </Button>
          </div>
        </>
      )}
      {notice && (
        <p
          role={notice.kind === "error" ? "alert" : "status"}
          className={notice.kind === "error" ? "ui-error" : "ui-muted"}
        >
          {notice.text}
        </p>
      )}
      <div className="share-actions share-footer">
        <Button onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
