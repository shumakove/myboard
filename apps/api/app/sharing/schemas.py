"""HTTP-контракты модуля sharing (публикуются в OpenAPI)."""

import uuid

from pydantic import BaseModel

from app.identity.schemas import Name


class ShareLink(BaseModel):
    """SHR-01: действующая ссылка на доску; `url` собран из PUBLIC_BASE_URL."""

    token: str
    url: str


class Participant(BaseModel):
    """Участник по ссылке: отображаемое имя из сессии этой доски (SHR-03)."""

    name: str


class SharedBoard(BaseModel):
    """Доска, открытая по ссылке; `participant` — `null`, пока имя не введено (SHR-02, SHR-03).

    `id` — ключ, под которым браузер помнит вид камеры на этой доске (CVS-05).
    """

    id: uuid.UUID
    title: str
    participant: Participant | None


class JoinRequest(BaseModel):
    """SHR-03: отображаемое имя участника на эту сессию."""

    name: Name
