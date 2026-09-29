"""HTTP-контракты модуля library (публикуются в OpenAPI)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.library.models import TITLE_MAX_LENGTH

DEFAULT_TITLE = "Untitled board"

Title = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=TITLE_MAX_LENGTH)
]


class BoardSort(StrEnum):
    """BRD-05: порядок полного списка. Даты — от новых к старым, название — по алфавиту."""

    UPDATED = "updated"
    CREATED = "created"
    TITLE = "title"


class BoardOut(BaseModel):
    id: uuid.UUID
    title: str
    # BRD-10: папка доски; null — верхний уровень.
    folder_id: uuid.UUID | None
    # BRD-07
    favorite: bool
    created_at: datetime
    updated_at: datetime


class BoardCreate(BaseModel):
    """BRD-01: без названия доска получает DEFAULT_TITLE."""

    model_config = ConfigDict(extra="forbid")

    title: Title | None = None


class BoardRename(BaseModel):
    """BRD-02"""

    model_config = ConfigDict(extra="forbid")

    title: Title


class BoardMove(BaseModel):
    """BRD-10: перенос доски в папку; null — на верхний уровень."""

    model_config = ConfigDict(extra="forbid")

    folder_id: uuid.UUID | None


class FolderOut(BaseModel):
    id: uuid.UUID
    # BRD-09: родительская папка; null — верхний уровень.
    parent_id: uuid.UUID | None
    title: str
    # BRD-10: порядок среди папок того же родителя, по возрастанию.
    position: int
    # BRD-07
    favorite: bool
    created_at: datetime


class FolderCreate(BaseModel):
    """BRD-09: новая папка встаёт последней среди соседей."""

    model_config = ConfigDict(extra="forbid")

    title: Title
    parent_id: uuid.UUID | None = None


class FolderMove(BaseModel):
    """BRD-10: новый родитель и место среди его папок (0 — первой; больше числа — последней)."""

    model_config = ConfigDict(extra="forbid")

    parent_id: uuid.UUID | None
    position: Annotated[int, Field(ge=0)]
