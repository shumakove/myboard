"""Папки пользователя: создание, вложенность, порядок (BRD-06, BRD-09, BRD-10)."""

import uuid
from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.library.models import Folder
from app.library.text_search import contains


class FolderNotFoundError(LookupError):
    """Папки нет у владельца: чужая и несуществующая неразличимы."""


class FolderCycleError(ValueError):
    """Папку нельзя вложить в неё саму или в её дочернюю папку."""


def _sibling_order(folder: Folder) -> tuple[int, datetime, uuid.UUID]:
    return folder.position, folder.created_at, folder.id


async def _lock_owned(db: AsyncSession, owner_id: uuid.UUID) -> dict[uuid.UUID, Folder]:
    """Все папки владельца под блокировкой: создания и переносы одного владельца идут по очереди,
    поэтому порядок и проверка циклов видят согласованное дерево."""
    query = select(Folder).where(Folder.owner_id == owner_id).order_by(Folder.id).with_for_update()
    return {folder.id: folder for folder in await db.scalars(query)}


def _siblings(folders: Iterable[Folder], parent_id: uuid.UUID | None) -> list[Folder]:
    return sorted((f for f in folders if f.parent_id == parent_id), key=_sibling_order)


def _is_within(
    folders: dict[uuid.UUID, Folder], folder_id: uuid.UUID | None, ancestor_id: uuid.UUID
) -> bool:
    """Лежит ли `folder_id` внутри `ancestor_id` (или совпадает с ней)."""
    seen: set[uuid.UUID] = set()
    while folder_id is not None and folder_id not in seen:
        if folder_id == ancestor_id:
            return True
        seen.add(folder_id)
        folder_id = folders[folder_id].parent_id
    return False


async def list_folders(
    db: AsyncSession, owner_id: uuid.UUID, *, search: str | None = None
) -> list[Folder]:
    """Папки владельца в порядке `position`; BRD-06: поиск по части названия."""
    query = select(Folder).where(Folder.owner_id == owner_id)
    if search and search.strip():
        query = query.where(Folder.title.ilike(contains(search.strip()), escape="\\"))
    query = query.order_by(Folder.position, Folder.created_at, Folder.id)
    return list(await db.scalars(query))


async def get_folder(db: AsyncSession, owner_id: uuid.UUID, folder_id: uuid.UUID) -> Folder | None:
    return await db.scalar(
        select(Folder).where(Folder.owner_id == owner_id, Folder.id == folder_id)
    )


async def create_folder(
    db: AsyncSession, owner_id: uuid.UUID, title: str, parent_id: uuid.UUID | None
) -> Folder:
    """BRD-09: папка встаёт последней среди папок родителя."""
    folders = await _lock_owned(db, owner_id)
    if parent_id is not None and parent_id not in folders:
        raise FolderNotFoundError
    siblings = _siblings(folders.values(), parent_id)
    position = siblings[-1].position + 1 if siblings else 0
    folder = Folder(owner_id=owner_id, parent_id=parent_id, title=title, position=position)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    return folder


async def move_folder(
    db: AsyncSession,
    owner_id: uuid.UUID,
    folder_id: uuid.UUID,
    parent_id: uuid.UUID | None,
    position: int,
) -> Folder:
    """BRD-10: переставить папку среди соседей или вложить в другую папку.

    `position` — индекс среди папок нового родителя без самой папки; соседи перенумеровываются.
    """
    folders = await _lock_owned(db, owner_id)
    folder = folders.get(folder_id)
    if folder is None or (parent_id is not None and parent_id not in folders):
        raise FolderNotFoundError
    if _is_within(folders, parent_id, folder_id):
        raise FolderCycleError
    siblings = [f for f in _siblings(folders.values(), parent_id) if f.id != folder_id]
    siblings.insert(min(position, len(siblings)), folder)
    folder.parent_id = parent_id
    for index, sibling in enumerate(siblings):
        sibling.position = index
    await db.commit()
    await db.refresh(folder)
    return folder
