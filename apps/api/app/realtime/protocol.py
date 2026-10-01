"""Сообщения WebSocket `/api/ws` (ARCHITECTURE.md, раздел 10).

Копия для клиента — `apps/web/src/realtime/messages.ts`; при изменении правятся обе.

Кадр двоичный, в кодировке y-protocols (её понимает `yjs` клиента):

    varuint MessageType | поля типа

`sync` (COL-01): `varuint SyncKind | varuint длина | байты`, где

- `STEP1` — вектор версии отправителя: «пришли, чего у меня нет»;
- `STEP2` — ответ на `STEP1`: недостающие обновления, на пустой вектор — полный снимок;
- `UPDATE` — новая правка.

`awareness` и `presence` появятся в T4.2.
"""

from dataclasses import dataclass
from enum import IntEnum

# Длина 64-битного varuint в байтах; больше — заведомо повреждённый кадр.
_MAX_VARUINT_BYTES = 10


class MessageType(IntEnum):
    SYNC = 0


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


def encode_sync(kind: SyncKind, payload: bytes) -> bytes:
    return (
        _write_varuint(MessageType.SYNC)
        + _write_varuint(kind)
        + _write_varuint(len(payload))
        + payload
    )


def decode(frame: bytes) -> SyncMessage:
    """Разбирает кадр клиента; неизвестный тип или лишние байты — `ProtocolError`."""
    reader = _Reader(frame)
    if reader.varuint() != MessageType.SYNC:
        raise ProtocolError("unknown message type")
    try:
        kind = SyncKind(reader.varuint())
    except ValueError:
        raise ProtocolError("unknown sync message kind") from None
    payload = reader.chunk()
    reader.ensure_end()
    return SyncMessage(kind, payload)
