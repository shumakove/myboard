"""Открытые доски процесса API (ARCHITECTURE.md, раздел 1: один процесс держит все соединения).

Документ доски загружается из журнала при первом подключении и выгружается,
когда уходит последнее соединение: журнал в PostgreSQL — источник истины.
"""

import asyncio
import uuid

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import HTTPConnection

from app.realtime import store
from app.realtime.room import BoardRoom, Peer

# Код закрытия, когда доступ к доске отозван во время работы (сброс ссылки, выход и т. п.).
ACCESS_REVOKED = 4403


class Hub:
    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory
        self._rooms: dict[uuid.UUID, BoardRoom] = {}
        self._lock = asyncio.Lock()

    async def join(self, board_id: uuid.UUID, peer: Peer) -> BoardRoom:
        async with self._lock:
            room = self._rooms.get(board_id)
            if room is None:
                async with self._session_factory() as db:
                    updates = await store.load_updates(db, board_id)
                    last_seq = await store.last_seq(db, board_id)
                room = BoardRoom(board_id, updates, last_seq)
                self._rooms[board_id] = room
            room.peers.add(peer)
            return room

    async def leave(self, room: BoardRoom, peer: Peer) -> None:
        async with self._lock:
            room.peers.discard(peer)
            if not room.peers and self._rooms.get(room.board_id) is room:
                del self._rooms[room.board_id]

    async def persist(self, board_id: uuid.UUID, seq: int, update: bytes) -> None:
        async with self._session_factory() as db:
            await store.append_update(db, board_id, seq, update)

    async def close_participants(self, board_id: uuid.UUID) -> None:
        """SHR-06: после сброса ссылки участники доски сразу теряют канал."""
        room = self._rooms.get(board_id)
        if room is None:
            return
        for peer in [peer for peer in room.peers if peer.guest]:
            await peer.close(ACCESS_REVOKED)


def hub_of(connection: HTTPConnection) -> Hub:
    hub: Hub = connection.app.state.hub
    return hub
