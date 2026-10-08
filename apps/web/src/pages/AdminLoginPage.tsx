import { useState, type SubmitEvent } from "react";
import { Redirect, useLocation } from "wouter";
import { errorMessage, signIn } from "../admin/adminApi";
import { useAdminSession } from "../admin/useAdminSession";
import { Button, FloatingPanel, TextField } from "../ui";

/** `/admin/login` — вход администратора (ADM-01). */
export function AdminLoginPage() {
  const session = useAdminSession();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (session.status === "signedIn") {
    return <Redirect to="/admin/users" replace />;
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/admin/users");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <main className="auth-page">
      <FloatingPanel className="auth-card">
        <h1>Admin sign in</h1>
        <form className="ui-form" onSubmit={(e) => void submit(e)}>
          <TextField
            label="Email"
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
          {error && (
            <p className="ui-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={pending}>
            Sign in
          </Button>
        </form>
      </FloatingPanel>
    </main>
  );
}
