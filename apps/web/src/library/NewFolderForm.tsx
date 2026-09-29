import { useState, type SubmitEvent } from "react";
import { createFolder, errorMessage, type Folder } from "./libraryApi";

/** BRD-09: форма новой папки — на верхнем уровне или внутри `parentId`. */
export function NewFolderForm({
  parentId,
  onCreated,
  onCancel,
}: {
  parentId: string | null;
  onCreated: (folder: Folder) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onCreated(await createFolder(title, parentId));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <form className="library-folder-form" onSubmit={(e) => void submit(e)}>
      <input
        aria-label="Folder name"
        placeholder="Folder name"
        value={title}
        maxLength={200}
        required
        autoFocus
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
      <button type="submit" disabled={pending}>
        Create
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
      {error && (
        <p className="account-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
