import { useState } from "react";
import { Button, TextField, buttonClass } from "../ui";
import { NAME_MAX_LENGTH } from "./attachmentData";

/** Действия с одним выделенным файлом (T7.2). */
export interface FileActions {
  name: string;
  /** FIL-01: новое имя ярлыка; у заблокированного и у PDF — `null`. */
  rename: ((name: string) => void) | null;
  /** FIL-01: адрес скачивания ярлыка под его именем. */
  download: string | null;
  /** FIL-02: выбрать страницы PDF и извлечь их. */
  extract: (() => void) | null;
}

/** Панель файла в панели выделения: имя, Download (FIL-01), Extract pages (FIL-02). */
export function FileControls({ file }: { file: FileActions }) {
  return (
    <span role="group" aria-label="File" className="selection-mindmap">
      {file.rename && <NameField name={file.name} rename={file.rename} />}
      {file.download !== null && (
        <a
          className={buttonClass("ghost")}
          href={file.download}
          download={file.name}
        >
          Download
        </a>
      )}
      {file.extract && (
        <Button variant="ghost" onClick={file.extract}>
          Extract pages
        </Button>
      )}
    </span>
  );
}

/**
 * Имя правится сразу, каждое изменение видно всем; пока поле в фокусе, в нём то, что
 * набрано (можно на время стереть всё), после — имя из документа.
 */
function NameField({
  name,
  rename,
}: {
  name: string;
  rename: (name: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <TextField
      label="File name"
      value={draft ?? name}
      maxLength={NAME_MAX_LENGTH}
      onChange={(event) => {
        setDraft(event.target.value);
        rename(event.target.value);
      }}
      onBlur={() => {
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
