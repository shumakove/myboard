import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { board } from "../library/fakeLibraryServer";
import { installFakeSharingServer } from "../sharing/fakeSharingServer";
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

/** Браузер без учётной записи: сессии пользователя досок нет. */
function guestServer(participants: Record<string, string> = {}) {
  return installFakeSharingServer({
    signedIn: false,
    boards: [board("b-1", "Roadmap")],
    links: { "b-1": "tok-1" },
    participants,
  });
}

describe("/b/{token} — вход по ссылке (SHR-02, SHR-03, SHR-05)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("SHR-03: запрашивает имя, затем пускает на доску без учётной записи", async () => {
    const server = guestServer();
    const location = openAt("/b/tok-1");
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Roadmap" }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("Your name"), "  Kate ");
    await user.click(screen.getByRole("button", { name: "Join board" }));

    expect(await screen.findByText("You joined as Kate.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    // Участник остаётся на странице ссылки и не трогает вход и список досок.
    expect(location.history.at(-1)).toBe("/b/tok-1");
    const paths = server.library.account.calls.map((c) => c.path);
    expect(paths).toEqual(["/api/share/tok-1", "/api/share/tok-1/join"]);
  });

  it("SHR-03: пустое имя не отправляется", async () => {
    const server = guestServer();
    openAt("/b/tok-1");
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Join board" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name.");
    expect(
      server.library.account.calls.filter((c) => c.method === "POST"),
    ).toEqual([]);
  });

  it("SHR-02: уже введённое на этой доске имя не спрашивается повторно", async () => {
    guestServer({ "tok-1": "Kate" });
    openAt("/b/tok-1");

    expect(await screen.findByText("You joined as Kate.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
  });

  it.each(["unknown-token", "tok-old"])(
    "SHR-05: недействующая ссылка %s — отказ без формы имени",
    async (token) => {
      guestServer();
      openAt(`/b/${token}`);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "This link is not available.",
      );
      expect(
        screen.getByRole("heading", { level: 1, name: "Board unavailable" }),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText("Your name")).toBeNull();
      expect(screen.queryByText("Roadmap")).toBeNull();
    },
  );

  it("SHR-06: ссылку сбросили, пока вводилось имя — тот же отказ", async () => {
    const server = guestServer();
    openAt("/b/tok-1");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Your name"), "Kate");

    server.links["b-1"] = "tok-2";
    await user.click(screen.getByRole("button", { name: "Join board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This link is not available.",
    );
    expect(screen.queryByText("Roadmap")).toBeNull();
  });

  it("сбой сети показывает повторяемую ошибку", async () => {
    const server = guestServer();
    server.library.account.offline = true;
    openAt("/b/tok-1");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Network error. Try again.",
    );
  });
});
