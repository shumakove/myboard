"""Сессии входа: выдача, поиск по cookie, отзыв (ARCHITECTURE.md, раздел 5).

В cookie лежит случайный идентификатор, в базе — только его SHA-256: утечка таблицы
`sessions` не даёт готовых cookie.
"""

import hashlib
import secrets
import uuid

from fastapi import Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.settings import Settings
from app.identity.models import Session, SubjectType

ADMIN_COOKIE = "myboard_admin"
USER_COOKIE = "myboard_session"

# ACC-03: сессия пользователя досок бессрочна до выхода. Браузеры ограничивают срок cookie
# 400 днями, поэтому cookie продлевается при каждой проверке сессии (GET /api/session).
USER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(
    db: AsyncSession,
    subject_type: SubjectType,
    subject_id: uuid.UUID,
    *,
    board_id: uuid.UUID | None = None,
    display_name: str | None = None,
) -> str:
    """Создаёт сессию и возвращает значение для cookie.

    `board_id` и `display_name` — у сессии участника по ссылке (SHR-03).
    """
    token = secrets.token_urlsafe(32)
    db.add(
        Session(
            id=_digest(token),
            subject_type=subject_type,
            subject_id=subject_id,
            board_id=board_id,
            display_name=display_name,
        )
    )
    await db.commit()
    return token


async def find_subject(
    db: AsyncSession, token: str | None, subject_type: SubjectType
) -> uuid.UUID | None:
    """Идентификатор владельца живой сессии нужного типа или `None`."""
    if not token:
        return None
    return await db.scalar(
        select(Session.subject_id).where(
            Session.id == _digest(token), Session.subject_type == subject_type
        )
    )


async def find_board_session(
    db: AsyncSession, token: str | None, board_id: uuid.UUID
) -> Session | None:
    """Живая сессия участника по ссылке на этой доске или `None` (SHR-02, SHR-06)."""
    if not token:
        return None
    return await db.scalar(
        select(Session).where(
            Session.id == _digest(token),
            Session.subject_type == SubjectType.GUEST,
            Session.board_id == board_id,
        )
    )


async def delete_board_sessions(db: AsyncSession, board_id: uuid.UUID) -> None:
    """Отзывает все сессии участников по ссылке на доске (без commit — SHR-06)."""
    await db.execute(
        delete(Session).where(
            Session.subject_type == SubjectType.GUEST, Session.board_id == board_id
        )
    )


async def delete_session(db: AsyncSession, token: str | None) -> None:
    if token:
        await db.execute(delete(Session).where(Session.id == _digest(token)))
        await db.commit()


async def delete_subject_sessions(
    db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID
) -> None:
    """Отзывает все сессии владельца (без commit — в транзакции вызывающего)."""
    await db.execute(
        delete(Session).where(
            Session.subject_type == subject_type, Session.subject_id == subject_id
        )
    )


def set_session_cookie(
    response: Response, name: str, token: str, settings: Settings, max_age: int | None = None
) -> None:
    """Без `max_age` cookie живёт до закрытия браузера, с ним — переживает перезапуск."""
    # Скрипт страницы cookie не читает; Secure — только при https:// в PUBLIC_BASE_URL.
    response.set_cookie(
        name,
        token,
        max_age=max_age,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


def clear_session_cookie(response: Response, name: str, settings: Settings) -> None:
    response.delete_cookie(
        name, httponly=True, samesite="lax", secure=settings.secure_cookies, path="/"
    )
