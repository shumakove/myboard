import { describe, expect, it } from "vitest";
import { board, folder } from "./fakeLibraryServer";
import { buildTree, isWithin, pathTo, planMove, zoneAt } from "./folderTree";

// Work ─┬─ Projects ── Alpha
//       └─ Archive
// Home
const FOLDERS = [
  folder("home", "Home", 1),
  folder("work", "Work", 0),
  folder("archive", "Archive", 1, { parent_id: "work" }),
  folder("projects", "Projects", 0, { parent_id: "work" }),
  folder("alpha", "Alpha", 0, { parent_id: "projects" }),
];

const FOLDER_ITEM = (id: string) => ({ kind: "folder", id }) as const;

describe("buildTree (BRD-09)", () => {
  it("вкладывает папки по parent_id в порядке position, доски — по названию", () => {
    const boards = [
      board("b1", "zeta", 0, { folder_id: "work" }),
      board("b2", "Beta", 0, { folder_id: "work" }),
      board("b3", "Top", 0),
    ];

    const tree = buildTree(FOLDERS, boards);

    expect(tree.map((n) => n.folder.title)).toEqual(["Work", "Home"]);
    const work = tree[0];
    expect(work?.children.map((n) => n.folder.title)).toEqual([
      "Projects",
      "Archive",
    ]);
    expect(work?.children[0]?.children.map((n) => n.folder.title)).toEqual([
      "Alpha",
    ]);
    expect(work?.boards.map((b) => b.title)).toEqual(["Beta", "zeta"]);
  });

  it("pathTo и isWithin идут по цепочке родителей", () => {
    expect(pathTo(FOLDERS, "alpha").map((f) => f.title)).toEqual([
      "Work",
      "Projects",
      "Alpha",
    ]);
    expect(isWithin(FOLDERS, "alpha", "work")).toBe(true);
    expect(isWithin(FOLDERS, "work", "work")).toBe(true);
    expect(isWithin(FOLDERS, "home", "work")).toBe(false);
    expect(isWithin(FOLDERS, null, "work")).toBe(false);
  });
});

describe("zoneAt", () => {
  const rect = { top: 100, height: 40 };

  it("края строки — рядом, середина — внутрь", () => {
    const item = FOLDER_ITEM("home");
    expect(zoneAt(102, rect, item)).toBe("before");
    expect(zoneAt(120, rect, item)).toBe("inside");
    expect(zoneAt(138, rect, item)).toBe("after");
  });

  it("доску всегда кладут внутрь папки", () => {
    const item = { kind: "board", id: "b", folderId: null } as const;
    expect(zoneAt(101, rect, item)).toBe("inside");
  });
});

describe("planMove (BRD-10)", () => {
  it("меняет порядок папок: до и после соседа", () => {
    expect(
      planMove(FOLDERS, FOLDER_ITEM("home"), {
        kind: "folder",
        id: "work",
        zone: "before",
      }),
    ).toEqual({ kind: "folder", id: "home", parentId: null, position: 0 });
    expect(
      planMove(FOLDERS, FOLDER_ITEM("projects"), {
        kind: "folder",
        id: "archive",
        zone: "after",
      }),
    ).toEqual({
      kind: "folder",
      id: "projects",
      parentId: "work",
      position: 1,
    });
  });

  it("вкладывает папку последней в другую папку и выносит на верхний уровень", () => {
    expect(
      planMove(FOLDERS, FOLDER_ITEM("home"), {
        kind: "folder",
        id: "work",
        zone: "inside",
      }),
    ).toEqual({ kind: "folder", id: "home", parentId: "work", position: 2 });
    expect(planMove(FOLDERS, FOLDER_ITEM("alpha"), { kind: "root" })).toEqual({
      kind: "folder",
      id: "alpha",
      parentId: null,
      position: 2,
    });
  });

  it("не даёт вложить папку в неё саму или в её дочернюю", () => {
    const into = (id: string) =>
      ({ kind: "folder", id, zone: "inside" }) as const;
    expect(planMove(FOLDERS, FOLDER_ITEM("work"), into("work"))).toBe("cycle");
    expect(planMove(FOLDERS, FOLDER_ITEM("work"), into("alpha"))).toBe("cycle");
    expect(
      planMove(FOLDERS, FOLDER_ITEM("work"), {
        kind: "folder",
        id: "alpha",
        zone: "before",
      }),
    ).toBe("cycle");
  });

  it("отпущенная на своё место папка ничего не меняет", () => {
    expect(
      planMove(FOLDERS, FOLDER_ITEM("home"), {
        kind: "folder",
        id: "home",
        zone: "after",
      }),
    ).toBeNull();
  });

  it("переносит доску в папку и на верхний уровень", () => {
    const item = { kind: "board", id: "b", folderId: "work" } as const;
    expect(
      planMove(FOLDERS, item, { kind: "folder", id: "home", zone: "inside" }),
    ).toEqual({ kind: "board", id: "b", folderId: "home" });
    expect(planMove(FOLDERS, item, { kind: "root" })).toEqual({
      kind: "board",
      id: "b",
      folderId: null,
    });
    expect(
      planMove(FOLDERS, item, { kind: "folder", id: "work", zone: "inside" }),
    ).toBeNull();
  });
});
