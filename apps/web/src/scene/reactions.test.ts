import { afterEach, describe, expect, it } from "vitest";
import {
  createBoardDocument,
  moveToTrash,
  type BoardDocument,
} from "../realtime/boardDocument";
import { placeInFrames } from "./frames";
import { removalSet } from "./groups";
import {
  HOLD_DELAY,
  REACTION_MAX,
  REACTION_MIN,
  REACTION_SETS,
  reactionSize,
  reactionTitle,
} from "./reactionData";
import {
  loadReactionChoice,
  REACTIONS_KEY,
  RECENT_REACTIONS_LIMIT,
  withRecent,
} from "./reactionChoice";
import { canReactTo, createReaction } from "./reactions";
import {
  createObject,
  patchObjects,
  readScene,
  type SceneObject,
} from "./sceneObjects";
import { linkedDocs } from "./testDocs";

// T6.11: реакции — RCT-01…RCT-04.

afterEach(() => {
  localStorage.clear();
});

function find(board: BoardDocument, id: string): SceneObject {
  const found = readScene(board.objects).find((o) => o.id === id);
  if (found === undefined) throw new Error("нет объекта");
  return found;
}

/** Стикер в (100, 100) и реакция центром в (150, 150) на нём. */
function stickerWithReaction(board = createBoardDocument()) {
  const sticky = createObject(board.objects, "sticky", { x: 100, y: 100 });
  const reaction = createReaction(
    board.objects,
    find(board, sticky),
    { x: 150, y: 150 },
    REACTION_MIN,
    "👍",
    "Alice",
  );
  return { board, sticky, reaction };
}

describe("RCT-01: реакция-штамп на объекте", () => {
  it("реакция стоит центром в точке нажатия и привязана к объекту", () => {
    const { board, sticky, reaction } = stickerWithReaction();
    const placed = find(board, reaction);
    expect(placed.type).toBe("reaction");
    expect(placed.parent).toBe(sticky);
    expect(placed.reaction?.image).toBe("👍");
    expect(placed).toMatchObject({ x: 126, y: 126, width: 48, height: 48 });
  });

  it("реакция едет вместе с объектом", () => {
    const { board, sticky, reaction } = stickerWithReaction();
    patchObjects(
      board.objects,
      new Map([[find(board, sticky), { x: 400, y: -50 }]]),
      "Bob",
    );
    expect(find(board, reaction)).toMatchObject({ x: 426, y: -24 });
  });

  it("реакция едет с объектом и во фрейме, а сама во фреймы не переходит", () => {
    const board = createBoardDocument();
    const frame = createObject(board.objects, "frame", { x: 0, y: 0 });
    const { sticky, reaction } = stickerWithReaction(board);
    placeInFrames(board.objects, readScene(board.objects), [sticky], "Alice");
    expect(find(board, sticky).parent).toBe(frame);
    placeInFrames(board.objects, readScene(board.objects), [reaction], "A");
    expect(find(board, reaction).parent).toBe(sticky);
    patchObjects(
      board.objects,
      new Map([[find(board, frame), { x: 1000, y: 0 }]]),
      "Bob",
    );
    expect(find(board, reaction)).toMatchObject({ x: 1126, y: 126 });
  });

  it("удаление объекта уносит его реакции в корзину", () => {
    const { board, sticky, reaction } = stickerWithReaction();
    const removing = removalSet(readScene(board.objects), [sticky]);
    expect(removing).toEqual(expect.arrayContaining([sticky, reaction]));
    moveToTrash(board, removing, "Alice");
    expect(board.objects.has(reaction)).toBe(false);
    expect(board.trash.has(reaction)).toBe(true);
  });

  it("реакцию не ставят на линию, группу и другую реакцию", () => {
    const { board, sticky, reaction } = stickerWithReaction();
    expect(canReactTo(find(board, sticky))).toBe(true);
    expect(canReactTo(find(board, reaction))).toBe(false);
    expect(canReactTo({ ...find(board, sticky), type: "line" })).toBe(false);
    expect(canReactTo({ ...find(board, sticky), type: "group" })).toBe(false);
  });

  it("реакция видна второму участнику и едет за объектом у него", () => {
    const [first, second] = linkedDocs();
    const a = createBoardDocument(first);
    const b = createBoardDocument(second);
    const { sticky, reaction } = stickerWithReaction(a);
    patchObjects(b.objects, new Map([[find(b, sticky), { x: 0, y: 0 }]]), "B");
    expect(find(a, reaction)).toMatchObject({ x: 26, y: 26 });
    expect(find(b, reaction).reaction?.image).toBe("👍");
  });
});

describe("RCT-02: кто поставил реакцию", () => {
  it("подпись — изображение и автор", () => {
    const { board, reaction } = stickerWithReaction();
    expect(find(board, reaction).meta.createdBy).toBe("Alice");
    expect(reactionTitle(find(board, reaction))).toBe("Thumbs up by Alice");
  });
});

describe("RCT-03: реакция растёт, пока её держат", () => {
  it("размер растёт со временем удержания до предела", () => {
    expect(reactionSize(0)).toBe(REACTION_MIN);
    expect(reactionSize(HOLD_DELAY)).toBe(REACTION_MIN);
    expect(reactionSize(500)).toBeGreaterThan(REACTION_MIN);
    expect(reactionSize(1000)).toBeGreaterThan(reactionSize(500));
    expect(reactionSize(60_000)).toBe(REACTION_MAX);
  });

  it("выросшая реакция стоит центром в точке нажатия", () => {
    const board = createBoardDocument();
    const sticky = createObject(board.objects, "sticky", { x: 0, y: 0 });
    const id = createReaction(
      board.objects,
      find(board, sticky),
      { x: 100, y: 100 },
      200,
      "🔥",
      "Bob",
    );
    expect(find(board, id)).toMatchObject({
      x: 0,
      y: 0,
      width: 200,
      height: 200,
    });
  });
});

describe("RCT-04: наборы изображений и недавние", () => {
  it("несколько наборов, изображения в них не повторяются", () => {
    expect(REACTION_SETS.length).toBeGreaterThanOrEqual(3);
    const all = REACTION_SETS.flatMap((set) => set.images.map((i) => i.value));
    expect(new Set(all).size).toBe(all.length);
  });

  it("недавние — последняя первой, без повторов, не больше предела", () => {
    let choice = loadReactionChoice();
    expect(choice).toEqual({ current: "👍", recent: [] });
    for (const image of ["👍", "🔥", "👍", "✅"]) {
      choice = withRecent(choice, image);
    }
    expect(choice.recent).toEqual(["✅", "👍", "🔥"]);
    const many = REACTION_SETS.flatMap((s) => s.images).reduce(
      (c, image) => withRecent(c, image.value),
      choice,
    );
    expect(many.recent).toHaveLength(RECENT_REACTIONS_LIMIT);
  });

  it("выбор хранится в браузере; чужие и испорченные записи отбрасываются", () => {
    localStorage.setItem(
      REACTIONS_KEY,
      JSON.stringify({ current: "🔥", recent: ["✅", "<b>", "✅", 7] }),
    );
    expect(loadReactionChoice()).toEqual({ current: "🔥", recent: ["✅"] });
    localStorage.setItem(REACTIONS_KEY, "{oops");
    expect(loadReactionChoice()).toEqual({ current: "👍", recent: [] });
  });
});
