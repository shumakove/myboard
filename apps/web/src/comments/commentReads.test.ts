import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CommentThread } from "./commentData";
import { unreadCount, useCommentReads } from "./commentReads";

afterEach(() => {
  localStorage.clear();
});

function thread(...messages: [id: string, author: string][]): CommentThread {
  return {
    id: "t1",
    anchor: { object: null, x: 0, y: 0 },
    color: "#000000",
    resolved: false,
    createdAt: "",
    messages: messages.map(([id, author]) => ({
      id,
      author,
      text: id,
      at: "2026-10-27T10:00:00Z",
    })),
  };
}

describe("CMT-02: непрочитанные — свои у каждого участника", () => {
  it("непрочитанные — чужие сообщения, которые участник ещё не открыл", () => {
    const t = thread(["m1", "Alice"], ["m2", "Bob"], ["m3", "Bob"]);
    expect(unreadCount(t, new Set(), "Alice")).toBe(2);
    expect(unreadCount(t, new Set(["m2"]), "Alice")).toBe(1);
    expect(unreadCount(t, new Set(), "Bob")).toBe(1);
  });

  it("отметка прочитанного переживает перезагрузку и не касается другой доски и участника", () => {
    const t = thread(["m1", "Alice"], ["m2", "Alice"]);
    const first = renderHook(() => useCommentReads("board-1", "Bob"));
    expect(first.result.current.unread(t)).toBe(2);
    act(() => {
      first.result.current.markRead(["m1"]);
    });
    expect(first.result.current.unread(t)).toBe(1);
    first.unmount();

    const again = renderHook(() => useCommentReads("board-1", "Bob"));
    expect(again.result.current.unread(t)).toBe(1);
    const otherBoard = renderHook(() => useCommentReads("board-2", "Bob"));
    expect(otherBoard.result.current.unread(t)).toBe(2);
    const otherPerson = renderHook(() => useCommentReads("board-1", "Carol"));
    expect(otherPerson.result.current.unread(t)).toBe(2);
  });

  it("испорченная запись в хранилище — всё непрочитано", () => {
    localStorage.setItem("myboard.commentReads.board-1.Bob", "{oops");
    const t = thread(["m1", "Alice"]);
    const { result } = renderHook(() => useCommentReads("board-1", "Bob"));
    expect(result.current.unread(t)).toBe(1);
  });
});
