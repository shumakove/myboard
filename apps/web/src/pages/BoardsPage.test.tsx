import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { installFakeAccountServer, USER } from "../account/fakeAccountServer";
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

/** Названия досок в списке `name` в порядке показа. */
async function titlesIn(name: "All boards" | "Recent boards") {
  const list = await screen.findByRole("list", { name });
  return within(list)
    .getAllByRole("listitem")
    .map((item) => item.getAttribute("aria-label") ?? item.textContent);
}

function row(title: string) {
  const list = screen.getByRole("list", { name: "All boards" });
  return within(list).getByRole("listitem", { name: title });
}

const BOARDS = [
  board("b-1", "Roadmap", 1),
  board("b-2", "team retro", 3),
  board("b-3", "Alpha plan", 2),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/ — доступ пользователя досок (ACC-03)", () => {
  it("с живой сессией показывает пользователя без повторного входа", async () => {
    installFakeLibraryServer();
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
    const { account } = installFakeLibraryServer();
    const location = openAt("/");

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Sign out" }));

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
    expect(account.signedIn).toBe(false);
    expect(account.calls).toContainEqual({
      method: "POST",
      path: "/api/logout",
      body: undefined,
    });
  });

  it("ответ 401 на запрос списка (сессия отозвана) уводит на /login", async () => {
    const server = installFakeLibraryServer({ boards: BOARDS });
    const libraryRoute = server.account.extraRoute;
    // Администратор отозвал сессию между проверкой сессии и загрузкой списка.
    server.account.extraRoute = (method, url, body) => {
      if (url.pathname !== "/api/boards") {
        return libraryRoute?.(method, url, body);
      }
      server.account.signedIn = false;
      return Response.json({ detail: "Sign in" }, { status: 401 });
    };
    const location = openAt("/");

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/login");
  });

  it("ошибка сервера 5xx при загрузке списка показывает ошибку и не выбивает", async () => {
    installFakeLibraryServer({ failingPaths: ["/api/boards"] });
    const location = openAt("/");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Something went wrong. Try again.",
    );
    expect(screen.getByText(USER.name)).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
  });
});

