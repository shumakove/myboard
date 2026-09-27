"""Служебный маршрут проверки живости: его опрашивает healthcheck Compose."""

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import text

from app.core.db import SessionDep

router = APIRouter(tags=["health"])


class Health(BaseModel):
    status: str


@router.get("/health")
async def health(session: SessionDep) -> Health:
    """Процесс отвечает и база данных доступна."""
    await session.execute(text("SELECT 1"))
    return Health(status="ok")
