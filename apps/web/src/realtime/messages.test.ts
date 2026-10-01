import { describe, expect, it } from "vitest";
import { decodeMessage, encodeSync, SyncKind } from "./messages";

describe("кадры sync /api/ws (тот же формат, что в apps/api/app/realtime/protocol.py)", () => {
  it("кодирует тип, подтип, длину и байты", () => {
    expect(
      Array.from(encodeSync(SyncKind.Update, new Uint8Array([7, 8]))),
    ).toEqual([0, 2, 2, 7, 8]);
  });

  it("разбирает то, что закодировал", () => {
    const payload = new Uint8Array(300).fill(5); // длина в два байта varuint
    expect(decodeMessage(encodeSync(SyncKind.Step2, payload))).toEqual({
      kind: SyncKind.Step2,
      payload,
    });
  });

  it("незнакомый тип или подтип — null", () => {
    expect(decodeMessage(new Uint8Array([1, 0, 0]))).toBeNull();
    expect(decodeMessage(new Uint8Array([0, 9, 0]))).toBeNull();
  });
});
