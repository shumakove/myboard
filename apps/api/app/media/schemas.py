"""HTTP-контракты модуля media."""

import uuid

from pydantic import BaseModel, Field

# Столько файлов берёт одна вставка: столько же объектов принимает копия в клиенте.
MAX_COPIED_FILES = 5000


class MediaOut(BaseModel):
    """Загруженный файл: адрес `url` открывается только с сессией этой доски."""

    id: uuid.UUID
    name: str
    mime: str
    size: int
    url: str


class MediaCopyIn(BaseModel):
    """Файлы других досок, которые нужны на этой доске (CVS-20)."""

    media: list[uuid.UUID] = Field(max_length=MAX_COPIED_FILES)


class MediaCopiesOut(BaseModel):
    """Исходный id → id файла на этой доске; недоступных файлов здесь нет."""

    copies: dict[uuid.UUID, uuid.UUID]
