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

async function signIn(email: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("/login — вход пользователя досок (ACC-01…ACC-03)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ACC-01: почта и пароль от администратора открывают доски", async () => {
    const server = installFakeAccountServer();
    const location = openAt("/login");

    await signIn(USER.email, USER.password);

    expect(await screen.findByText(USER.name)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
    expect(server.calls).toContainEqual({
      method: "POST",
      path: "/api/login",
      body: { email: USER.email, password: USER.password },
    });
  });

  it("ACC-02: отказ показывает скупое сообщение и оставляет на странице входа", async () => {
    installFakeAccountServer();
    const location = openAt("/login");

    await signIn(USER.email, "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password.",
    );
    expect(location.history.at(-1)).toBe("/login");
  });

  it("ACC-02: частые попытки — сообщение о лимите", async () => {
    installFakeAccountServer({ loginStatus: 429 });
    openAt("/login");

    await signIn(USER.email, USER.password);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many sign-in attempts. Try again later.",
    );
  });

  it("ACC-03: вошедший раньше пользователь сразу попадает к доскам", async () => {
    installFakeAccountServer({ signedIn: true });
    const location = openAt("/login");

    expect(await screen.findByText(USER.name)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
  });
});