describe("/ — список досок (ACC-04, BRD-04)", () => {
  it("показывает недавние и полный список досок пользователя", async () => {
    installFakeLibraryServer({ boards: BOARDS });
    openAt("/");

    expect(await titlesIn("Recent boards")).toEqual([
      "team retro",
      "Alpha plan",
      "Roadmap",
    ]);
    expect(await titlesIn("All boards")).toEqual([
      "team retro",
      "Alpha plan",
      "Roadmap",
    ]);
    expect(
      within(row("Roadmap")).getByRole("link", { name: "Roadmap" }),
    ).toHaveAttribute("href", "/boards/b-1");
  });

  it("без досок предлагает создать первую", async () => {
    installFakeLibraryServer();
    openAt("/");

    expect(
      await screen.findByText("No boards yet. Create your first board."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Recent" })).toBeNull();
  });
});

describe("/ — создание, переименование, удаление (BRD-01…BRD-03)", () => {
  it("BRD-01: New board создаёт доску и сразу открывает её", async () => {
    const server = installFakeLibraryServer();
    const location = openAt("/");

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "New board" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Untitled board" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/boards/board-1");
    expect(server.boards.map((b) => b.title)).toEqual(["Untitled board"]);
  });

  it("BRD-02: новое название видно в полном списке и в недавних", async () => {
    installFakeLibraryServer({ boards: BOARDS });
    openAt("/");
    const user = userEvent.setup();
    await titlesIn("All boards");

    await user.click(
      within(row("Roadmap")).getByRole("button", { name: "Rename" }),
    );
    const input = screen.getByRole("textbox", { name: "Board name" });
    await user.clear(input);
    await user.type(input, "Roadmap 2027{Enter}");

    await waitFor(async () => {
      expect(await titlesIn("All boards")).toEqual([
        "Roadmap 2027",
        "team retro",
        "Alpha plan",
      ]);
    });
    expect((await titlesIn("Recent boards"))[0]).toBe("Roadmap 2027");
  });

  it("BRD-02: отказ сервера показывает ошибку и оставляет форму", async () => {
    installFakeLibraryServer({ boards: BOARDS });
    openAt("/");
    const user = userEvent.setup();
    await titlesIn("All boards");

    await user.click(
      within(row("Roadmap")).getByRole("button", { name: "Rename" }),
    );
    const input = screen.getByRole("textbox", { name: "Board name" });
    await user.clear(input);
    await user.type(input, "   {Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a board name up to 200 characters.",
    );
    expect(input).toBeInTheDocument();
  });

  it("BRD-03: удаление требует подтверждения и убирает доску из списков", async () => {
    const server = installFakeLibraryServer({ boards: BOARDS });
    openAt("/");
    const user = userEvent.setup();
    await titlesIn("All boards");

    await user.click(
      within(row("Roadmap")).getByRole("button", { name: "Delete" }),
    );
    await user.click(
      within(row("Roadmap")).getByRole("button", { name: "Cancel" }),
    );
    expect(server.boards).toHaveLength(3);

    await user.click(
      within(row("Roadmap")).getByRole("button", { name: "Delete" }),
    );
    await user.click(
      within(row("Roadmap")).getByRole("button", { name: "Yes, delete" }),
    );

    await waitFor(async () => {
      expect(await titlesIn("All boards")).toEqual([
        "team retro",
        "Alpha plan",
      ]);
    });
    expect(await titlesIn("Recent boards")).toEqual([
      "team retro",
      "Alpha plan",
    ]);
    expect(server.boards.map((b) => b.id)).not.toContain("b-1");
  });
});

describe("/ — сортировка, фильтр, поиск (BRD-05, BRD-06)", () => {
  it("BRD-05: сортировка по названию запрашивается у сервера", async () => {
    const server = installFakeLibraryServer({ boards: BOARDS });
    openAt("/");
    await titlesIn("All boards");

    await userEvent
      .setup()
      .selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "Name");

    await waitFor(async () => {
      expect(await titlesIn("All boards")).toEqual([
        "Alpha plan",
        "Roadmap",
        "team retro",
      ]);
    });
    expect(server.listQueries.at(-1)?.get("sort")).toBe("title");
  });

  it("BRD-05: фильтр по дате изменения передаёт границу серверу", async () => {
    const server = installFakeLibraryServer({ boards: BOARDS });
    openAt("/");
    await titlesIn("All boards");

    const before = Date.now();
    await userEvent
      .setup()
      .selectOptions(
        screen.getByRole("combobox", { name: "Modified" }),
        "Last 7 days",
      );

    await waitFor(() => {
      expect(server.listQueries.at(-1)?.get("modified_since")).toBeTruthy();
    });
    const since = Date.parse(
      server.listQueries.at(-1)?.get("modified_since") ?? "",
    );
    const week = 7 * 24 * 60 * 60 * 1000;
    expect(since).toBeGreaterThanOrEqual(before - week - 1000);
    expect(since).toBeLessThanOrEqual(Date.now() - week);
    // Доски фиксированного прошлого дня под фильтр не попадают.
    expect(await screen.findByText("No boards match.")).toBeInTheDocument();
  });

  it("BRD-06: поиск по части названия выполняет сервер", async () => {
    const server = installFakeLibraryServer({ boards: BOARDS });
    openAt("/");
    await titlesIn("All boards");
    const user = userEvent.setup();

    await user.type(
      screen.getByRole("searchbox", { name: "Search boards" }),
      "RETRO",
    );

    await waitFor(async () => {
      expect(await titlesIn("All boards")).toEqual(["team retro"]);
    });
    expect(server.listQueries.at(-1)?.get("q")).toBe("RETRO");
    // Недавние поиском не сужаются.
    expect(await titlesIn("Recent boards")).toHaveLength(3);

    await user.type(
      screen.getByRole("searchbox", { name: "Search boards" }),
      "zzz",
    );
    expect(await screen.findByText("No boards match.")).toBeInTheDocument();
  });
});
