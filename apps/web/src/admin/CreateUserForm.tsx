import { useState, type SubmitEvent } from "react";
import { Button, TextField } from "../ui";
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
    <section
      aria-labelledby="create-user-title"
      className="ui-panel page-section"
    >
      <h2 id="create-user-title">Create user</h2>
      <form className="ui-form admin-form" onSubmit={(e) => void submit(e)}>
        <TextField
          label="Name"
          name="name"
          required
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <TextField
          label="Email"
          type="email"
          name="email"
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
          autoComplete="new-password"
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
          Create user
        </Button>
      </form>
    </section>
  );
}
