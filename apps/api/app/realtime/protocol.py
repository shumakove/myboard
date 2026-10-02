"""Сообщения WebSocket `/api/ws` (ARCHITECTURE.md, раздел 10).

Копия для клиента — `apps/web/src/realtime/messages.ts`; при изменении правятся обе.

Кадр двоичный, в кодировке y-protocols (её понимает `yjs` клиента):

    varuint MessageType | поля типа

`sync` (COL-01): `varuint SyncKind | varuint длина | байты`, где

- `STEP1` — вектор версии отправителя: «пришли, чего у меня нет»;
- `STEP2` — ответ на `STEP1`: недостающие обновления, на пустой вектор — полный снимок;
- `UPDATE` — новая правка.

`awareness` и `presence` (COL-02…COL-04, COL-09): `varuint длина | JSON в UTF-8`.

- `awareness` клиента — его состояние целиком: объект JSON (курсор, вид камеры, за кем
  следит и т. п.). Сервер поля не интерпретирует и в документ не пишет.
- `awareness` сервера — `{"peer": id, "name": имя, "state": состояние}`: имя берётся
  из сессии соединения, а не из присланного клиентом.
- `presence` сервера — `{"self": id получателя, "peers": [{"peer": id, "name": имя}]}`:
  кто сейчас на доске (по одному элементу на соединение, включая получателя).
"""

import json
from dataclasses import dataclass
from enum import IntEnum
from typing import Any

# Длина 64-битного varuint в байтах; больше — заведомо повреждённый кадр.
_MAX_VARUINT_BYTES = 10

# Предел состояния awareness одного соединения: курсор и вид камеры занимают десятки байт.
MAX_AWARENESS_BYTES = 4096


class MessageType(IntEnum):
    SYNC = 0
    AWARENESS = 1
    PRESENCE = 2


class SyncKind(IntEnum):
    STEP1 = 0
    STEP2 = 1
    UPDATE = 2


class ProtocolError(ValueError):
    """Кадр не разбирается или его содержимое не принимается: соединение закрывается."""


@dataclass(frozen=True)
class SyncMessage:
    kind: SyncKind
    payload: bytes


@dataclass(frozen=True)
class AwarenessMessage:
    """Состояние присутствия соединения (курсор, камера, слежение) — не часть документа."""

    state: dict[str, Any]


@dataclass(frozen=True)
class PresencePeer:
    peer: str
    name: str


ClientMessage = SyncMessage | AwarenessMessage


def _write_varuint(value: int) -> bytes:
    out = bytearray()
    while value > 0x7F:
        out.append(0x80 | (value & 0x7F))
        value >>= 7
    out.append(value)
    return bytes(out)


class _Reader:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self._pos = 0

    def varuint(self) -> int:
        value = 0
        for shift in range(0, 7 * _MAX_VARUINT_BYTES, 7):
            if self._pos >= len(self._data):
                raise ProtocolError("frame is truncated")
            byte = self._data[self._pos]
            self._pos += 1
            value |= (byte & 0x7F) << shift
            if byte < 0x80:
                return value
        raise ProtocolError("varuint is too long")

    def chunk(self) -> bytes:
        length = self.varuint()
        end = self._pos + length
        if end > len(self._data):
            raise ProtocolError("frame is truncated")
        chunk = self._data[self._pos : end]
        self._pos = end
        return chunk

    def ensure_end(self) -> None:
        if self._pos != len(self._data):
            raise ProtocolError("unexpected trailing bytes")


def _frame(message_type: MessageType, *fields: int | bytes) -> bytes:
    out = bytearray(_write_varuint(message_type))
    for value in fields:
        if isinstance(value, bytes):
            out += _write_varuint(len(value)) + value
        else:
            out += _write_varuint(value)
    return bytes(out)


def _json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def encode_sync(kind: SyncKind, payload: bytes) -> bytes:
    return _frame(MessageType.SYNC, kind, payload)


def encode_awareness(peer: str, name: str, state: dict[str, Any]) -> bytes:
    return _frame(MessageType.AWARENESS, _json({"peer": peer, "name": name, "state": state}))


def encode_presence(self_peer: str, peers: list[PresencePeer]) -> bytes:
    listed = [{"peer": p.peer, "name": p.name} for p in peers]
    return _frame(MessageType.PRESENCE, _json({"self": self_peer, "peers": listed}))


def decode(frame: bytes) -> ClientMessage:
    """Разбирает кадр клиента; неизвестный тип или лишние байты — `ProtocolError`."""
    reader = _Reader(frame)
    message_type = reader.varuint()
    if message_type == MessageType.SYNC:
        message: ClientMessage = _decode_sync(reader)
    elif message_type == MessageType.AWARENESS:
        message = AwarenessMessage(_decode_awareness_state(reader.chunk()))
    else:
        # `presence` шлёт только сервер.
        raise ProtocolError("unknown message type")
    reader.ensure_end()
    return message


def _decode_sync(reader: _Reader) -> SyncMessage:
    try:
        kind = SyncKind(reader.varuint())
    except ValueError:
        raise ProtocolError("unknown sync message kind") from None
    return SyncMessage(kind, reader.chunk())


def _decode_awareness_state(payload: bytes) -> dict[str, Any]:
    if len(payload) > MAX_AWARENESS_BYTES:
        raise ProtocolError("awareness state is too large")
    try:
        state = json.loads(payload.decode(), parse_constant=_reject_constant)
    except (UnicodeDecodeError, ValueError):
        raise ProtocolError("awareness state is not JSON") from None
    if not isinstance(state, dict):
        raise ProtocolError("awareness state must be a JSON object")
    return state


def _reject_constant(name: str) -> Any:
    # NaN и Infinity — не JSON: браузер получателя не разобрал бы такой кадр.
    raise ValueError(name)
