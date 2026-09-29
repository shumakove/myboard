import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { board, installFakeLibraryServer } from "../library/fakeLibraryServer";
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

describe("/boards/{id} — своя доска (BRD-01)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("показывает название доски и ссылку на список", async () => {
    installFakeLibraryServer({ boards: [board("b-1", "Roadmap")] });
    openAt("/boards/b-1");

    expect(
      await screen.findByRole("heading", { level: 1, name: "Roadmap" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← All boards" })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("несуществующая или чужая доска — «не найдена»", async () => {
    installFakeLibraryServer({ boards: [board("b-1", "Roadmap")] });
    openAt("/boards/b-404");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Board not found.",
    );
    expect(screen.queryByText("Roadmap")).toBeNull();
  });

  it("без сессии ведёт на /login", async () => {
    installFakeLibraryServer({ signedIn: false });
    const location = openAt("/boards/b-1");

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
  });
});
