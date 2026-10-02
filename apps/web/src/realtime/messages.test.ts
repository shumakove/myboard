import { describe, expect, it } from "vitest";
import { encodeServerJson } from "./fakeSocket";
import {
  decodeMessage,
  encodeAwareness,
  encodeSync,
  MessageType,
  SyncKind,
} from "./messages";

describe("кадры sync /api/ws (тот же формат, что в apps/api/app/realtime/protocol.py)", () => {
  it("кодирует тип, подтип, длину и байты", () => {
    expect(
      Array.from(encodeSync(SyncKind.Update, new Uint8Array([7, 8]))),
    ).toEqual([0, 2, 2, 7, 8]);
  });

  it("разбирает то, что закодировал", () => {
    const payload = new Uint8Array(300).fill(5); // длина в два байта varuint
    expect(decodeMessage(encodeSync(SyncKind.Step2, payload))).toEqual({
      type: "sync",
      kind: SyncKind.Step2,
      payload,
    });
  });

  it("незнакомый тип или подтип — null", () => {
    expect(decodeMessage(new Uint8Array([7, 0, 0]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0, 9, 0]))).toBeNull();
  });
});

describe("кадры awareness и presence (COL-02…COL-04, COL-09)", () => {
  it("awareness клиента — тип 1 и JSON состояния", () => {
    const state = { cursor: { x: 1, y: 2 }, camera: null, following: null };
    const frame = encodeAwareness(state);
    const json = JSON.stringify(state);
    expect(Array.from(frame.slice(0, 2))).toEqual([1, json.length]);
    expect(new TextDecoder().decode(frame.slice(2))).toBe(json);
  });

  it("разбирает awareness сервера: имя и состояние участника", () => {
    const frame = encodeServerJson(MessageType.Awareness, {
      peer: "p1",
      name: "Kate",
      state: {
        cursor: { x: 5, y: -3 },
        camera: { x: 10, y: 20, zoom: 2 },
        following: "p2",
      },
    });
    expect(decodeMessage(frame)).toEqual({
      type: "awareness",
      peer: "p1",
      name: "Kate",
      state: {
        cursor: { x: 5, y: -3 },
        camera: { x: 10, y: 20, zoom: 2 },
        following: "p2",
      },
    });
  });

  it("поля чужого состояния неверной формы отбрасываются", () => {
    const frame = encodeServerJson(MessageType.Awareness, {
      peer: "p1",
      name: "Kate",
      state: { cursor: { x: "1" }, camera: { x: 0, y: 0, zoom: 0 }, extra: 1 },
    });
    expect(decodeMessage(frame)).toMatchObject({ state: {} });
  });

  it("разбирает presence: свой id и список присутствующих", () => {
    const peers = [
      { peer: "p1", name: "Alice" },
      { peer: "p2", name: "Kate" },
    ];
    const frame = encodeServerJson(MessageType.Presence, { self: "p2", peers });
    expect(decodeMessage(frame)).toEqual({
      type: "presence",
      self: "p2",
      peers,
    });
  });

  it("presence без списка — null", () => {
    const frame = encodeServerJson(MessageType.Presence, { self: "p2" });
    expect(decodeMessage(frame)).toBeNull();
  });
});
