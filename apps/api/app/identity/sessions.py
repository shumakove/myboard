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


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_session(db: AsyncSession, subject_type: SubjectType, subject_id: uuid.UUID) -> str:
    """Создаёт сессию и возвращает значение для cookie."""
    token = secrets.token_urlsafe(32)
    db.add(Session(id=_digest(token), subject_type=subject_type, subject_id=subject_id))
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


def set_session_cookie(response: Response, name: str, token: str, settings: Settings) -> None:
    # Скрипт страницы cookie не читает; Secure — только при https:// в PUBLIC_BASE_URL.
    response.set_cookie(
        name,
        token,
        httponly=True,
        samesite="lax",
        secure=settings.secure_cookies,
        path="/",
    )


def clear_session_cookie(response: Response, name: str, settings: Settings) -> None:
    response.delete_cookie(
        name, httponly=True, samesite="lax", secure=settings.secure_cookies, path="/"
    )
