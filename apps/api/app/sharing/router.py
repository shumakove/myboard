"""HTTP-маршруты модуля sharing: ссылка владельца и вход по ссылке (SHR-01…SHR-03, SHR-05, SHR-06).

Маршруты владельца требуют сессию пользователя досок и отвечают 404 на чужую доску.
Маршруты участника знают только токен: отозванный и несуществующий отвечают одинаково.
"""

import uuid

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.core.db import SessionDep
from app.identity.account_router import UserDep
from app.identity.http import settings_of
from app.identity.sessions import set_session_cookie
from app.library import service as library
from app.library.errors import BOARD_NOT_FOUND, not_found
from app.library.models import Board
from app.sharing import service
from app.sharing.schemas import JoinRequest, Participant, SharedBoard, ShareLink

router = APIRouter(tags=["sharing"])

# SHR-05 и раздел 12 архитектуры: один скупой ответ на любой недействующий токен.
LINK_UNAVAILABLE = "Link is not available"

_BOARD_NOT_FOUND: dict[int | str, dict[str, str]] = {404: {"description": BOARD_NOT_FOUND}}
_LINK_UNAVAILABLE: dict[int | str, dict[str, str]] = {404: {"description": LINK_UNAVAILABLE}}


def _link(request: Request, token: str) -> ShareLink:
    return ShareLink(token=token, url=f"{settings_of(request).public_base_url}/b/{token}")


async def _owned_board(db: SessionDep, user_id: uuid.UUID, board_id: uuid.UUID) -> Board:
    board = await library.get_board(db, user_id, board_id)
    if board is None:
        raise not_found(BOARD_NOT_FOUND)
    return board


async def _shared_board(db: SessionDep, token: str) -> Board:
    board = await service.board_by_token(db, token)
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, LINK_UNAVAILABLE)
    return board


@router.get("/boards/{board_id}/share", responses=_BOARD_NOT_FOUND)
async def get_share_link(
    board_id: uuid.UUID, request: Request, user: UserDep, db: SessionDep
) -> ShareLink:
    """SHR-01: ссылка на свою доску, чтобы скопировать и переслать."""
    board = await _owned_board(db, user.id, board_id)
    return _link(request, await service.current_token(db, board))


@router.post("/boards/{board_id}/share/reset", responses=_BOARD_NOT_FOUND)
async def reset_share_link(
    board_id: uuid.UUID, request: Request, user: UserDep, db: SessionDep
) -> ShareLink:
    """SHR-06: новая ссылка; прежняя и сессии, выданные по ней, больше не действуют."""
    board = await _owned_board(db, user.id, board_id)
    return _link(request, await service.reset_token(db, board))


@router.get("/share/{token}", responses=_LINK_UNAVAILABLE)
async def open_shared_board(token: str, request: Request, db: SessionDep) -> SharedBoard:
    """SHR-02, SHR-05: доска по ссылке; `participant` — `null`, пока имя не введено."""
    board = await _shared_board(db, token)
    session = await service.participant(
        db, board, request.cookies.get(service.board_cookie_name(board.id))
    )
    name = session.display_name if session is not None else None
    return SharedBoard(
        title=board.title, participant=Participant(name=name) if name is not None else None
    )


@router.post("/share/{token}/join", responses=_LINK_UNAVAILABLE)
async def join_shared_board(
    token: str, data: JoinRequest, request: Request, response: Response, db: SessionDep
) -> SharedBoard:
    """SHR-02, SHR-03: имя на сессию → cookie этой доски до закрытия браузера."""
    board = await _shared_board(db, token)
    cookie_name = service.board_cookie_name(board.id)
    session_token = await service.join(db, board, data.name, request.cookies.get(cookie_name))
    set_session_cookie(response, cookie_name, session_token, settings_of(request))
    return SharedBoard(title=board.title, participant=Participant(name=data.name))
