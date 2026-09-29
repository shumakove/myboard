"""Избранное пользователя: доски и папки (BRD-07). Владение целью проверяет вызывающий код."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.library.models import Favorite, FavoriteType


async def favorite_ids(
    db: AsyncSession, user_id: uuid.UUID, target_type: FavoriteType
) -> set[uuid.UUID]:
    query = select(Favorite.target_id).where(
        Favorite.user_id == user_id, Favorite.target_type == target_type
    )
    return set(await db.scalars(query))


async def set_favorite(
    db: AsyncSession,
    user_id: uuid.UUID,
    target_type: FavoriteType,
    target_id: uuid.UUID,
    *,
    favorite: bool,
) -> None:
    """Добавить в избранное или убрать; повтор ничего не меняет."""
    if favorite:
        await db.execute(
            insert(Favorite)
            .values(user_id=user_id, target_type=target_type, target_id=target_id)
            .on_conflict_do_nothing()
        )
    else:
        await db.execute(
            delete(Favorite).where(
                Favorite.user_id == user_id,
                Favorite.target_type == target_type,
                Favorite.target_id == target_id,
            )
        )
    await db.commit()
