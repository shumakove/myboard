import { useState, type SubmitEvent } from "react";
import { Redirect, useLocation } from "wouter";
import { errorMessage, signIn } from "../account/accountApi";
import { useAccountSession } from "../account/useAccountSession";
import "../account/account.css";

/** `/login` — вход пользователя досок по почте и паролю (ACC-01, ACC-02). */
export function LoginPage() {
  const session = useAccountSession();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // ACC-03: вошедший раньше пользователь сразу попадает к доскам.
  if (session.status === "signedIn") {
    return <Redirect to="/" replace />;
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <main className="account">
      <h1>Sign in</h1>
      <form className="account-form" onSubmit={(e) => void submit(e)}>
        <label>
          Email
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        {error && (
          <p className="account-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          Sign in
        </button>
      </form>
    </main>
  );
}
