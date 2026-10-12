"""Журнал обновлений доски в PostgreSQL (`board_updates`, ARCHITECTURE.md, раздел 6).

Состояние доски = последний снимок (`board_snapshots`) + обновления журнала после него.
Сжатие пишет снимок и отрезает вошедшие в него обновления одной транзакцией.
"""

import uuid
from collections.abc import Collection, Sequence
from dataclasses import dataclass
from typing import NamedTuple

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.history import events, snapshots
from app.library.service import touch_board
from app.realtime.models import BoardUpdate


class StoredUpdate(NamedTuple):
    """Строка журнала: номер и обновление Yjs."""

    seq: int
    update: bytes


@dataclass(frozen=True)
class Journal:
    """Сохранённое состояние доски: снимок (если журнал сжимали) и обновления после него."""

    snapshot: bytes | None
    updates: list[StoredUpdate]
    last_seq: int


@dataclass(frozen=True)
class JournalEntry:
    """Принятое обновление и то, что о нём пишется в ленту действий."""

    board_id: uuid.UUID
    seq: int
    update: bytes
    actor_name: str
    # Id объектов, перенесённых этим обновлением в `trash` (COL-08).
    trashed: Sequence[str] = ()


async def load_journal(db: AsyncSession, board_id: uuid.UUID) -> Journal:
    """Снимок и журнал читаются из одного состояния базы: параллельное сжатие их не разорвёт."""
    await db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    snapshot = await snapshots.latest_state(db, board_id)
    rows = (
        await db.execute(
            select(BoardUpdate.seq, BoardUpdate.update)
            .where(BoardUpdate.board_id == board_id)
            .order_by(BoardUpdate.seq)
        )
    ).all()
    last_seq = rows[-1].seq if rows else 0
    return Journal(snapshot, [StoredUpdate(row.seq, row.update) for row in rows], last_seq)


async def append(db: AsyncSession, entries: Sequence[JournalEntry]) -> None:
    """Обновления одной доски, записи ленты и `boards.updated_at` (BRD-04) — одна транзакция."""
    for entry in entries:
        db.add(BoardUpdate(board_id=entry.board_id, seq=entry.seq, update=entry.update))
        if entry.trashed:
            events.add_objects_deleted(db, entry.board_id, entry.actor_name, entry.trashed)
    await touch_board(db, entries[0].board_id)
    await db.commit()


async def compact(
    db: AsyncSession,
    board_id: uuid.UUID,
    state: bytes,
    upto_seq: int,
    keep: Collection[int] = (),
) -> None:
    """Пишет снимок `state` и отрезает обновления до `upto_seq` включительно, кроме `keep` —
    тех, что ещё не вошли в документ и потому не попали в снимок (BUG-018)."""
    snapshots.add_snapshot(db, board_id, state)
    cut = delete(BoardUpdate).where(BoardUpdate.board_id == board_id, BoardUpdate.seq <= upto_seq)
    if keep:
        cut = cut.where(BoardUpdate.seq.not_in(keep))
    await db.execute(cut)
    await db.commit()
