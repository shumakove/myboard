import { useState } from "react";
import { Button, TextField } from "../ui";
import { URL_MAX_LENGTH, type ObjectLink } from "./embedData";

/** EMB-03: ссылка одного выделенного незаблокированного объекта. */
export interface LinkActions {
  current: ObjectLink | null;
  /** Адрес из поля; `false` — адрес не подошёл. */
  attach: (text: string) => boolean;
  /** Выбрать объект этой доски из списка. */
  pickObject: () => void;
  remove: () => void;
}

/** Кнопка Link панели выделения и её поля. */
export function LinkControls({ link }: { link: LinkActions }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const { current } = link;
  const value = draft ?? (current?.kind === "url" ? current.url : "");

  function attach() {
    const done = link.attach(value);
    setError(!done);
    if (done) {
      setDraft(null);
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          setOpen((on) => !on);
        }}
      >
        Link
      </Button>
      {open && (
        <span role="group" aria-label="Link" className="selection-more">
          <TextField
            label="Link address"
            type="text"
            inputMode="url"
            maxLength={URL_MAX_LENGTH}
            value={value}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") attach();
            }}
          />
          <Button variant="ghost" onClick={attach}>
            Attach link
          </Button>
          <Button variant="ghost" onClick={link.pickObject}>
            Link to object
          </Button>
          {current !== null && (
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(null);
                link.remove();
              }}
            >
              Remove link
            </Button>
          )}
          {error && (
            <span role="alert" className="ui-error">
              Enter an http or https address.
            </span>
          )}
        </span>
      )}
    </>
  );
}
