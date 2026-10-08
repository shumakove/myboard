import { useEffect, useState } from "react";
import { errorMessage, listUsers, type User } from "./adminApi";
import { CreateUserForm } from "./CreateUserForm";
import { UserRow } from "./UserRow";

/** Список учётных записей (ADM-02) с созданием (ADM-03) и правкой строк (ADM-04…ADM-06). */
export function UserAccounts() {
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listUsers()
      .then((list) => {
        if (active) setUsers(list);
      })
      .catch((err: unknown) => {
        if (active) setError(errorMessage(err));
      });
    return () => {
      active = false;
    };
  }, []);

  function replace(updated: User) {
    setUsers((list) =>
      list ? list.map((u) => (u.id === updated.id ? updated : u)) : list,
    );
  }

  return (
    <>
      <CreateUserForm
        onCreated={(user) => {
          setUsers((list) => [...(list ?? []), user]);
        }}
      />
      <section
        aria-labelledby="accounts-title"
        className="ui-panel page-section"
      >
        <h2 id="accounts-title">Accounts</h2>
        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
        {users === null && !error && <p>Loading…</p>}
        {users?.length === 0 && <p>No user accounts yet.</p>}
        {users && users.length > 0 && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow key={user.id} user={user} onChange={replace} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
