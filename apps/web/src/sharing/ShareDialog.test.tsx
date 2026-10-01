import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { board } from "../library/fakeLibraryServer";
import { AppRoutes } from "../routes";

import {
  BASE_URL,
  installFakeSharingServer,
  stubCopyCommand,
} from "./fakeSharingServer";

// На странице доски есть и строка состояния связи — сообщения ищутся в диалоге.
const dialog = () => screen.getByRole("dialog", { name: "Share board" });

function openBoard(id = "b-1") {
  const location = memoryLocation({ path: `/boards/${id}` });
  render(
    <Router hook={location.hook}>
      <AppRoutes />
    </Router>,
  );
}

async function openShareDialog() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Share" }));
  const field = await screen.findByRole<HTMLInputElement>("textbox", {
    name: "Board link",
  });
  return { user, field };
}

describe("диалог Share на /boards/{id} (SHR-01, SHR-06)", () => {
  let copyCommand: ReturnType<typeof stubCopyCommand>;

  beforeEach(() => {
    // Страница открыта по http в LAN: копирование идёт через выделение поля.
    copyCommand = stubCopyCommand();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("SHR-01: показывает ссылку, собранную сервером из PUBLIC_BASE_URL", async () => {
    installFakeSharingServer({
      boards: [board("b-1", "Roadmap")],
      links: { "b-1": "tok-1" },
    });
    openBoard();

    const { field } = await openShareDialog();

    expect(screen.getByRole("dialog", { name: "Share board" })).toBeVisible();
    expect(field).toHaveValue(`${BASE_URL}/b/tok-1`);
    expect(field).toHaveAttribute("readonly");
  });

  it("SHR-01: копирует ссылку и сообщает об этом", async () => {
    installFakeSharingServer({
      boards: [board("b-1", "Roadmap")],
      links: { "b-1": "tok-1" },
    });
    openBoard();
    const { user, field } = await openShareDialog();

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(copyCommand).toHaveBeenCalledWith("copy");
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
    expect(await within(dialog()).findByRole("status")).toHaveTextContent(
      "Link copied.",
    );
  });

  it("SHR-01: если копирование недоступно — просит скопировать вручную", async () => {
    stubCopyCommand(false);
    installFakeSharingServer({ boards: [board("b-1", "Roadmap")] });
    openBoard();
    const { user } = await openShareDialog();

    await user.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Copy failed. Select the link and copy it.",
    );
  });

  it("SHR-06: сброс подтверждается в диалоге и показывает новую ссылку", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    const server = installFakeSharingServer({
      boards: [board("b-1", "Roadmap")],
      links: { "b-1": "tok-1" },
    });
    openBoard();
    const { user, field } = await openShareDialog();

    await user.click(screen.getByRole("button", { name: "Reset link" }));
    const confirmation = screen.getByRole("group", { name: "Confirm reset" });
    expect(confirmation).toHaveTextContent("will stop working");
    expect(field).toHaveValue(`${BASE_URL}/b/tok-1`);
    await user.click(screen.getByRole("button", { name: "Reset" }));

    const renewed = `${BASE_URL}/b/${server.links["b-1"] ?? ""}`;
    expect(server.links["b-1"]).not.toBe("tok-1");
    expect(await screen.findByDisplayValue(renewed)).toBe(field);
    expect(within(dialog()).getByRole("status")).toHaveTextContent(
      "The previous link no longer works.",
    );
    expect(screen.queryByRole("group", { name: "Confirm reset" })).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("SHR-06: отмена подтверждения ссылку не меняет", async () => {
    const server = installFakeSharingServer({
      boards: [board("b-1", "Roadmap")],
      links: { "b-1": "tok-1" },
    });
    openBoard();
    const { user, field } = await openShareDialog();

    await user.click(screen.getByRole("button", { name: "Reset link" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(server.links["b-1"]).toBe("tok-1");
    expect(field).toHaveValue(`${BASE_URL}/b/tok-1`);
    expect(
      server.library.account.calls.filter((c) => c.path.endsWith("/reset")),
    ).toEqual([]);
  });

  it("закрывается кнопкой Close и клавишей Escape", async () => {
    installFakeSharingServer({ boards: [board("b-1", "Roadmap")] });
    openBoard();
    const { user } = await openShareDialog();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    await openShareDialog();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
