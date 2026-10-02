"""Снимки документа доски в `board_snapshots` (основа COL-07, ARCHITECTURE.md, раздел 6)."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.history.models import BoardSnapshot


async def latest_state(db: AsyncSession, board_id: uuid.UUID) -> bytes | None:
    """Состояние из последнего снимка доски или `None`, если снимков ещё нет."""
    state: bytes | None = await db.scalar(
        select(BoardSnapshot.state)
        .where(BoardSnapshot.board_id == board_id)
        .order_by(BoardSnapshot.created_at.desc(), BoardSnapshot.id.desc())
        .limit(1)
    )
    return state


def add_snapshot(db: AsyncSession, board_id: uuid.UUID, state: bytes) -> None:
    """Добавляет снимок в текущую транзакцию (без commit)."""
    db.add(BoardSnapshot(board_id=board_id, state=state))
