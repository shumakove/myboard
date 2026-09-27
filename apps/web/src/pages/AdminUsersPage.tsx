import { Link, useLocation } from "wouter";
import { signOut } from "../admin/adminApi";
import { UserAccounts } from "../admin/UserAccounts";
import { useAdminSession } from "../admin/useAdminSession";
import "../admin/admin.css";

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
    <main className="admin">
      <header className="admin-header">
        <h1>Users</h1>
        {session.status === "signedIn" && (
          <div className="admin-account">
            <span>{session.email}</span>
            <button type="button" onClick={() => void leave()}>
              Sign out
            </button>
          </div>
        )}
      </header>
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
