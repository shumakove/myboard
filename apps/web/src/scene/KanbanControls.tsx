import { useState } from "react";
import { Button, Dialog, SelectField } from "../ui";
import type { ColumnFate } from "./kanbans";

/** Действия с одним выделенным незаблокированным канбаном (T6.8). */
export interface KanbanActions {
  /** Выбранный столбец (щелчок по заголовку); `null` — не выбран. */
  column: { id: string; title: string } | null;
  /** KBN-02: новая карточка внизу выбранного столбца (без выбора — первого). */
  addCard: () => void;
  /** KBN-03: новый столбец справа от выбранного (без выбора — последним). */
  addColumn: () => void;
  /** KBN-03: правка названия выбранного столбца. */
  renameColumn: (() => void) | null;
  /** KBN-03: удаление выбранного столбца; последний столбец не удаляется. */
  deleteColumn: (() => void) | null;
}

/**
 * Панель канбана (T6.8) в панели выделения: выбранный столбец, новая карточка (KBN-02),
 * добавление, переименование и удаление столбца (KBN-03).
 */
export function KanbanControls({ kanban }: { kanban: KanbanActions }) {
  return (
    <span role="group" aria-label="Kanban" className="selection-kanban">
      <span className="selection-count">
        {kanban.column === null
          ? "Click a column title to select it"
          : `Column: ${kanban.column.title || "Untitled"}`}
      </span>
      <Button variant="ghost" onClick={kanban.addCard}>
        Add card
      </Button>
      <Button variant="ghost" onClick={kanban.addColumn}>
        Add column
      </Button>
      {kanban.renameColumn && (
        <Button variant="ghost" onClick={kanban.renameColumn}>
          Rename column
        </Button>
      )}
      {kanban.deleteColumn && (
        <Button variant="ghost" onClick={kanban.deleteColumn}>
          Delete column
        </Button>
      )}
    </span>
  );
}

/**
 * KBN-03: удаление столбца с карточками — пользователь решает, перенести карточки в другой
 * столбец или удалить их вместе со столбцом.
 */
export function DeleteColumnDialog({
  title,
  cards,
  targets,
  onDelete,
  onCancel,
}: {
  title: string;
  /** Сколько карточек в столбце. */
  cards: number;
  /** Остальные столбцы — куда можно перенести карточки (первый — по умолчанию). */
  targets: readonly { id: string; title: string }[];
  onDelete: (fate: ColumnFate) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState(targets[0]?.id ?? "");
  return (
    <Dialog
      title={`Delete column “${title || "Untitled"}”?`}
      onClose={onCancel}
      className="kanban-delete-dialog"
    >
      <p>
        The column has {cards} {cards === 1 ? "card" : "cards"}. Move them to
        another column or delete them with the column.
      </p>
      <SelectField
        label="Move cards to"
        value={target}
        onChange={(event) => {
          setTarget(event.target.value);
        }}
      >
        {targets.map((column) => (
          <option key={column.id} value={column.id}>
            {column.title || "Untitled"}
          </option>
        ))}
      </SelectField>
      <div className="kanban-dialog-actions">
        <Button
          variant="primary"
          autoFocus
          onClick={() => {
            onDelete({ kind: "move", to: target });
          }}
        >
          Move cards and delete column
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            onDelete({ kind: "delete" });
          }}
        >
          Delete column and cards
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
