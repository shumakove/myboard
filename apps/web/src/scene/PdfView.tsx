import { useEffect, useRef, useState } from "react";
import { renderPdfPage } from "../media/pdfDocument";
import { Button } from "../ui";
import type { AttachmentShape } from "./attachmentData";
import { mediaUrl } from "./imageData";

/**
 * FIL-02: PDF на доске постранично. Открытая страница — своя у каждого участника, как и
 * плеер; извлечённая страница (`page`) показывается без листания.
 */
export function PdfView({ file }: { file: AttachmentShape }) {
  const [opened, setOpened] = useState(1);
  const [failed, setFailed] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const page = file.page ?? Math.min(opened, file.pages);
  const url = mediaUrl(file.media);

  useEffect(() => {
    const target = canvas.current;
    if (url === null || target === null) return;
    const abort = new AbortController();
    renderPdfPage(url, page, target, abort.signal).catch(() => {
      setFailed(true);
    });
    return () => {
      abort.abort();
    };
  }, [url, page]);

  if (url === null || failed) {
    return (
      <div className="pdf-view" data-failed="true">
        <span className="media-missing">PDF unavailable</span>
      </div>
    );
  }
  return (
    <div className="pdf-view" data-page={page}>
      <div className="pdf-page">
        <canvas ref={canvas} aria-label={`Page ${String(page)}`} />
      </div>
      {file.page === null && (
        <div className="pdf-bar" data-canvas-ignore="">
          <Button
            variant="ghost"
            disabled={page <= 1}
            onClick={() => {
              setOpened(page - 1);
            }}
          >
            Previous page
          </Button>
          <span className="pdf-count">
            Page {page} of {file.pages}
          </span>
          <Button
            variant="ghost"
            disabled={page >= file.pages}
            onClick={() => {
              setOpened(page + 1);
            }}
          >
            Next page
          </Button>
        </div>
      )}
    </div>
  );
}
