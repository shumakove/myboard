"""Таблицы модуля library: доски пользователя (раздел 7 архитектуры).

Столбцы папки, обложки и ссылок добавляют задачи T2.2, T3.1, T7.4, T9.1 своими миграциями.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

TITLE_MAX_LENGTH = 200


class Board(Base):
    """Доска в списке владельца (BRD-01…BRD-06). Содержимое холста — в документе Yjs."""

    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # ADM-05: отключение учётки доски не удаляет — строки users не удаляются вовсе.
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # BRD-04: «недавние» — по последнему изменению.
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # BRD-03: удаление только помечает доску; из списка и по id она больше не видна.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
