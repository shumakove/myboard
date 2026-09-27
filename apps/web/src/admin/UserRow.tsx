import { useState, type SubmitEvent } from "react";
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
          <td>{status}</td>
        </>
      )}
      <td>
        <div className="admin-actions">
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => void save({ disabled: !user.disabled })}
          >
            {user.disabled ? "Enable" : "Disable"}
          </button>
        </div>
        {error && (
          <p className="admin-error" role="alert">
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
    <form className="admin-form admin-form-inline" onSubmit={submit}>
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
        New password
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          placeholder="Leave empty to keep"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
        />
      </label>
      <div className="admin-actions">
        <button type="submit" disabled={pending}>
          Save
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
