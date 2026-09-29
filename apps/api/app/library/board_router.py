"""HTTP-маршруты досок пользователя (ACC-04, BRD-01…BRD-07, BRD-10).

Все маршруты — только для вошедшего пользователя досок (иначе 401) и только над его
досками: чужая, удалённая и несуществующая доска одинаково отвечают 404.
"""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Query, Response, status

from app.core.db import SessionDep
from app.identity.account_router import UserDep
from app.library import favorites, service
from app.library.errors import BOARD_NOT_FOUND, FOLDER_NOT_FOUND, not_found
from app.library.folders import FolderNotFoundError
from app.library.models import Board, FavoriteType
from app.library.schemas import (
    DEFAULT_TITLE,
    BoardCreate,
    BoardMove,
    BoardOut,
    BoardRename,
    BoardSort,
)

router = APIRouter(prefix="/boards", tags=["library"])

_NOT_FOUND: dict[int | str, dict[str, str]] = {404: {"description": BOARD_NOT_FOUND}}


def _out(board: Board, favorite_ids: set[uuid.UUID]) -> BoardOut:
    return BoardOut(
        id=board.id,
        title=board.title,
        folder_id=board.folder_id,
        favorite=board.id in favorite_ids,
        created_at=board.created_at,
        updated_at=board.updated_at,
    )


async def _found(db: SessionDep, user_id: uuid.UUID, board: Board | None) -> BoardOut:
    if board is None:
        raise not_found(BOARD_NOT_FOUND)
    return _out(board, await favorites.favorite_ids(db, user_id, FavoriteType.BOARD))


async def _list_out(db: SessionDep, user_id: uuid.UUID, boards: list[Board]) -> list[BoardOut]:
    favorite_ids = await favorites.favorite_ids(db, user_id, FavoriteType.BOARD)
    return [_out(board, favorite_ids) for board in boards]


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
    return await _list_out(db, user.id, boards)


@router.get("/recent")
async def recent_boards(user: UserDep, db: SessionDep) -> list[BoardOut]:
    """BRD-04: недавние доски — последние изменённые, новые сверху."""
    return await _list_out(db, user.id, await service.recent_boards(db, user.id))


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_board(data: BoardCreate, user: UserDep, db: SessionDep) -> BoardOut:
    """BRD-01: новая доска сразу попадает в список; интерфейс открывает её по `id`."""
    board = await service.create_board(db, user.id, data.title or DEFAULT_TITLE)
    return await _found(db, user.id, board)


@router.get("/{board_id}", responses=_NOT_FOUND)
async def get_board(board_id: uuid.UUID, user: UserDep, db: SessionDep) -> BoardOut:
    return await _found(db, user.id, await service.get_board(db, user.id, board_id))


@router.patch("/{board_id}", responses=_NOT_FOUND)
async def rename_board(
    board_id: uuid.UUID, data: BoardRename, user: UserDep, db: SessionDep
) -> BoardOut:
    """BRD-02"""
    board = await service.rename_board(db, user.id, board_id, data.title)
    return await _found(db, user.id, board)


@router.put("/{board_id}/folder", responses={404: {"description": "Board or folder not found"}})
async def move_board(
    board_id: uuid.UUID, data: BoardMove, user: UserDep, db: SessionDep
) -> BoardOut:
    """BRD-10: перенести доску в папку (`folder_id`) или на верхний уровень (`null`)."""
    try:
        board = await service.move_board(db, user.id, board_id, data.folder_id)
    except FolderNotFoundError:
        raise not_found(FOLDER_NOT_FOUND) from None
    return await _found(db, user.id, board)


@router.put("/{board_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, responses=_NOT_FOUND)
async def add_favorite(board_id: uuid.UUID, user: UserDep, db: SessionDep) -> Response:
    """BRD-07: добавить доску в избранное."""
    return await _set_favorite(db, user.id, board_id, favorite=True)


@router.delete("/{board_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, responses=_NOT_FOUND)
async def remove_favorite(board_id: uuid.UUID, user: UserDep, db: SessionDep) -> Response:
    """BRD-07: убрать доску из избранного."""
    return await _set_favorite(db, user.id, board_id, favorite=False)


async def _set_favorite(
    db: SessionDep, user_id: uuid.UUID, board_id: uuid.UUID, *, favorite: bool
) -> Response:
    if await service.get_board(db, user_id, board_id) is None:
        raise not_found(BOARD_NOT_FOUND)
    await favorites.set_favorite(db, user_id, FavoriteType.BOARD, board_id, favorite=favorite)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{board_id}", status_code=status.HTTP_204_NO_CONTENT, responses=_NOT_FOUND)
async def delete_board(board_id: uuid.UUID, user: UserDep, db: SessionDep) -> Response:
    """BRD-03"""
    if not await service.delete_board(db, user.id, board_id):
        raise not_found(BOARD_NOT_FOUND)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
