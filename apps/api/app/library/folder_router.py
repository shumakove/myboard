"""HTTP-маршруты папок пользователя (BRD-06, BRD-07, BRD-09, BRD-10).

Только для вошедшего пользователя досок (иначе 401) и только над его папками:
чужая и несуществующая папка одинаково отвечают 404.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.core.db import SessionDep
from app.identity.account_router import UserDep
from app.library import favorites, folders
from app.library.errors import FOLDER_CYCLE, FOLDER_NOT_FOUND, not_found
from app.library.folders import FolderCycleError, FolderNotFoundError
from app.library.models import FavoriteType, Folder
from app.library.schemas import FolderCreate, FolderMove, FolderOut

router = APIRouter(prefix="/folders", tags=["library"])

_NOT_FOUND: dict[int | str, dict[str, str]] = {404: {"description": FOLDER_NOT_FOUND}}


def _out(folder: Folder, favorite_ids: set[uuid.UUID]) -> FolderOut:
    return FolderOut(
        id=folder.id,
        parent_id=folder.parent_id,
        title=folder.title,
        position=folder.position,
        favorite=folder.id in favorite_ids,
        created_at=folder.created_at,
    )


async def _one_out(db: SessionDep, user_id: uuid.UUID, folder: Folder) -> FolderOut:
    return _out(folder, await favorites.favorite_ids(db, user_id, FavoriteType.FOLDER))


@router.get("")
async def list_folders(
    user: UserDep,
    db: SessionDep,
    q: Annotated[str | None, Query(max_length=200, description="Часть названия")] = None,
) -> list[FolderOut]:
    """BRD-09: все папки пользователя (дерево строит интерфейс); BRD-06: поиск по названию."""
    found = await folders.list_folders(db, user.id, search=q)
    favorite_ids = await favorites.favorite_ids(db, user.id, FavoriteType.FOLDER)
    return [_out(folder, favorite_ids) for folder in found]


@router.post("", status_code=status.HTTP_201_CREATED, responses=_NOT_FOUND)
async def create_folder(data: FolderCreate, user: UserDep, db: SessionDep) -> FolderOut:
    """BRD-09: папка на верхнем уровне или внутри `parent_id`."""
    try:
        folder = await folders.create_folder(db, user.id, data.title, data.parent_id)
    except FolderNotFoundError:
        raise not_found(FOLDER_NOT_FOUND) from None
    return await _one_out(db, user.id, folder)


@router.put(
    "/{folder_id}/position",
    responses={
        404: {"description": FOLDER_NOT_FOUND},
        409: {"description": FOLDER_CYCLE},
    },
)
async def move_folder(
    folder_id: uuid.UUID, data: FolderMove, user: UserDep, db: SessionDep
) -> FolderOut:
    """BRD-10: поставить папку на место `position` среди папок `parent_id` (null — верхний
    уровень). Вложить папку в неё саму или в её дочернюю нельзя — 409."""
    try:
        folder = await folders.move_folder(db, user.id, folder_id, data.parent_id, data.position)
    except FolderNotFoundError:
        raise not_found(FOLDER_NOT_FOUND) from None
    except FolderCycleError:
        raise HTTPException(status.HTTP_409_CONFLICT, FOLDER_CYCLE) from None
    return await _one_out(db, user.id, folder)


@router.put("/{folder_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, responses=_NOT_FOUND)
async def add_favorite(folder_id: uuid.UUID, user: UserDep, db: SessionDep) -> Response:
    """BRD-07: добавить папку в избранное."""
    return await _set_favorite(db, user.id, folder_id, favorite=True)


@router.delete(
    "/{folder_id}/favorite", status_code=status.HTTP_204_NO_CONTENT, responses=_NOT_FOUND
)
async def remove_favorite(folder_id: uuid.UUID, user: UserDep, db: SessionDep) -> Response:
    """BRD-07: убрать папку из избранного."""
    return await _set_favorite(db, user.id, folder_id, favorite=False)


async def _set_favorite(
    db: SessionDep, user_id: uuid.UUID, folder_id: uuid.UUID, *, favorite: bool
) -> Response:
    if await folders.get_folder(db, user_id, folder_id) is None:
        raise not_found(FOLDER_NOT_FOUND)
    await favorites.set_favorite(db, user_id, FavoriteType.FOLDER, folder_id, favorite=favorite)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
