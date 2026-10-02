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
 * `awareness` и `presence` (COL-02…COL-04, COL-09): `varuint длина | JSON в UTF-8`.
 * - `awareness` клиента — его состояние целиком (`AwarenessState`);
 * - `awareness` сервера — `{peer, name, state}`, имя — из сессии соединения;
 * - `presence` сервера — `{self, peers: [{peer, name}]}`: кто сейчас на доске.
 * В документ доски присутствие не попадает.
 */
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";

export const MessageType = { Sync: 0, Awareness: 1, Presence: 2 } as const;

export const SyncKind = { Step1: 0, Step2: 1, Update: 2 } as const;
export type SyncKind = (typeof SyncKind)[keyof typeof SyncKind];

/** Коды закрытия соединения сервером. */
export const CloseCode = {
  /** Кадр не разобран или обновление повреждено. */
  InvalidPayload: 1007,
  /** Доступ к доске отозван во время работы (сброс ссылки, выход). */
  AccessRevoked: 4403,
} as const;

/** Точка в координатах доски. */
export interface Point {
  x: number;
  y: number;
}

/** Вид камеры: центр в координатах доски и масштаб — не зависит от размера экрана. */
export interface CameraView extends Point {
  zoom: number;
}

/** Состояние присутствия этого клиента; сервер его не интерпретирует. */
export interface AwarenessState {
  /** Курсор на доске (COL-02); `null` — указатель вне холста. */
  cursor: Point | null;
  /** Вид камеры — по нему следят «глазами участника» (COL-04). */
  camera: CameraView | null;
  /** За кем следит камера этого клиента (id соединения). */
  following: string | null;
}

export interface PresencePeer {
  peer: string;
  name: string;
}

export type ServerMessage =
  | { type: "sync"; kind: SyncKind; payload: Uint8Array }
  | {
      type: "awareness";
      peer: string;
      name: string;
      state: Partial<AwarenessState>;
    }
  | { type: "presence"; self: string; peers: PresencePeer[] };

export function encodeSync(kind: SyncKind, payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Sync);
  encoding.writeVarUint(encoder, kind);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

export function encodeAwareness(state: AwarenessState): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MessageType.Awareness);
  encoding.writeVarString(encoder, JSON.stringify(state));
  return encoding.toUint8Array(encoder);
}

/** Кадр сервера или `null`, если тип незнаком или содержимое не разобрано. */
export function decodeMessage(frame: Uint8Array): ServerMessage | null {
  const decoder = decoding.createDecoder(frame);
  switch (decoding.readVarUint(decoder)) {
    case MessageType.Sync: {
      const kind = decoding.readVarUint(decoder);
      if (!isSyncKind(kind)) return null;
      return {
        type: "sync",
        kind,
        payload: decoding.readVarUint8Array(decoder),
      };
    }
    case MessageType.Awareness:
      return parseAwareness(readJson(decoder));
    case MessageType.Presence:
      return parsePresence(readJson(decoder));
    default:
      return null;
  }
}

function isSyncKind(value: number): value is SyncKind {
  return Object.values(SyncKind).some((kind) => kind === value);
}

function readJson(decoder: decoding.Decoder): unknown {
  return JSON.parse(decoding.readVarString(decoder));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPeer(value: unknown): value is PresencePeer {
  return (
    isRecord(value) &&
    typeof value.peer === "string" &&
    typeof value.name === "string"
  );
}

function parseAwareness(value: unknown): ServerMessage | null {
  if (!isRecord(value) || !isPeer(value) || !isRecord(value.state)) {
    return null;
  }
  return {
    type: "awareness",
    peer: value.peer,
    name: value.name,
    state: parseState(value.state),
  };
}

function parsePresence(value: unknown): ServerMessage | null {
  if (!isRecord(value) || typeof value.self !== "string") return null;
  if (!Array.isArray(value.peers) || !value.peers.every(isPeer)) return null;
  const peers = value.peers.map(({ peer, name }) => ({ peer, name }));
  return { type: "presence", self: value.self, peers };
}

/** Чужое состояние: берутся только поля правильной формы. */
function parseState(state: Record<string, unknown>): Partial<AwarenessState> {
  const parsed: Partial<AwarenessState> = {};
  if (state.cursor === null || isPoint(state.cursor)) {
    parsed.cursor = state.cursor;
  }
  if (state.camera === null || isCamera(state.camera)) {
    parsed.camera = state.camera;
  }
  if (state.following === null || typeof state.following === "string") {
    parsed.following = state.following;
  }
  return parsed;
}

function isPoint(value: unknown): value is Point {
  return (
    isRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y)
  );
}

function isCamera(value: unknown): value is CameraView {
  return (
    isRecord(value) &&
    isPoint(value) &&
    typeof value.zoom === "number" &&
    value.zoom > 0
  );
}
