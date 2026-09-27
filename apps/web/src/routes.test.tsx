import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "./routes";

const token = "Q".repeat(43);

function openPath(path: string) {
  const { hook, searchHook } = memoryLocation({ path, static: true });
  render(
    <Router hook={hook} searchHook={searchHook}>
      <AppRoutes />
    </Router>,
  );
}

describe("маршруты интерфейса (ARCHITECTURE.md, раздел 4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["/login", "Sign in"],
    ["/", "Boards"],
    ["/boards/42", "Board"],
    ["/templates", "Templates"],
    [`/t/${token}`, "Copy template"],
    ["/admin/login", "Admin sign in"],
    ["/admin/users", "Users"],
    [`/b/${token}`, "Shared board"],
    [`/b/${token}/embed`, "Embedded board"],
    [`/b/${token}?object=obj-1`, "Shared board"],
  ])("%s открывает страницу «%s» без ошибок в консоли", (path, title) => {
    const consoleError = vi.spyOn(console, "error");
    const consoleWarn = vi.spyOn(console, "warn");

    openPath(path);

    expect(
      screen.getByRole("heading", { level: 1, name: title }),
    ).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it.each(["/nope", "/boards", "/b", `/b/${token}/embed/extra`])(
    "неизвестный путь %s показывает «Page not found»",
    (path) => {
      openPath(path);

      expect(
        screen.getByRole("heading", { level: 1, name: "Page not found" }),
      ).toBeInTheDocument();
    },
  );
});
