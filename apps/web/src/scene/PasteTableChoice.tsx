import type { Grid } from "./tableExchange";
import { Button, FloatingPanel } from "../ui";

/**
 * TBL-06, TBL-07: из буфера вставляют внешнюю таблицу — пользователь выбирает, вставить её
 * таблицей или набором стикеров (стикер на каждую непустую ячейку).
 */
export function PasteTableChoice({
  grid,
  onTable,
  onStickies,
  onCancel,
}: {
  grid: Grid;
  onTable: () => void;
  onStickies: () => void;
  onCancel: () => void;
}) {
  const rows = grid.length;
  const columns = grid[0]?.length ?? 0;
  return (
    <FloatingPanel
      role="dialog"
      aria-label="Paste table"
      className="board-notice paste-table"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <span>
        Paste {rows} × {columns} table as
      </span>
      <Button autoFocus onClick={onTable}>
        Table
      </Button>
      <Button variant="ghost" onClick={onStickies}>
        Sticky notes
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </FloatingPanel>
  );
}
