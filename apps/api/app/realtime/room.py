"""Копия документа доски на сервере и её соединения (COL-01, ARCHITECTURE.md, раздел 6).

Сервер не интерпретирует правки: он применяет обновление Yjs к своей копии (`pycrdt`),
дописывает его в журнал и только потом рассылает остальным соединениям доски.

Присутствие (COL-02…COL-04, COL-09) живёт только в памяти соединений: состояние
awareness не попадает ни в документ, ни в журнал, ни в снимки и пропадает вместе
с соединением.

Сервер не разбирает жесты, но замечает, какие ключи появились в корне `trash`: это
удалённые объекты, о которых пишется запись ленты действий (основа COL-08).
"""

import asyncio
import contextlib
import secrets
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from pycrdt import Doc, Map, MapEvent
from starlette.websockets import WebSocket, WebSocketDisconnect

from app.realtime.protocol import (
    PresencePeer,
    ProtocolError,
    SyncKind,
    encode_awareness,
    encode_presence,
    encode_sync,
)
from app.realtime.store import Journal, JournalEntry

# Обновление без изменений (пустые структуры и набор удалений) — так отвечает клиент,
# у которого нет ничего нового. В журнал и рассылку оно не попадает.
EMPTY_UPDATE = b"\x00\x00"

# Корень документа с удалёнными объектами: id -> { object, deletedAt, deletedBy }.
TRASH = "trash"

# Запись принятого обновления в журнал (и ленту действий).
Persist = Callable[[JournalEntry], Awaitable[None]]
# Запись снимка: (доска, полное состояние, последний вошедший в него номер журнала).
WriteSnapshot = Callable[[uuid.UUID, bytes, int], Awaitable[None]]


class Peer:
    """Одно соединение доски. Ошибки отправки не роняют рассылку другим."""

    def __init__(self, websocket: WebSocket, *, name: str, guest: bool) -> None:
        # Случайный id соединения для присутствия: не раскрывает ни сессию, ни учётку.
        self.id = secrets.token_hex(8)
        self.name = name
        self.guest = guest
        # Последнее состояние awareness — его получает тот, кто подключится позже.
        self.awareness: dict[str, Any] | None = None
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
    def __init__(self, board_id: uuid.UUID, journal: Journal) -> None:
        self.board_id = board_id
        self.peers: set[Peer] = set()
        self._doc: Doc[Any] = Doc()
        if journal.snapshot is not None:
            self._doc.apply_update(journal.snapshot)
        for update in journal.updates:
            self._doc.apply_update(update)
        self._seq = journal.last_seq
        # Номер журнала, до которого включительно всё уже лежит в снимке. Обновления,
        # загруженные из журнала, в снимок ещё не вошли (их номера больше нуля).
        self._compacted_seq = 0
        # Один порядок применения, записи и рассылки для всех соединений доски.
        self._lock = asyncio.Lock()
        # Сжатия одной доски (периодическое и при выгрузке) не идут параллельно.
        self._compaction_lock = asyncio.Lock()
        # Подписка после загрузки: состояние из журнала — не новые удаления.
        # Ссылки на корень и подписку держатся: иначе сборщик мусора снимет подписку.
        self._trashed: list[str] = []
        self._trash: Map[Any] = self._doc.get(TRASH, type=Map)
        self._trash_subscription = self._trash.observe(self._on_trash_change)

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
            self._trashed = []
            try:
                self._doc.apply_update(update)
            except ValueError:
                raise ProtocolError("invalid update") from None
            self._seq += 1
            # Автор удаления — имя из сессии соединения, а не поле `deletedBy` документа.
            entry = JournalEntry(
                self.board_id, self._seq, update, sender.name, tuple(self._trashed)
            )
            await persist(entry)
            await self._broadcast(encode_sync(SyncKind.UPDATE, update), sender)

    async def compact(self, write: WriteSnapshot) -> bool:
        """Пишет снимок, если с прошлого сжатия были правки; `True` — снимок записан.

        Состояние берётся под блокировкой комнаты: все принятые к этому моменту
        обновления уже записаны в журнал и войдут в снимок.
        """
        async with self._compaction_lock:
            async with self._lock:
                if self._seq == self._compacted_seq:
                    return False
                seq, state = self._seq, self._doc.get_update()
            await write(self.board_id, state, seq)
            self._compacted_seq = seq
            return True

    def _on_trash_change(self, event: MapEvent) -> None:
        # В pycrdt поле `keys` объявлено в `__slots__` без аннотации типа.
        changes: dict[str, dict[str, Any]] = event.keys  # type: ignore[attr-defined]
        # «add» — объект попал в корзину; «update» — повторное удаление того же id.
        for key, change in changes.items():
            if change["action"] in ("add", "update"):
                self._trashed.append(key)

    async def announce(self, newcomer: Peer) -> None:
        """COL-02, COL-09: новичок получает присутствующих и их курсоры, остальные — новый
        список присутствующих."""
        async with self._lock:
            for peer in self._listed():
                if peer is not newcomer and peer.awareness is not None:
                    await newcomer.send(encode_awareness(peer.id, peer.name, peer.awareness))
            await self._send_presence()

    async def announce_leave(self) -> None:
        """Ушедшее соединение пропадает из списка, его курсор — у всех (COL-02, COL-09)."""
        async with self._lock:
            await self._send_presence()

    async def update_awareness(self, sender: Peer, state: dict[str, Any]) -> None:
        async with self._lock:
            sender.awareness = state
            await self._broadcast(encode_awareness(sender.id, sender.name, state), sender)

    def _listed(self) -> list[Peer]:
        # Порядок списка — по id: одинаковый у всех получателей.
        return sorted((p for p in self.peers if not p.closed), key=lambda p: p.id)

    async def _send_presence(self) -> None:
        listed = self._listed()
        roster = [PresencePeer(p.id, p.name) for p in listed]
        for peer in listed:
            await peer.send(encode_presence(peer.id, roster))

    async def _broadcast(self, frame: bytes, sender: Peer) -> None:
        for peer in list(self.peers):
            if peer is not sender:
                await peer.send(frame)
