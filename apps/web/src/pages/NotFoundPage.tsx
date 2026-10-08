import { FloatingPanel } from "../ui";

/** Любой путь вне таблицы маршрутов (ARCHITECTURE.md, раздел 4). */
export function NotFoundPage() {
  return (
    <main className="auth-page">
      <FloatingPanel className="auth-card">
        <h1>Page not found</h1>
      </FloatingPanel>
    </main>
  );
}
