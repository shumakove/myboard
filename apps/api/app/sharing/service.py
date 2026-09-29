"""Ссылка на доску и вход по ней (ARCHITECTURE.md, раздел 5, «Ссылка»).

У доски одна действующая ссылка. Токен — 32 случайных байта в URL-безопасной кодировке,
не связанный с id доски. Сброс записывает новый токен и отзывает сессии участников.
"""

import secrets
import uuid

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.identity.models import Session, SubjectType
from app.identity.sessions import (
    create_session,
    delete_board_sessions,
    delete_session,
    find_board_session,
)
from app.library.models import Board

TOKEN_BYTES = 32
# Длина token_urlsafe(32) — 43 символа; длиннее столбца токен заведомо не найдётся.
TOKEN_MAX_LENGTH = 64


def new_token() -> str:
    return secrets.token_urlsafe(TOKEN_BYTES)


def board_cookie_name(board_id: uuid.UUID) -> str:
    """Своя сессионная cookie у каждой доски: участник может быть на нескольких досках."""
    return f"myboard_board_{board_id.hex}"


async def current_token(db: AsyncSession, board: Board) -> str:
    """SHR-01: действующий токен доски; при первом запросе он выдаётся."""
    if board.share_token is None:
        # Условие `IS NULL` не даёт двум одновременным запросам выдать разные токены.
        await db.execute(
            update(Board)
            .where(Board.id == board.id, Board.share_token.is_(None))
            .values(share_token=new_token())
        )
        await db.commit()
        await db.refresh(board)
    assert board.share_token is not None
    return board.share_token


async def reset_token(db: AsyncSession, board: Board) -> str:
    """SHR-06: новый токен; прежний и выданные по нему сессии перестают действовать сразу."""
    board.share_token = new_token()
    board.share_token_revoked_at = func.now()
    await delete_board_sessions(db, board.id)
    await db.commit()
    await db.refresh(board)
    assert board.share_token is not None
    return board.share_token


async def board_by_token(db: AsyncSession, token: str) -> Board | None:
    """SHR-05: доска по действующему токену. Отозванный, чужой и неизвестный — одинаково `None`."""
    if not token or len(token) > TOKEN_MAX_LENGTH:
        return None
    return await db.scalar(
        select(Board).where(Board.share_token == token, Board.deleted_at.is_(None))
    )


async def participant(db: AsyncSession, board: Board, cookie: str | None) -> Session | None:
    """Сессия участника по ссылке на этой доске, если она не отозвана (SHR-06)."""
    return await find_board_session(db, cookie, board.id)


async def join(db: AsyncSession, board: Board, name: str, cookie: str | None) -> str:
    """SHR-02, SHR-03: сессия участника с именем; учётная запись не создаётся.

    Повторный вход заменяет прежнюю сессию этого браузера на доске.
    """
    if await participant(db, board, cookie) is not None:
        await delete_session(db, cookie)
    return await create_session(
        db, SubjectType.GUEST, uuid.uuid4(), board_id=board.id, display_name=name
    )
