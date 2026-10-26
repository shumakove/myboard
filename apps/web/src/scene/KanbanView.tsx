import { COLUMN_WIDTH } from "./kanbanData";
import type { SceneObject } from "./sceneObjects";

/** Столбцы канбана на холсте: выбранный и тот, название которого правят (KBN-03). */
export interface KanbanColumnsState {
  active: string | null;
  editing: string | null;
}

/**
 * Канбан на холсте (T6.8): столбцы слева направо, у каждого — заголовок с названием
 * (KBN-01). Щелчок по заголовку выбирает столбец, двойной — открывает название для правки
 * (KBN-03). Карточки — отдельные объекты сцены поверх столбцов (KBN-02).
 */
export function KanbanView({
  object,
  columns,
}: {
  object: SceneObject;
  columns: KanbanColumnsState | null;
}) {
  const kanban = object.kanban;
  if (kanban === null) return null;
  return (
    <>
      {kanban.columns.map((column) => (
        <div
          key={column.id}
          className="kanban-column"
          data-column={column.id}
          data-active={columns?.active === column.id ? "true" : undefined}
          style={{ left: column.start, width: COLUMN_WIDTH }}
        >
          <div className="kanban-column-header" data-column-title={column.id}>
            {columns?.editing !== column.id && (
              <span className="kanban-column-title">
                {column.title === "" ? "Untitled" : column.title}
              </span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
