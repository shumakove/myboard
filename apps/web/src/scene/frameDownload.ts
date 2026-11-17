/**
 * BUG-035 (EMB-04, FIL-01): скачивание из встроенной доски на чужом сайте.
 *
 * Во фрейме чужого сайта cookie встроенной доски разделена по странице верхнего уровня, и
 * переход-скачивание приходит на сервер без неё (404). Обычный `fetch` той же страницы
 * её несёт, поэтому во фрейме файл читается запросом и сохраняется из памяти.
 */

/** Страница открыта во фрейме другой страницы. */
export function isFramed(view: Window = window): boolean {
  try {
    return view.self !== view.top;
  } catch {
    // Доступ к `top` чужого источника может бросить исключение: значит, фрейм.
    return true;
  }
}

/** Читает файл запросом со страницы и отдаёт браузеру на сохранение под именем `name`. */
export async function downloadThroughFetch(
  url: string,
  name: string,
): Promise<boolean> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) return false;
  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = name;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    // Браузер забирает данные при нажатии; адрес освобождается чуть позже.
    setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, 0);
  }
  return true;
}
