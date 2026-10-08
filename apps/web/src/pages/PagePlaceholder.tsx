import { FloatingPanel } from "../ui";

/** Заглушка страницы каркаса (T0.3): содержимое появляется в задачах модулей. */
export function PagePlaceholder({ title }: { title: string }) {
  return (
    <main className="auth-page">
      <FloatingPanel className="auth-card">
        <h1>{title}</h1>
        <p>This page is not available yet.</p>
      </FloatingPanel>
    </main>
  );
}
