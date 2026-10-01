"""Таблицы модуля realtime: журнал обновлений документа доски (ARCHITECTURE.md, разделы 6, 7)."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, LargeBinary, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class BoardUpdate(Base):
    """Принятое обновление Yjs доски. `seq` — порядок применения на сервере (COL-01)."""

    __tablename__ = "board_updates"

    board_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("boards.id"), primary_key=True)
    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    update: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
