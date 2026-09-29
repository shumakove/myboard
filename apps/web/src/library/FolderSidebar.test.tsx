import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppRoutes } from "../routes";
import { executeMove } from "./dropTargets";
import { board, folder, installFakeLibraryServer } from "./fakeLibraryServer";

function openBoards() {
  const location = memoryLocation({ path: "/" });
  return render(
    <Router hook={location.hook}>
      <AppRoutes />
    </Router>,
  );
}

const sidebar = () =>
  screen.getByRole("complementary", { name: "Folders and favorites" });

/** Папка в дереве (не в избранном). */
const folderItem = (title: string) =>
  within(screen.getByRole("list", { name: "Folders" })).getByRole("listitem", {
    name: title,
  });

/** Кнопка-название папки: сворачивает и разворачивает её. */
const toggle = (title: string) =>
  within(folderItem(title)).getByRole("button", { name: title });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("папки (BRD-09, BRD-11)", () => {
  it("создаёт папку на верхнем уровне и папку в папке в папке", async () => {
    const server = installFakeLibraryServer();
    const user = userEvent.setup();
    openBoards();

    expect(await screen.findByText("No folders yet.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "New folder" }));
    await user.type(
      screen.getByRole("textbox", { name: "Folder name" }),
      "Work",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    await within(sidebar()).findByRole("listitem", { name: "Work" });

    await user.click(
      screen.getByRole("button", { name: "New folder in Work" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Folder name" }),
      "Projects",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));
    // Родитель раскрывается, чтобы новая папка была видна.
    await within(sidebar()).findByRole("listitem", { name: "Projects" });

    await user.click(
      screen.getByRole("button", { name: "New folder in Projects" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Folder name" }),
      "Alpha",
    );
    await user.click(screen.getByRole("button", { name: "Create" }));

    const alpha = await within(sidebar()).findByRole("listitem", {
      name: "Alpha",
    });
    expect(
      within(folderItem("Projects")).getByRole("list", {
        name: "Contents of Projects",
      }),
    ).toContainElement(alpha);
    expect(server.folders.map((f) => [f.title, f.parent_id])).toEqual([
      ["Work", null],
      ["Projects", "folder-1"],
      ["Alpha", "folder-2"],
    ]);
  });

  it("сворачивает и разворачивает папку, состояние переживает перезагрузку", async () => {
    installFakeLibraryServer({
      folders: [folder("work", "Work", 0)],
      boards: [board("b1", "Plan", 1, { folder_id: "work" })],
    });
    const user = userEvent.setup();
    const { unmount } = openBoards();

    await screen.findByRole("list", { name: "Folders" });
    expect(toggle("Work")).toHaveAttribute("aria-expanded", "false");
    expect(within(sidebar()).queryByRole("link", { name: "Plan" })).toBeNull();

    await user.click(toggle("Work"));
    expect(toggle("Work")).toHaveAttribute("aria-expanded", "true");
    expect(
      within(sidebar()).getByRole("link", { name: "Plan" }),
    ).toHaveAttribute("href", "/boards/b1");

    unmount();
    openBoards();
    await screen.findByRole("list", { name: "Contents of Work" });

    await user.click(toggle("Work"));
    expect(toggle("Work")).toHaveAttribute("aria-expanded", "false");
    expect(within(sidebar()).queryByRole("link", { name: "Plan" })).toBeNull();
  });

  it("показывает ошибку, если название папки не принято", async () => {
    installFakeLibraryServer();
    const user = userEvent.setup();
    openBoards();

    await user.click(await screen.findByRole("button", { name: "New folder" }));
    await user.type(screen.getByRole("textbox", { name: "Folder name" }), "  ");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a folder name up to 200 characters.",
    );
  });
});

describe("избранное (BRD-07)", () => {
  it("доска добавляется в избранное и убирается", async () => {
    const server = installFakeLibraryServer({
      boards: [board("b1", "Plan", 1)],
    });
    const user = userEvent.setup();
    openBoards();

    const list = await screen.findByRole("list", { name: "All boards" });
    const star = within(
      within(list).getByRole("listitem", { name: "Plan" }),
    ).getByRole("button", { name: "Favorite" });
    expect(star).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("list", { name: "Favorites" })).toBeNull();

    await user.click(star);

    const favorites = await screen.findByRole("list", { name: "Favorites" });
    expect(
      within(favorites).getByRole("link", { name: "Plan" }),
    ).toBeInTheDocument();
    expect(server.boards[0]?.favorite).toBe(true);
    await waitFor(() => {
      expect(
        within(within(list).getByRole("listitem", { name: "Plan" })).getByRole(
          "button",
          {
            name: "Favorite",
          },
        ),
      ).toHaveAttribute("aria-pressed", "true");
    });

    await user.click(
      within(favorites).getByRole("button", { name: "Favorite" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("list", { name: "Favorites" })).toBeNull();
    });
    expect(server.boards[0]?.favorite).toBe(false);
  });

  it("папка в избранном раскрывается в дереве по нажатию", async () => {
    const server = installFakeLibraryServer({
      folders: [
        folder("work", "Work", 0),
        folder("deep", "Deep", 0, { parent_id: "work" }),
      ],
    });
    const user = userEvent.setup();
    openBoards();

    await screen.findByRole("list", { name: "Folders" });
    await user.click(toggle("Work"));
    await user.click(
      within(folderItem("Deep")).getByRole("button", { name: "Favorite" }),
    );
    await user.click(toggle("Work")); // свернуть: Deep скрыта
    expect(
      within(folderItem("Work")).queryByRole("listitem", { name: "Deep" }),
    ).toBeNull();

    const favorites = await screen.findByRole("list", { name: "Favorites" });
    await user.click(within(favorites).getByRole("button", { name: "Deep" }));

    expect(toggle("Deep")).toHaveFocus();
    expect(server.folders.find((f) => f.id === "deep")?.favorite).toBe(true);
  });
});

describe("поиск папок (BRD-06)", () => {
  it("находит папку по части названия и показывает её в дереве", async () => {
    installFakeLibraryServer({
      folders: [
        folder("work", "Work", 0),
        folder("q3", "Q3 projects", 0, { parent_id: "work" }),
        folder("home", "Home", 1),
      ],
    });
    const user = userEvent.setup();
    openBoards();

    await user.type(
      await screen.findByRole("searchbox", { name: "Search boards" }),
      "PROJ",
    );

    const found = await screen.findByRole("list", { name: "Matching folders" });
    const item = within(found).getByRole("listitem", { name: "Q3 projects" });
    expect(item).toHaveTextContent("Work / Q3 projects");
    expect(within(found).queryByRole("listitem", { name: "Home" })).toBeNull();

    await user.click(within(item).getByRole("button", { name: "Q3 projects" }));

    expect(toggle("Q3 projects")).toHaveFocus();
  });
});

describe("перетаскивание (BRD-10): перенос на сервере", () => {
  it("папка встаёт на новое место, доска переходит в папку", async () => {
    const server = installFakeLibraryServer({
      folders: [folder("a", "A", 0), folder("b", "B", 1)],
      boards: [board("b1", "Plan", 1)],
    });

    await executeMove({ kind: "folder", id: "b", parentId: null, position: 0 });
    await executeMove({ kind: "board", id: "b1", folderId: "a" });

    expect(
      [...server.folders]
        .sort((x, y) => x.position - y.position)
        .map((f) => f.id),
    ).toEqual(["b", "a"]);
    expect(server.boards[0]?.folder_id).toBe("a");
  });

  it("вложение в свою дочернюю отклоняется сервером с понятным текстом", async () => {
    installFakeLibraryServer({
      folders: [
        folder("a", "A", 0),
        folder("child", "Child", 0, { parent_id: "a" }),
      ],
    });

    await expect(
      executeMove({ kind: "folder", id: "a", parentId: "child", position: 0 }),
    ).rejects.toThrow("A folder cannot be moved into itself or its subfolder.");
  });
});
