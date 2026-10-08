import { Link, useLocation } from "wouter";
import { signOut } from "../admin/adminApi";
import { UserAccounts } from "../admin/UserAccounts";
import { useAdminSession } from "../admin/useAdminSession";
import "../admin/admin.css";
import { Button, FloatingPanel } from "../ui";

/** `/admin/users` — учётные записи пользователей досок (ADM-02…ADM-07). */
export function AdminUsersPage() {
  const session = useAdminSession();
  const [, navigate] = useLocation();

  async function leave() {
    try {
      await signOut();
    } finally {
      navigate("/admin/login");
    }
  }

  return (
    <main className="page admin-page">
      <FloatingPanel className="page-header">
        <h1>Users</h1>
        {session.status === "signedIn" && (
          <div className="page-user">
            <span>{session.email}</span>
            <Button onClick={() => void leave()}>Sign out</Button>
          </div>
        )}
      </FloatingPanel>
      {session.status === "loading" && <p>Loading…</p>}
      {session.status === "signedOut" && (
        <p>
          Sign in as an administrator to manage user accounts.{" "}
          <Link href="/admin/login">Sign in</Link>
        </p>
      )}
      {session.status === "signedIn" && <UserAccounts />}
    </main>
  );
}
