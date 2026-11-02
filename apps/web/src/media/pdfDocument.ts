import type { PDFDocumentProxy } from "pdfjs-dist";

/**
 * PDF в браузере (FIL-02): pdf.js и его воркер грузятся отдельно от приложения и только
 * когда на доске появляется PDF (docs/decisions.md, T7.2).
 */

/** Большая сторона отрисованной страницы, пиксели холста. */
const RENDER_SIDE = 1400;

export interface PdfInfo {
  pages: number;
  /** Размер первой страницы. */
  page: { width: number; height: number };
}

async function loadLibrary() {
  const [library, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  library.GlobalWorkerOptions.workerSrc = worker.default;
  return library;
}

/** Страниц и размер первой страницы; не PDF или защищённый паролем — отказ. */
export async function readPdf(file: Blob): Promise<PdfInfo> {
  const library = await loadLibrary();
  const task = library.getDocument({ data: await file.arrayBuffer() });
  try {
    const document = await task.promise;
    const page = await document.getPage(1);
    const { width, height } = page.getViewport({ scale: 1 });
    return { pages: document.numPages, page: { width, height } };
  } finally {
    await task.destroy();
  }
}

/** Открытые файлы: страницы одного PDF на доске разбирают его один раз. */
const opened = new Map<string, Promise<PDFDocumentProxy>>();

function openPdf(url: string): Promise<PDFDocumentProxy> {
  const known = opened.get(url);
  if (known !== undefined) return known;
  const document = loadLibrary().then(
    (library) => library.getDocument({ url }).promise,
  );
  // Неудача не запоминается: доступ к файлу могут вернуть.
  document.catch(() => opened.delete(url));
  opened.set(url, document);
  return document;
}

/** Нарисовать страницу на холсте; `signal` отменяет отрисовку без ошибки. */
export async function renderPdfPage(
  url: string,
  pageNumber: number,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<void> {
  const document = await openPdf(url);
  if (isAborted(signal)) return;
  const page = await document.getPage(pageNumber);
  if (isAborted(signal)) return;
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: RENDER_SIDE / Math.max(base.width, base.height),
  });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const render = page.render({ canvas, viewport });
  const cancel = () => {
    render.cancel();
  };
  signal.addEventListener("abort", cancel);
  try {
    await render.promise;
  } catch (error) {
    if (!isAborted(signal)) throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

/** Отмена приходит, пока идёт ожидание: значение нужно читать заново. */
function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
