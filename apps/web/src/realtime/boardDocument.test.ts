import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  createBoardDocument,
  moveToTrash,
  type TrashEntry,
} from "./boardDocument";

function addSticker(
  board: ReturnType<typeof createBoardDocument>,
  id: string,
): void {
  const sticker = new Y.Map<unknown>();
  sticker.set("type", "sticker");
  sticker.set("x", 10);
  sticker.set("text", new Y.Text("Hello"));
  board.objects.set(id, sticker);
}

/** Второй клиент: получает правки первого так же, как через канал синхронизации. */
function replica(board: ReturnType<typeof createBoardDocument>) {
  const other = createBoardDocument();
  Y.applyUpdate(other.doc, Y.encodeStateAsUpdate(board.doc));
  board.doc.on("update", (update: Uint8Array) => {
    Y.applyUpdate(other.doc, update);
  });
  return other;
}

describe("moveToTrash (основа COL-08)", () => {
  it("moves the object with its text from objects to trash", () => {
    const board = createBoardDocument();
    addSticker(board, "s1");
    const deletedAt = new Date("2026-10-02T10:00:00.000Z");

    const moved = moveToTrash(board, ["s1"], "Alice", deletedAt);

    expect(moved).toEqual(["s1"]);
    expect(board.objects.has("s1")).toBe(false);
    const entry = (
      board.trash.get("s1") as Y.Map<unknown>
    ).toJSON() as TrashEntry;
    expect(entry).toEqual({
      object: { type: "sticker", x: 10, text: "Hello" },
      deletedAt: "2026-10-02T10:00:00.000Z",
      deletedBy: "Alice",
    });
  });

  it("is a single update for other participants", () => {
    const board = createBoardDocument();
    addSticker(board, "s1");
    addSticker(board, "s2");
    const other = replica(board);
    const seen: string[][] = [];
    other.doc.on("afterTransaction", () => {
      seen.push([
        [...other.objects.keys()].sort().join(","),
        [...other.trash.keys()].sort().join(","),
      ]);
    });

    moveToTrash(board, ["s1", "s2"], "Alice");

    expect(seen).toEqual([["", "s1,s2"]]);
  });

  it("keeps plain JSON objects and skips unknown ids", () => {
    const board = createBoardDocument();
    board.objects.set("r1", { type: "reaction", emoji: "+1" });

    const moved = moveToTrash(board, ["missing", "r1"], "Kate");

    expect(moved).toEqual(["r1"]);
    expect((board.trash.get("r1") as Y.Map<unknown>).get("object")).toEqual({
      type: "reaction",
      emoji: "+1",
    });
    expect(board.trash.has("missing")).toBe(false);
  });
});
