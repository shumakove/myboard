import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import {
  installFakeAdminServer,
  makeUser,
  type FakeAdminServer,
} from "../admin/fakeAdminServer";
import { AppRoutes } from "../routes";

function openUsers() {
  const location = memoryLocation({ path: "/admin/users", record: true });
  render(
    <Router hook={location.hook}>
      <AppRoutes />
    </Router>,
  );
  return location;
}

function row(email: string) {
  return screen.getByRole("row", { name: email });
}

async function createUser(name: string, email: string, password: string) {
  const user = userEvent.setup();
  const form = within(screen.getByRole("region", { name: "Create user" }));
  await user.type(form.getByLabelText("Name"), name);
  await user.type(form.getByLabelText("Email"), email);
  await user.type(form.getByLabelText("Password"), password);
  await user.click(form.getByRole("button", { name: "Create user" }));
}

function patches(server: FakeAdminServer) {
  return server.calls.filter((c) => c.method === "PATCH").map((c) => c.body);
}

describe("/admin/users — учётные записи (ADM-02…ADM-07)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("без входа предлагает войти и не запрашивает список", async () => {
    const server = installFakeAdminServer();
    openUsers();

    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/admin/login");
    expect(server.calls.map((c) => c.path)).not.toContain("/api/admin/users");
  });

  it("ADM-02: показывает имя, почту и состояние каждой учётки", async () => {
    installFakeAdminServer({
      signedIn: true,
      users: [
        makeUser({ name: "Alice", email: "alice@example.com" }),
        makeUser({ name: "Bob", email: "bob@example.com", disabled: true }),
      ],
    });
    openUsers();

    expect(
      await screen.findByRole("row", { name: "alice@example.com" }),
    ).toHaveTextContent("Alicealice@example.comActive");
    expect(row("bob@example.com")).toHaveTextContent("Disabled");
  });

  it("ADM-03: созданная учётка появляется в списке, форма очищается", async () => {
    const server = installFakeAdminServer({ signedIn: true });
    openUsers();
    await screen.findByText("No user accounts yet.");

    await createUser("Carol", "carol@example.com", "carol-pw");

    expect(
      await screen.findByRole("row", { name: "carol@example.com" }),
    ).toHaveTextContent("Carol");
    expect(server.calls).toContainEqual({
      method: "POST",
      path: "/api/admin/users",
      body: { name: "Carol", email: "carol@example.com", password: "carol-pw" },
    });
    const form = within(screen.getByRole("region", { name: "Create user" }));
    expect(form.getByLabelText("Email")).toHaveValue("");
  });

  it("ADM-07: повтор почты при создании — ошибка, список не меняется", async () => {
    installFakeAdminServer({
      signedIn: true,
      users: [makeUser({ email: "alice@example.com" })],
    });
    openUsers();
    await screen.findByRole("row", { name: "alice@example.com" });

    await createUser("Other", "alice@example.com", "pw");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Email is already in use.",
    );
    expect(screen.getAllByRole("row")).toHaveLength(2); // заголовок + одна учётка
  });

  it("ADM-04: правка имени, почты и пароля", async () => {
    const alice = makeUser();
    const server = installFakeAdminServer({ signedIn: true, users: [alice] });
    openUsers();
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole("row", { name: alice.email })).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const editing = within(row(alice.email));
    await user.clear(editing.getByLabelText("Name"));
    await user.type(editing.getByLabelText("Name"), "Alice Smith");
    await user.clear(editing.getByLabelText("Email"));
    await user.type(editing.getByLabelText("Email"), "smith@example.com");
    await user.type(editing.getByLabelText("New password"), "new-pw");
    await user.click(editing.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByRole("row", { name: "smith@example.com" }),
    ).toHaveTextContent("Alice Smith");
    expect(patches(server)).toEqual([
      { name: "Alice Smith", email: "smith@example.com", password: "new-pw" },
    ]);
  });

  it("ADM-04: пустое поле пароля оставляет прежний пароль", async () => {
    const alice = makeUser();
    const server = installFakeAdminServer({ signedIn: true, users: [alice] });
    openUsers();
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole("row", { name: alice.email })).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    await user.click(
      within(row(alice.email)).getByRole("button", { name: "Save" }),
    );

    await screen.findByRole("button", { name: "Edit" });
    expect(patches(server)).toEqual([{ name: "Alice", email: alice.email }]);
  });

  it("ADM-07: повтор почты при правке — ошибка, форма остаётся открытой", async () => {
    const bob = makeUser({ name: "Bob", email: "bob@example.com" });
    installFakeAdminServer({
      signedIn: true,
      users: [makeUser({ email: "alice@example.com" }), bob],
    });
    openUsers();
    const user = userEvent.setup();
    await user.click(
      within(await screen.findByRole("row", { name: bob.email })).getByRole(
        "button",
        { name: "Edit" },
      ),
    );

    const editing = within(row(bob.email));
    await user.clear(editing.getByLabelText("Email"));
    await user.type(editing.getByLabelText("Email"), "alice@example.com");
    await user.click(editing.getByRole("button", { name: "Save" }));

    expect(await editing.findByRole("alert")).toHaveTextContent(
      "Email is already in use.",
    );
    expect(editing.getByLabelText("Email")).toBeInTheDocument();
  });

  it("ADM-05, ADM-06: отключение и включение учётки", async () => {
    const alice = makeUser();
    const server = installFakeAdminServer({ signedIn: true, users: [alice] });
    openUsers();
    const user = userEvent.setup();
    const aliceRow = within(
      await screen.findByRole("row", { name: alice.email }),
    );

    await user.click(aliceRow.getByRole("button", { name: "Disable" }));
    expect(await aliceRow.findByText("Disabled")).toBeInTheDocument();

    await user.click(aliceRow.getByRole("button", { name: "Enable" }));
    expect(await aliceRow.findByText("Active")).toBeInTheDocument();
    expect(patches(server)).toEqual([{ disabled: true }, { disabled: false }]);
  });

  it("выход завершает сессию и возвращает на страницу входа", async () => {
    const server = installFakeAdminServer({ signedIn: true });
    const location = openUsers();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Admin sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/admin/login");
    expect(server.signedIn).toBe(false);
  });
});
