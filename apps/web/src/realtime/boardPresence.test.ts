import { afterEach, describe, expect, it, vi } from "vitest";
import { AWARENESS_INTERVAL_MS, BoardPresence } from "./boardPresence";
import type { AwarenessState } from "./messages";

const ALICE = { peer: "p1", name: "Alice" };
const KATE = { peer: "p2", name: "Kate" };

function attached(): { presence: BoardPresence; sent: AwarenessState[] } {
  const presence = new BoardPresence();
  const sent: AwarenessState[] = [];
  presence.attach((state) => sent.push(state));
  return { presence, sent };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("BoardPresence", () => {
  it("COL-09: список присутствующих с отметкой своей вкладки", () => {
    const { presence } = attached();
    presence.receive({ type: "presence", self: "p2", peers: [ALICE, KATE] });

    expect(presence.getSnapshot().peers).toEqual([
      { ...ALICE, self: false, state: {} },
      { ...KATE, self: true, state: {} },
    ]);
  });

  it("COL-02: курсор участника; ушедший пропадает вместе с курсором", () => {
    const { presence } = attached();
    const listener = vi.fn();
    presence.subscribe(listener);
    presence.receive({
      type: "awareness",
      ...ALICE,
      state: { cursor: { x: 3, y: 4 } },
    });
    presence.receive({ type: "presence", self: "p2", peers: [ALICE, KATE] });
    expect(presence.getSnapshot().peers[0]?.state).toEqual({
      cursor: { x: 3, y: 4 },
    });

    presence.receive({ type: "presence", self: "p2", peers: [KATE] });
    presence.receive({ type: "presence", self: "p2", peers: [ALICE, KATE] });
    expect(presence.getSnapshot().peers[0]?.state).toEqual({});
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("разрыв канала очищает список: кто на доске — неизвестно", () => {
    const { presence } = attached();
    presence.receive({ type: "presence", self: "p2", peers: [ALICE, KATE] });
    presence.detach();
    expect(presence.getSnapshot().peers).toEqual([]);
  });

  it("своё состояние уходит сразу, частые изменения — не чаще интервала", () => {
    vi.useFakeTimers();
    const { presence, sent } = attached();
    expect(sent).toEqual([{ cursor: null, camera: null, following: null }]);

    presence.setLocal({ cursor: { x: 1, y: 1 } });
    presence.setLocal({ cursor: { x: 2, y: 2 } });
    expect(sent).toHaveLength(1);

    vi.advanceTimersByTime(AWARENESS_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({
      cursor: { x: 2, y: 2 },
      camera: null,
      following: null,
    });
  });

  it("без канала состояние копится и уходит при подключении", () => {
    const presence = new BoardPresence();
    presence.setLocal({ following: "p1" });
    const sent: AwarenessState[] = [];
    presence.attach((state) => sent.push(state));
    expect(sent).toEqual([{ cursor: null, camera: null, following: "p1" }]);
  });
});
