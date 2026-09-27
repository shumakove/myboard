"""Сборка приложения FastAPI: модули, OpenAPI, жизненный цикл процесса."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import anyio.to_thread
from fastapi import APIRouter, FastAPI

from app.backup.router import router as backup_router
from app.core import health
from app.core.db import create_engine, create_session_factory
from app.core.migrations import upgrade_to_head
from app.core.settings import Settings
from app.history.router import router as history_router
from app.identity.router import router as identity_router
from app.library.router import router as library_router
from app.media.router import router as media_router
from app.realtime.router import router as realtime_router
from app.sharing.router import router as sharing_router

API_PREFIX = "/api"

# Модули сервера (ARCHITECTURE.md, раздел 5); код модуля лежит в его пакете.
MODULE_ROUTERS: tuple[APIRouter, ...] = (
    identity_router,
    library_router,
    sharing_router,
    realtime_router,
    history_router,
    media_router,
    backup_router,
)


def create_app(settings: Settings) -> FastAPI:
    """Приложение с заданными настройками; миграции применяются до приёма трафика."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Uvicorn начинает принимать соединения только после старта lifespan.
        await anyio.to_thread.run_sync(upgrade_to_head, settings.database_url)
        engine = create_engine(settings.database_url)
        app.state.session_factory = create_session_factory(engine)
        try:
            yield
        finally:
            await engine.dispose()

    app = FastAPI(
        title="myboard API",
        version="0.1.0",
        openapi_url=f"{API_PREFIX}/openapi.json",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.include_router(health.router, prefix=API_PREFIX)
    for router in MODULE_ROUTERS:
        app.include_router(router, prefix=API_PREFIX)
    return app
