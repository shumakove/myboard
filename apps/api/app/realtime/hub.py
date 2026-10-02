"""Открытые доски процесса API (ARCHITECTURE.md, раздел 1: один процесс держит все соединения).

Документ доски загружается из последнего снимка и журнала при первом подключении и
выгружается, когда уходит последнее соединение: PostgreSQL — источник истины.

Сжатие журнала (основа COL-07): пока доска открыта, раз в `snapshot_interval` секунд
её состояние пишется снимком в `board_snapshots`, а вошедшие в него обновления
отрезаются от `board_updates`. Так же доска сжимается при выгрузке и при остановке
процесса. Доска без новых правок снимков не плодит.
"""

import asyncio
import logging
import uuid

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from starlette.requests import HTTPConnection

from app.realtime import store
from app.realtime.room import BoardRoom, Peer
from app.realtime.store import JournalEntry

# Код закрытия, когда доступ к доске отозван во время работы (сброс ссылки, выход и т. п.).
ACCESS_REVOKED = 4403

logger = logging.getLogger(__name__)


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
                    journal = await store.load_journal(db, board_id)
                room = BoardRoom(board_id, journal)
                self._rooms[board_id] = room
            room.peers.add(peer)
            return room

    async def leave(self, room: BoardRoom, peer: Peer) -> None:
        async with self._lock:
            room.peers.discard(peer)
            if not room.peers and self._rooms.get(room.board_id) is room:
                del self._rooms[room.board_id]
                # Под блокировкой: новое подключение к доске прочитает уже сжатый журнал.
                await self._compact(room)

    async def persist(self, entry: JournalEntry) -> None:
        async with self._session_factory() as db:
            await store.append(db, entry)

    async def compact_all(self) -> None:
        """Сжимает журнал всех открытых досок, где были правки с прошлого снимка."""
        for room in list(self._rooms.values()):
            await self._compact(room)

    async def run_compaction(self, interval: float) -> None:
        """Фоновая задача процесса: периодическое сжатие открытых досок."""
        while True:
            await asyncio.sleep(interval)
            await self.compact_all()

    async def close_participants(self, board_id: uuid.UUID) -> None:
        """SHR-06: после сброса ссылки участники доски сразу теряют канал."""
        room = self._rooms.get(board_id)
        if room is None:
            return
        for peer in [peer for peer in room.peers if peer.guest]:
            await peer.close(ACCESS_REVOKED)
        # Не ждём, пока закрытые соединения дочитают: участники пропадают из списка сразу.
        await room.announce_leave()

    async def _compact(self, room: BoardRoom) -> None:
        try:
            await room.compact(self._write_snapshot)
        except SQLAlchemyError:
            # Журнал не тронут: состояние доски цело, сжатие повторится позже.
            logger.exception("Snapshot of board %s failed", room.board_id)

    async def _write_snapshot(self, board_id: uuid.UUID, state: bytes, upto_seq: int) -> None:
        async with self._session_factory() as db:
            await store.compact(db, board_id, state, upto_seq)


def hub_of(connection: HTTPConnection) -> Hub:
    hub: Hub = connection.app.state.hub
    return hub
