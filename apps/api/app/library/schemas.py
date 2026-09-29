"""HTTP-контракты модуля library (публикуются в OpenAPI)."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated

from pydantic import BaseModel, ConfigDict, StringConstraints

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
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
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
