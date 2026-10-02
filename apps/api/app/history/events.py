"""Лента действий доски в `board_events` (основа COL-08, ARCHITECTURE.md, раздел 6).

Лента — источник экрана активности, а не механизм синхронизации. Имя автора берётся
из сессии соединения, а не из документа.
"""

import uuid
from collections.abc import Sequence
from enum import StrEnum

from sqlalchemy.ext.asyncio import AsyncSession

from app.history.models import BoardEvent


class EventType(StrEnum):
    # Объекты перенесены из `objects` в `trash`; payload — {"object_ids": [...]}.
    OBJECTS_DELETED = "objects_deleted"


def add_objects_deleted(
    db: AsyncSession, board_id: uuid.UUID, actor_name: str, object_ids: Sequence[str]
) -> None:
    """Добавляет запись об удалении объектов в текущую транзакцию (без commit)."""
    db.add(
        BoardEvent(
            board_id=board_id,
            actor_name=actor_name,
            event_type=EventType.OBJECTS_DELETED,
            payload={"object_ids": list(object_ids)},
        )
    )
