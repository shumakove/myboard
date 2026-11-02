"""HTTP-контракты модуля media."""

import uuid
from typing import Annotated

from pydantic import AnyHttpUrl, BaseModel, Field, UrlConstraints

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


class LinkPreviewIn(BaseModel):
    """EMB-02: адрес страницы для карточки ссылки; только http и https."""

    url: Annotated[AnyHttpUrl, UrlConstraints(max_length=2048)]


class LinkPreviewOut(BaseModel):
    """EMB-02: что удалось прочитать со страницы; `image` — уже файл этой доски."""

    url: str
    title: str | None
    image: MediaOut | None
