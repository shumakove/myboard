import { useState } from "react";
import { Button, Dialog } from "../ui";

/** FIL-02: выбор страниц PDF, которые станут отдельными объектами. */
export function PdfExtractDialog({
  pages,
  onExtract,
  onClose,
}: {
  pages: number;
  onExtract: (pages: number[]) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (page: number) => {
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(page)) next.add(page);
      return next;
    });
  };
  return (
    <Dialog title="Extract pages" onClose={onClose}>
      <div className="pdf-pages" role="group" aria-label="Pages">
        {Array.from({ length: pages }, (_, index) => index + 1).map((page) => (
          <label key={page} className="pdf-page-choice">
            <input
              type="checkbox"
              checked={chosen.has(page)}
              onChange={() => {
                toggle(page);
              }}
            />
            Page {page}
          </label>
        ))}
      </div>
      <div className="pdf-pages-actions">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={chosen.size === 0}
          onClick={() => {
            onExtract([...chosen]);
          }}
        >
          Extract
        </Button>
      </div>
    </Dialog>
  );
}
