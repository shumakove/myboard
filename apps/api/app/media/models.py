"""Таблица модуля media: файлы досок (ARCHITECTURE.md, разделы 7, 8)."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

NAME_MAX_LENGTH = 255
MIME_MAX_LENGTH = 127
KEY_MAX_LENGTH = 80


class Media(Base):
    """Загруженный файл доски; содержимое — на диске по ключу `{board_id}/{media_id}`."""

    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    board_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("boards.id"), index=True)
    storage_key: Mapped[str] = mapped_column(String(KEY_MAX_LENGTH))
    original_name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH))
    mime: Mapped[str] = mapped_column(String(MIME_MAX_LENGTH))
    byte_size: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
