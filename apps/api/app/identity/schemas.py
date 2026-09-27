"""HTTP-контракты модуля identity (публикуются в OpenAPI)."""

import re
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.identity.models import EMAIL_MAX_LENGTH, NAME_MAX_LENGTH

PASSWORD_MAX_LENGTH = 1024

_EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+")


def normalize_email(value: str) -> str:
    """Почта сравнивается без учёта регистра и пробелов по краям."""
    return value.strip().lower()


def _valid_email(value: str) -> str:
    value = normalize_email(value)
    if not _EMAIL_PATTERN.fullmatch(value):
        raise ValueError("must be an email address")
    return value


Email = Annotated[
    str,
    Field(max_length=EMAIL_MAX_LENGTH, examples=["user@example.com"]),
    AfterValidator(_valid_email),
]
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=NAME_MAX_LENGTH)
]
Password = Annotated[str, Field(min_length=1, max_length=PASSWORD_MAX_LENGTH)]


class Credentials(BaseModel):
    """Почта и пароль для входа; формат почты не проверяется, чтобы отказ был одинаковым."""

    email: Annotated[str, Field(max_length=EMAIL_MAX_LENGTH)]
    password: Annotated[str, Field(max_length=PASSWORD_MAX_LENGTH)]


class AdminSession(BaseModel):
    """Состояние входа в панель: `email` администратора или `null`."""

    authenticated: bool
    email: str | None


class AccountSession(BaseModel):
    """Состояние входа пользователя досок: имя и почта или `null` (ACC-01, ACC-03)."""

    authenticated: bool
    name: str | None
    email: str | None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    disabled: bool
    created_at: datetime


class UserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: Name
    email: Email
    password: Password


class UserUpdate(BaseModel):
    """Изменение учётки: переданные поля заменяются, остальные не трогаются."""

    model_config = ConfigDict(extra="forbid")

    name: Name | None = None
    email: Email | None = None
    password: Password | None = None
    disabled: bool | None = None
