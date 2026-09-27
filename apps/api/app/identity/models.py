"""Таблицы модуля identity: администраторы, пользователи досок, сессии (раздел 7 архитектуры)."""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

EMAIL_MAX_LENGTH = 254
NAME_MAX_LENGTH = 200


class Admin(Base):
    """Учётная запись администратора, отдельная от пользователей досок (ADM-01)."""

    __tablename__ = "admins"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(EMAIL_MAX_LENGTH), unique=True)
    password_hash: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    """Пользователь досок; создаётся только администратором (ADM-03)."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    # Почта хранится в нижнем регистре; повтор отклоняет ограничение базы (ADM-07).
    email: Mapped[str] = mapped_column(String(EMAIL_MAX_LENGTH), unique=True)
    name: Mapped[str] = mapped_column(String(NAME_MAX_LENGTH))
    password_hash: Mapped[str] = mapped_column(String)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SubjectType(StrEnum):
    ADMIN = "admin"
    USER = "user"


class Session(Base):
    """Сессия входа. В cookie — случайный идентификатор, в базе — его SHA-256."""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(16))
    subject_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
