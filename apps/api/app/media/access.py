"""Право на файлы доски: владелец или участник по ссылке этой доски (раздел 8 архитектуры).

Владелец — живая сессия пользователя досок, которому принадлежит неудалённая доска.
Участник — cookie этой доски с живой сессией: сброс ссылки удаляет сессии (SHR-06),
и старая cookie файлов больше не получает.
"""

import uuid
from collections.abc import Mapping

from sqlalchemy.ext.asyncio import AsyncSession

from app.identity import service as identity
from app.identity.models import SubjectType
from app.identity.sessions import USER_COOKIE, find_board_session, find_subject
from app.library import service as library
from app.library.models import Board
from app.sharing.service import board_cookie_name


async def can_use_board(db: AsyncSession, board_id: uuid.UUID, cookies: Mapping[str, str]) -> bool:
    """Есть ли у запроса сессия этой доски (владельца или участника)."""
    board = await db.get(Board, board_id)
    if board is None or board.deleted_at is not None:
        return False
    guest = await find_board_session(db, cookies.get(board_cookie_name(board_id)), board_id)
    if guest is not None:
        return True
    user_id = await find_subject(db, cookies.get(USER_COOKIE), SubjectType.USER)
    user = await identity.active_user(db, user_id) if user_id is not None else None
    return user is not None and await library.get_board(db, user.id, board_id) is not None
