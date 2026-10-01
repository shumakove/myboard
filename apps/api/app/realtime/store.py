"""Журнал обновлений доски в PostgreSQL (`board_updates`, ARCHITECTURE.md, раздел 6)."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.library.service import touch_board
from app.realtime.models import BoardUpdate


async def load_updates(db: AsyncSession, board_id: uuid.UUID) -> list[bytes]:
    """Все обновления доски в порядке применения."""
    rows = await db.scalars(
        select(BoardUpdate.update).where(BoardUpdate.board_id == board_id).order_by(BoardUpdate.seq)
    )
    return list(rows)


async def last_seq(db: AsyncSession, board_id: uuid.UUID) -> int:
    seq = await db.scalar(select(func.max(BoardUpdate.seq)).where(BoardUpdate.board_id == board_id))
    return seq or 0


async def append_update(db: AsyncSession, board_id: uuid.UUID, seq: int, update: bytes) -> None:
    """Дописывает обновление и двигает `boards.updated_at` в одной транзакции (BRD-04)."""
    db.add(BoardUpdate(board_id=board_id, seq=seq, update=update))
    await touch_board(db, board_id)
    await db.commit()
