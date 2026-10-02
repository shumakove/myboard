"""Сборка приложения FastAPI: модули, OpenAPI, жизненный цикл процесса."""

import asyncio
import contextlib
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
from app.identity.rate_limit import LoginRateLimiter
from app.identity.router import router as identity_router
from app.identity.service import ensure_first_admin
from app.library.router import router as library_router
from app.media.router import router as media_router
from app.realtime.hub import Hub
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
    """Приложение с заданными настройками.

    До приёма трафика применяются миграции и создаётся первый администратор.
    """

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Uvicorn начинает принимать соединения только после старта lifespan.
        await anyio.to_thread.run_sync(upgrade_to_head, settings.database_url)
        engine = create_engine(settings.database_url)
        app.state.session_factory = create_session_factory(engine)
        hub = Hub(app.state.session_factory)
        app.state.hub = hub
        await ensure_first_admin(
            app.state.session_factory, settings.admin_email, settings.admin_password
        )
        # Фоновая задача процесса: снимки открытых досок и сжатие журнала (T4.3).
        compaction = asyncio.create_task(hub.run_compaction(settings.snapshot_interval_seconds))
        try:
            yield
        finally:
            compaction.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await compaction
            # При остановке процесса незаписанных в снимок правок не остаётся.
            await hub.compact_all()
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
    # Вход в панель и вход пользователя досок ограничиваются раздельно (раздел 12).
    app.state.admin_login_limiter = LoginRateLimiter()
    app.state.user_login_limiter = LoginRateLimiter()
    app.include_router(health.router, prefix=API_PREFIX)
    for router in MODULE_ROUTERS:
        app.include_router(router, prefix=API_PREFIX)
    return app
