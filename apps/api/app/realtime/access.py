"""Право открыть канал доски: владелец или участник по ссылке (SHR-02, SHR-04…SHR-06).

Владелец передаёт `board={id}` и сессию пользователя досок. Участник передаёт `token`
ссылки и cookie этой доски: отозванный токен, удалённая доска или сессия, отозванная
сбросом ссылки, канал не открывают. Причина отказа наружу не сообщается.
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession

from app.identity import service as identity
from app.identity.models import SubjectType
from app.identity.sessions import USER_COOKIE, find_board_session, find_subject
from app.library import service as library
from app.sharing import service as sharing


@dataclass(frozen=True)
class AccessRequest:
    """Что прислал клиент при подключении; по нему же доступ перепроверяется."""

    board: str | None
    token: str | None
    cookies: Mapping[str, str]


@dataclass(frozen=True)
class BoardAccess:
    board_id: uuid.UUID
    guest: bool
    # Имя для присутствия и курсора (COL-02): имя учётки владельца или имя участника.
    name: str


async def authorize(db: AsyncSession, request: AccessRequest) -> BoardAccess | None:
    """Доступ к доске или `None`; ровно один из `board` и `token`."""
    if request.board is not None and request.token is None:
        return await _owner(db, request.board, request.cookies)
    if request.token is not None and request.board is None:
        return await _participant(db, request.token, request.cookies)
    return None


async def _owner(db: AsyncSession, board: str, cookies: Mapping[str, str]) -> BoardAccess | None:
    try:
        board_id = uuid.UUID(board)
    except ValueError:
        return None
    user_id = await find_subject(db, cookies.get(USER_COOKIE), SubjectType.USER)
    user = await identity.active_user(db, user_id) if user_id is not None else None
    if user is None or await library.get_board(db, user.id, board_id) is None:
        return None
    return BoardAccess(board_id, guest=False, name=user.name)


async def _participant(
    db: AsyncSession, token: str, cookies: Mapping[str, str]
) -> BoardAccess | None:
    board = await sharing.board_by_token(db, token)
    if board is None:
        return None
    cookie = cookies.get(sharing.board_cookie_name(board.id))
    session = await find_board_session(db, cookie, board.id)
    if session is None:
        return None
    return BoardAccess(board.id, guest=True, name=session.display_name or "")
