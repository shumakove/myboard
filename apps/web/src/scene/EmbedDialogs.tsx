import { useState, type SubmitEvent } from "react";
import { Button, Dialog, TextField } from "../ui";
import { parseIframeCode, typedUrl, type IframeCode } from "./embedData";

const BAD_CODE =
  'Paste an iframe code with an http or https address, for example <iframe src="https://example.com"></iframe>.';
const BAD_ADDRESS = "Enter an http or https address.";

/** EMB-01: код iframe с панели. */
export function EmbedCodeDialog({
  onAdd,
  onClose,
}: {
  onAdd: (code: IframeCode) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseIframeCode(code);
    if (parsed === null) setError(BAD_CODE);
    else onAdd(parsed);
  }

  return (
    <Dialog title="Embed" onClose={onClose}>
      <form className="ui-form" onSubmit={submit}>
        <label className="ui-field">
          Iframe code
          <textarea
            className="ui-input embed-code"
            rows={4}
            value={code}
            autoFocus
            onChange={(event) => {
              setCode(event.target.value);
            }}
          />
        </label>
        {error !== null && (
          <p role="alert" className="ui-error">
            {error}
          </p>
        )}
        <div className="pdf-pages-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Add embed
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** EMB-02: адрес страницы для карточки; название и изображение читает сервер. */
export function LinkCardDialog({
  onAdd,
  onClose,
}: {
  /** Отклоняется текстом ошибки для показа. */
  onAdd: (url: string) => Promise<void>;
  onClose: () => void;
}) {
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = typedUrl(address);
    if (url === null) {
      setError(BAD_ADDRESS);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onAdd(url);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setPending(false);
    }
  }

  return (
    <Dialog title="Link card" onClose={onClose}>
      <form className="ui-form" onSubmit={(event) => void submit(event)}>
        <TextField
          label="Page address"
          type="text"
          inputMode="url"
          autoFocus
          value={address}
          onChange={(event) => {
            setAddress(event.target.value);
          }}
        />
        {error !== null && (
          <p role="alert" className="ui-error">
            {error}
          </p>
        )}
        <div className="pdf-pages-actions">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Reading the page…" : "Add card"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
