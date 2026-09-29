"""Таблицы модуля library: доски, папки и избранное пользователя (раздел 7 архитектуры).

Столбцы обложки и ссылки-шаблона добавляют задачи T7.4, T9.1 своими миграциями.
"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

TITLE_MAX_LENGTH = 200


class Folder(Base):
    """Папка владельца (BRD-09); `parent_id` — вложенность, `position` — порядок среди соседей."""

    __tablename__ = "folders"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("folders.id"))
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH))
    # BRD-10: порядок папок внутри родителя задаёт пользователь перетаскиванием.
    position: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Board(Base):
    """Доска в списке владельца (BRD-01…BRD-06). Содержимое холста — в документе Yjs."""

    __tablename__ = "boards"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # ADM-05: отключение учётки доски не удаляет — строки users не удаляются вовсе.
    owner_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), index=True)
    # BRD-10: папка доски; NULL — верхний уровень.
    folder_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, ForeignKey("folders.id"), index=True)
    title: Mapped[str] = mapped_column(String(TITLE_MAX_LENGTH))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # BRD-04: «недавние» — по последнему изменению.
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # BRD-03: удаление только помечает доску; из списка и по id она больше не видна.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # SHR-01, SHR-06: единственная действующая ссылка (модуль sharing); NULL — ещё не выдана.
    share_token: Mapped[str | None] = mapped_column(String(64), unique=True)
    # SHR-06: момент последнего сброса ссылки; прежний токен в базе больше не хранится.
    share_token_revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class FavoriteType(StrEnum):
    BOARD = "board"
    FOLDER = "folder"


class Favorite(Base):
    """BRD-07: отметка «избранное» пользователя на доске или папке."""

    __tablename__ = "favorites"
    __table_args__ = (CheckConstraint("target_type IN ('board', 'folder')", name="target_type"),)

    user_id: Mapped[uuid.UUID] = mapped_column(Uuid, ForeignKey("users.id"), primary_key=True)
    target_type: Mapped[str] = mapped_column(String(16), primary_key=True)
    target_id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
