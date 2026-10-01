"""Операции над досками пользователя. Каждый запрос ограничен владельцем (раздел 7 архитектуры)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ColumnElement, Select, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.library.folders import FolderNotFoundError, get_folder
from app.library.models import Board
from app.library.schemas import BoardSort
from app.library.text_search import contains

# BRD-04: сколько досок показывает блок «недавние».
RECENT_LIMIT = 8

_ORDER: dict[BoardSort, tuple[ColumnElement[Any], ...]] = {
    BoardSort.UPDATED: (Board.updated_at.desc(), Board.id.asc()),
    BoardSort.CREATED: (Board.created_at.desc(), Board.id.asc()),
    BoardSort.TITLE: (func.lower(Board.title).asc(), Board.id.asc()),
}


def _owned(owner_id: uuid.UUID) -> Select[Board]:
    """Живые доски владельца; чужие и удалённые строки запрос не возвращает."""
    return select(Board).where(Board.owner_id == owner_id, Board.deleted_at.is_(None))


async def list_boards(
    db: AsyncSession,
    owner_id: uuid.UUID,
    *,
    search: str | None = None,
    sort: BoardSort = BoardSort.UPDATED,
    modified_since: datetime | None = None,
) -> list[Board]:
    """ACC-04, BRD-04: полный список; BRD-05: сортировка и фильтр; BRD-06: поиск по названию."""
    query = _owned(owner_id)
    if search and search.strip():
        query = query.where(Board.title.ilike(contains(search.strip()), escape="\\"))
    if modified_since is not None:
        query = query.where(Board.updated_at >= modified_since)
    return list(await db.scalars(query.order_by(*_ORDER[sort])))


async def recent_boards(db: AsyncSession, owner_id: uuid.UUID) -> list[Board]:
    """BRD-04: последние изменённые доски."""
    query = _owned(owner_id).order_by(*_ORDER[BoardSort.UPDATED]).limit(RECENT_LIMIT)
    return list(await db.scalars(query))


async def get_board(db: AsyncSession, owner_id: uuid.UUID, board_id: uuid.UUID) -> Board | None:
    return await db.scalar(_owned(owner_id).where(Board.id == board_id))


async def create_board(db: AsyncSession, owner_id: uuid.UUID, title: str) -> Board:
    """BRD-01"""
    board = Board(owner_id=owner_id, title=title)
    db.add(board)
    await db.commit()
    await db.refresh(board)  # created_at и updated_at из базы
    return board


async def rename_board(
    db: AsyncSession, owner_id: uuid.UUID, board_id: uuid.UUID, title: str
) -> Board | None:
    """BRD-02: переименование — тоже изменение доски, она поднимается в «недавних»."""
    board = await get_board(db, owner_id, board_id)
    if board is None:
        return None
    board.title = title
    board.updated_at = func.now()
    await db.commit()
    await db.refresh(board)
    return board


async def touch_board(db: AsyncSession, board_id: uuid.UUID) -> None:
    """BRD-04: принятая правка документа поднимает доску в «недавних» (без commit)."""
    await db.execute(update(Board).where(Board.id == board_id).values(updated_at=func.now()))


async def move_board(
    db: AsyncSession, owner_id: uuid.UUID, board_id: uuid.UUID, folder_id: uuid.UUID | None
) -> Board | None:
    """BRD-10: перенос между папками — раскладка списка, а не правка доски: `updated_at` прежний."""
    board = await get_board(db, owner_id, board_id)
    if board is None:
        return None
    if folder_id is not None and await get_folder(db, owner_id, folder_id) is None:
        raise FolderNotFoundError
    board.folder_id = folder_id
    await db.commit()
    await db.refresh(board)
    return board


async def delete_board(db: AsyncSession, owner_id: uuid.UUID, board_id: uuid.UUID) -> bool:
    """BRD-03: пометка `deleted_at`; содержимое и файлы остаются в базе."""
    board = await get_board(db, owner_id, board_id)
    if board is None:
        return False
    board.deleted_at = func.now()
    await db.commit()
    return True
