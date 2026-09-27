import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { ADMIN, installFakeAdminServer } from "../admin/fakeAdminServer";
import { AppRoutes } from "../routes";

function openAt(path: string) {
  const location = memoryLocation({ path, record: true });
  render(
    <Router hook={location.hook}>
      <AppRoutes />
    </Router>,
  );
  return location;
}

async function signIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("/admin/login — вход администратора (ADM-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("верные почта и пароль открывают список учётных записей", async () => {
    const server = installFakeAdminServer();
    const location = openAt("/admin/login");

    await signIn(ADMIN.email, ADMIN.password);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Users" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/admin/users");
    expect(server.calls).toContainEqual({
      method: "POST",
      path: "/api/admin/login",
      body: { email: ADMIN.email, password: ADMIN.password },
    });
  });

  it("отказ показывает скупое сообщение и оставляет на странице входа", async () => {
    installFakeAdminServer();
    const location = openAt("/admin/login");

    await signIn(ADMIN.email, "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
    expect(location.history.at(-1)).toBe("/admin/login");
  });

  it("частые попытки: сообщение о лимите", async () => {
    installFakeAdminServer({ loginStatus: 429 });
    openAt("/admin/login");

    await signIn(ADMIN.email, ADMIN.password);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many sign-in attempts. Try again later.",
    );
  });

  it("уже вошедший администратор переходит к учётным записям", async () => {
    installFakeAdminServer({ signedIn: true });
    const location = openAt("/admin/login");

    expect(await screen.findByText(ADMIN.email)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/admin/users");
  });

  it("/admin ведёт в панель", async () => {
    installFakeAdminServer();
    const location = openAt("/admin");

    expect(
      await screen.findByRole("link", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/admin/users");
  });
});
