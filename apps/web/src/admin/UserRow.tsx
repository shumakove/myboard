import { useState, type SubmitEvent } from "react";
import { Button, TextField } from "../ui";
import {
  errorMessage,
  updateUser,
  type User,
  type UserUpdate,
} from "./adminApi";

/** Строка учётки: правка имени, почты и пароля (ADM-04), отключение и включение (ADM-05, ADM-06). */
export function UserRow({
  user,
  onChange,
}: {
  user: User;
  onChange: (user: User) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save(changes: UserUpdate): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      onChange(await updateUser(user.id, changes));
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setPending(false);
    }
  }

  const status = user.disabled ? "Disabled" : "Active";

  return (
    <tr aria-label={user.email}>
      {editing ? (
        <td colSpan={3}>
          <EditUserForm
            user={user}
            pending={pending}
            onSave={async (changes) => {
              if (await save(changes)) setEditing(false);
            }}
            onCancel={() => {
              setEditing(false);
              setError(null);
            }}
          />
        </td>
      ) : (
        <>
          <td>{user.name}</td>
          <td className="admin-email">{user.email}</td>
          <td className="admin-status" data-disabled={user.disabled}>
            {status}
          </td>
        </>
      )}
      <td>
        <div className="admin-actions">
          {!editing && (
            <Button
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )}
          <Button
            variant={user.disabled ? "secondary" : "danger"}
            disabled={pending}
            onClick={() => void save({ disabled: !user.disabled })}
          >
            {user.disabled ? "Enable" : "Disable"}
          </Button>
        </div>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </td>
    </tr>
  );
}

function EditUserForm({
  user,
  pending,
  onSave,
  onCancel,
}: {
  user: User;
  pending: boolean;
  onSave: (changes: UserUpdate) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState("");

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // Пустой пароль — оставить прежний.
    const changes: UserUpdate = { name, email };
    if (password) changes.password = password;
    void onSave(changes);
  }

  return (
    <form className="ui-form admin-form admin-form-inline" onSubmit={submit}>
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
        label="New password"
        type="password"
        name="password"
        autoComplete="new-password"
        placeholder="Leave empty to keep"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value);
        }}
      />
      <div className="admin-actions">
        <Button type="submit" variant="primary" disabled={pending}>
          Save
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}
