"""Окружение Alembic: синхронный движок psycopg поверх того же DATABASE_URL."""

from alembic import context
from sqlalchemy import create_engine, pool

import app.main  # noqa: F401  # регистрирует модели всех модулей в Base.metadata
from app.core.db import Base
from app.core.settings import load_settings


def _database_url() -> str:
    # Программный запуск (upgrade_to_head) передаёт адрес в конфиге, CLI — через окружение.
    url = context.config.get_main_option("sqlalchemy.url")
    return url or load_settings().database_url


def run_migrations_online() -> None:
    engine = create_engine(_database_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline-режим Alembic не используется")
run_migrations_online()
