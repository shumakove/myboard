import { BoardByLink } from "./SharedBoardPage";

/**
 * `/b/{token}/embed` — та же доска во фрейме внешней страницы (EMB-04): имя на сессию, затем
 * рабочий холст. Показ во фрейме разрешает прокси только этому пути (Caddyfile).
 */
export function EmbeddedBoardPage() {
  return <BoardByLink embedded loadingTitle="Embedded board" />;
}
