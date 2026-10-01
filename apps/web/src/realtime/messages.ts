/**
 * Сообщения WebSocket `/api/ws` — узкая копия `apps/api/app/realtime/protocol.py`
 * (ARCHITECTURE.md, раздел 10); при изменении правятся обе.
 *
 * Кадр двоичный, в кодировке y-protocols: `varuint MessageType | поля типа`.
 * `sync` (COL-01): `varuint SyncKind | varuint длина | байты`:
 * - `Step1` — вектор версии отправителя;
 * - `Step2` — ответ на `Step1`: недостающие обновления (на пустой вектор — полный снимок);
 * - `Update` — новая правка.
 *
 * `awareness` и `presence` появятся в T4.2.
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

export const MessageType = { Sync: 0 } as const;

export const SyncKind = { Step1: 0, Step2: 1, Update: 2 } as const;
export type SyncKind = (typeof SyncKind)[keyof typeof SyncKind];

/** Коды закрытия соединения сервером. */
export const CloseCode = {
  /** Кадр не разобран или обновление повреждено. */
  InvalidPayload: 1007,
  /** Доступ к доске отозван во время работы (сброс ссылки, выход). */
  AccessRevoked: 4403,
} as const;

export interface SyncMessage {
  kind: SyncKind;
  payload: Uint8Array;
}

export function encodeSync(kind: SyncKind, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  encoding.writeVarUint(encoder, kind);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

/** Кадр сервера или `null`, если тип незнаком. */
export function decodeMessage(frame: Uint8Array): SyncMessage | null {
  const decoder = decoding.createDecoder(frame);
  if (decoding.readVarUint(decoder) !== MessageType.Sync) return null;
  const kind = decoding.readVarUint(decoder);
  if (!isSyncKind(kind)) return null;
  return { kind, payload: decoding.readVarUint8Array(decoder) };
}

function isSyncKind(value: number): value is SyncKind {
  return Object.values(SyncKind).some((kind) => kind === value);
}
