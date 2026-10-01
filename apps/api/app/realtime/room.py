"""Копия документа доски на сервере и её соединения (COL-01, ARCHITECTURE.md, раздел 6).

Сервер не интерпретирует правки: он применяет обновление Yjs к своей копии (`pycrdt`),
дописывает его в журнал и только потом рассылает остальным соединениям доски.
"""

import asyncio
import contextlib
import uuid
from collections.abc import Awaitable, Callable, Iterable
from typing import Any

from pycrdt import Doc
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.realtime.protocol import ProtocolError, SyncKind, encode_sync

# Обновление без изменений (пустые структуры и набор удалений) — так отвечает клиент,
# у которого нет ничего нового. В журнал и рассылку оно не попадает.
EMPTY_UPDATE = b"\x00\x00"

# Запись обновления в журнал: (доска, порядковый номер, обновление).
Persist = Callable[[uuid.UUID, int, bytes], Awaitable[None]]


class Peer:
    """Одно соединение доски. Ошибки отправки не роняют рассылку другим."""

    def __init__(self, websocket: WebSocket, *, guest: bool) -> None:
        self.guest = guest
        self._websocket = websocket
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    async def send(self, frame: bytes) -> None:
        # Разрыв заметит цикл приёма этого соединения.
        with contextlib.suppress(WebSocketDisconnect, RuntimeError, OSError):
            await self._websocket.send_bytes(frame)

    async def close(self, code: int) -> None:
        if self._closed:
            return
        self._closed = True
        with contextlib.suppress(RuntimeError, OSError):
            await self._websocket.close(code)


class BoardRoom:
    def __init__(self, board_id: uuid.UUID, updates: Iterable[bytes], last_seq: int) -> None:
        self.board_id = board_id
        self.peers: set[Peer] = set()
        self._doc: Doc[Any] = Doc()
        for update in updates:
            self._doc.apply_update(update)
        self._seq = last_seq
        # Один порядок применения, записи и рассылки для всех соединений доски.
        self._lock = asyncio.Lock()

    def state_vector(self) -> bytes:
        return self._doc.get_state()

    def missing_since(self, state_vector: bytes) -> bytes:
        """Обновления, которых нет у клиента; пустой вектор — полный снимок."""
        try:
            return self._doc.get_update(state_vector)
        except ValueError:
            raise ProtocolError("invalid state vector") from None

    async def apply(self, update: bytes, sender: Peer, persist: Persist) -> None:
        """Применяет, записывает и рассылает. Повреждённое обновление — `ProtocolError`,
        документ и остальные соединения его не видят."""
        if update == EMPTY_UPDATE:
            return
        async with self._lock:
            try:
                self._doc.apply_update(update)
            except ValueError:
                raise ProtocolError("invalid update") from None
            self._seq += 1
            await persist(self.board_id, self._seq, update)
            frame = encode_sync(SyncKind.UPDATE, update)
            for peer in list(self.peers):
                if peer is not sender:
                    await peer.send(frame)
