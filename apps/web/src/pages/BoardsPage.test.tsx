import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { installFakeAccountServer, USER } from "../account/fakeAccountServer";
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

describe("/ — доступ пользователя досок (ACC-03)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("с живой сессией показывает пользователя без повторного входа", async () => {
    installFakeAccountServer({ signedIn: true });
    const location = openAt("/");

    expect(await screen.findByText(USER.name)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
  });

  it("без сессии ведёт на /login", async () => {
    installFakeAccountServer();
    const location = openAt("/");

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
  });

  it("выход завершает сессию и возвращает на /login", async () => {
    const server = installFakeAccountServer({ signedIn: true });
    const location = openAt("/");

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
    expect(server.signedIn).toBe(false);
    expect(server.calls).toContainEqual({
      method: "POST",
      path: "/api/logout",
      body: undefined,
    });
  });
});
