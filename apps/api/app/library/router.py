"""HTTP-маршруты модуля library: доски пользователя (ACC-04, BRD-01…BRD-06).

Все маршруты — только для вошедшего пользователя досок (иначе 401) и только над его
досками: чужая, удалённая и несуществующая доска одинаково отвечают 404.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.core.db import SessionDep
from app.identity.account_router import UserDep
from app.library import service
from app.library.models import Board
from app.library.schemas import DEFAULT_TITLE, BoardCreate, BoardOut, BoardRename, BoardSort

router = APIRouter(prefix="/boards", tags=["library"])

BOARD_NOT_FOUND = "Board not found"
_NOT_FOUND: dict[int | str, dict[str, str]] = {404: {"description": BOARD_NOT_FOUND}}


def _found(board: Board | None) -> BoardOut:
    if board is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, BOARD_NOT_FOUND)
    return BoardOut.model_validate(board)


@router.get("")
async def list_boards(
    user: UserDep,
    db: SessionDep,
    q: Annotated[str | None, Query(max_length=200, description="Часть названия")] = None,
    sort: BoardSort = BoardSort.UPDATED,
    modified_since: Annotated[
        datetime | None, Query(description="Только доски, изменённые с этого момента")
    ] = None,
) -> list[BoardOut]:
    """ACC-04, BRD-04: полный список досок пользователя; BRD-05, BRD-06: порядок, фильтр, поиск."""
    boards = await service.list_boards(
        db, user.id, search=q, sort=sort, modified_since=modified_since
    )
    return [BoardOut.model_validate(board) for board in boards]


@router.get("/recent")
async def recent_boards(user: UserDep, db: SessionDep) -> list[BoardOut]:
    """BRD-04: недавние доски — последние изменённые, новые сверху."""
    return [BoardOut.model_validate(board) for board in await service.recent_boards(db, user.id)]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_board(data: BoardCreate, user: UserDep, db: SessionDep) -> BoardOut:
    """BRD-01: новая доска сразу попадает в список; интерфейс открывает её по `id`."""
    return _found(await service.create_board(db, user.id, data.title or DEFAULT_TITLE))


@router.get("/{board_id}", responses=_NOT_FOUND)
async def get_board(board_id: uuid.UUID, user: UserDep, db: SessionDep) -> BoardOut:
    return _found(await service.get_board(db, user.id, board_id))


@router.patch("/{board_id}", responses=_NOT_FOUND)
async def rename_board(
    board_id: uuid.UUID, data: BoardRename, user: UserDep, db: SessionDep
) -> BoardOut:
    """BRD-02"""
    return _found(await service.rename_board(db, user.id, board_id, data.title))


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT, responses=_NOT_FOUND)
async def delete_board(board_id: uuid.UUID, user: UserDep, db: SessionDep) -> Response:
    """BRD-03"""
    if not await service.delete_board(db, user.id, board_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, BOARD_NOT_FOUND)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
