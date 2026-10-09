import { useState } from "react";
import { Button, Dialog, TextField } from "../ui";

export interface PickableObject {
  id: string;
  label: string;
}

/**
 * TXT-06: выбор объекта этой доски для ссылки из документа — список с отбором по
 * подписи (тип и начало текста). Escape или Cancel — без ссылки.
 */
export function ObjectPicker({
  objects,
  onPick,
  onClose,
}: {
  objects: readonly PickableObject[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = objects.filter((o) => o.label.toLowerCase().includes(needle));
  return (
    <Dialog
      title="Choose object to link"
      onClose={onClose}
      className="object-picker"
    >
      <TextField
        label="Find object"
        type="search"
        value={query}
        autoFocus
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      {shown.length === 0 ? (
        <p role="status">No objects found.</p>
      ) : (
        <ul className="object-picker-list" aria-label="Board objects">
          {shown.map((object) => (
            <li key={object.id}>
              <Button
                variant="ghost"
                className="object-picker-item"
                onClick={() => {
                  onPick(object.id);
                }}
              >
                {object.label}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="object-picker-actions">
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </Dialog>
  );
}
