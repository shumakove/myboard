"""HTTP-контракты модуля media."""

import uuid

from pydantic import BaseModel


class MediaOut(BaseModel):
    """Загруженный файл: адрес `url` открывается только с сессией этой доски."""

    id: uuid.UUID
    name: str
    mime: str
    size: int
    url: str
