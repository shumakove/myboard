"""Общие фикстуры: PostgreSQL для тестов, пустая база на тест, настройки, клиент.

PostgreSQL берётся из TEST_DATABASE_URL (адрес сервера, база в нём — служебная),
иначе поднимается контейнер postgres:16-alpine через testcontainers (нужен Docker).
"""

import os
import secrets
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, make_url, text

from app.core.settings import Settings
from app.main import create_app

POSTGRES_IMAGE = "postgres:16-alpine"


@pytest.fixture(scope="session")
def postgres_url() -> Iterator[str]:
    """Адрес служебной базы сервера PostgreSQL, в котором создаются тестовые базы."""
    external = os.environ.get("TEST_DATABASE_URL")
    if external:
        yield external
        return
    from testcontainers.community.postgres import PostgresContainer

    with PostgresContainer(POSTGRES_IMAGE, driver="psycopg") as container:
        yield str(container.get_connection_url())


@pytest.fixture
def database_url(postgres_url: str) -> Iterator[str]:
    """Отдельная пустая база на каждый тест; удаляется после теста."""
    name = f"test_{secrets.token_hex(6)}"
    admin = create_engine(postgres_url, isolation_level="AUTOCOMMIT")
    with admin.connect() as connection:
        connection.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield make_url(postgres_url).set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as connection:
            connection.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
        admin.dispose()


@pytest.fixture
def settings(database_url: str, tmp_path: Path) -> Settings:
    return Settings(
        public_base_url="http://192.168.1.20:8080",
        secret_key="test-secret",
        database_url=database_url,
        media_root=str(tmp_path / "media"),
        admin_email="admin@example.com",
        admin_password="admin-password",
        max_upload_bytes=1024,
    )


@pytest.fixture
def client(settings: Settings) -> Iterator[TestClient]:
    """Клиент запущенного приложения: lifespan (и миграции) уже выполнен."""
    with TestClient(create_app(settings)) as test_client:
        yield test_client
