import { useState, type SubmitEvent } from "react";
import { createUser, errorMessage, type User } from "./adminApi";

/** ADM-03: новая учётка с именем, почтой и паролем; повтор почты — ошибка (ADM-07). */
export function CreateUserForm({
  onCreated,
}: {
  onCreated: (user: User) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      onCreated(await createUser({ name, email, password }));
      setName("");
      setEmail("");
      setPassword("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="create-user-title">
      <h2 id="create-user-title">Create user</h2>
      <form className="admin-form" onSubmit={(e) => void submit(e)}>
        <label>
          Name
          <input
            name="name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </label>
        <label>
          Email
          <input
            type="email"
            name="email"
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
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </label>
        {error && (
          <p className="admin-error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" disabled={pending}>
          Create user
        </button>
      </form>
    </section>
  );
}
