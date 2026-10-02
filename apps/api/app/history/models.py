"""Таблицы модуля history: снимки документа и лента действий (ARCHITECTURE.md, разделы 6, 7)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Index, LargeBinary, String, Uuid, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base
from app.identity.models import NAME_MAX_LENGTH


class BoardSnapshot(Base):
    """Полное состояние документа Yjs доски на момент сжатия журнала (основа COL-07).

    Снимки не удаляются, пока доска существует: это и точки истории версий.
    """

    __tablename__ = "board_snapshots"
    __table_args__ = (Index("ix_board_snapshots_board_id_created_at", "board_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("boards.id"))
    state: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BoardEvent(Base):
    """Запись ленты действий (основа COL-08): кто, когда, что сделал, с какими объектами."""

    __tablename__ = "board_events"
    __table_args__ = (Index("ix_board_events_board_id_created_at", "board_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("boards.id"))
    actor_name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH))
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
