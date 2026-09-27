"""Каркас процесса: обязательные переменные, миграции при старте, OpenAPI, health."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from alembic import command
from alembic.script import ScriptDirectory
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.core.migrations import alembic_config
from app.core.settings import Settings, SettingsError, load_settings
from app.main import create_app

API_DIR = Path(__file__).resolve().parent.parent

REQUIRED_ENV = {
    "PUBLIC_BASE_URL": "http://192.168.1.20:8080",
    "SECRET_KEY": "secret",
    "DATABASE_URL": "postgresql+psycopg://user:pass@db.invalid:5432/board",
    "MEDIA_ROOT": "/data/media",
    "ADMIN_EMAIL": "admin@example.com",
    "ADMIN_PASSWORD": "admin-password",
    "MAX_UPLOAD_BYTES": "1048576",
}


def _clean_environ() -> dict[str, str]:
    return {k: v for k, v in os.environ.items() if k.upper() not in REQUIRED_ENV}


def _run_process(env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "app"],
        cwd=API_DIR,
        env=_clean_environ() | env,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )


def _env_without(name: str) -> dict[str, str]:
    return {k: v for k, v in REQUIRED_ENV.items() if k != name}


def _head_revision(database_url: str) -> str | None:
    return ScriptDirectory.from_config(alembic_config(database_url)).get_current_head()


def _current_revision(database_url: str) -> str | None:
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            if not inspect(connection).has_table("alembic_version"):
                return None
            return connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    finally:
        engine.dispose()


# --- Обязательные переменные: без любой процесс не стартует ---------------------


@pytest.mark.parametrize("name", sorted(REQUIRED_ENV))
def test_process_exits_with_variable_name_when_variable_missing(name: str) -> None:
    result = _run_process(_env_without(name))
    assert result.returncode == 1
    assert f"{name}: is required" in result.stderr


@pytest.mark.parametrize("name", sorted(REQUIRED_ENV))
def test_empty_variable_counts_as_missing(name: str, monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in (_clean_environ() | REQUIRED_ENV | {name: "  "}).items():
        monkeypatch.setenv(key, value)
    with pytest.raises(SettingsError, match=f"{name}: is required"):
        load_settings()


def test_all_missing_variables_are_listed_together() -> None:
    result = _run_process({})
    assert result.returncode == 1
    for name in REQUIRED_ENV:
        assert name in result.stderr


@pytest.mark.parametrize("value", ["0", "-1", "abc"])
def test_invalid_max_upload_bytes_is_rejected(value: str, monkeypatch: pytest.MonkeyPatch) -> None:
    for key, env_value in (REQUIRED_ENV | {"MAX_UPLOAD_BYTES": value}).items():
        monkeypatch.setenv(key, env_value)
    with pytest.raises(SettingsError, match="MAX_UPLOAD_BYTES"):
        load_settings()


def test_public_base_url_requires_http_scheme(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in (REQUIRED_ENV | {"PUBLIC_BASE_URL": "192.168.1.20"}).items():
        monkeypatch.setenv(key, value)
    with pytest.raises(SettingsError, match="PUBLIC_BASE_URL"):
        load_settings()


def test_settings_are_read_from_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in (REQUIRED_ENV | {"PUBLIC_BASE_URL": "http://192.168.1.20/"}).items():
        monkeypatch.setenv(key, value)
    settings = load_settings()
    assert settings.public_base_url == "http://192.168.1.20"
    assert settings.max_upload_bytes == 1048576
    assert settings.secure_cookies is False


def test_secure_cookies_only_for_https_base_url(settings: Settings) -> None:
    https = settings.model_copy(update={"public_base_url": "https://board.example.org"})
    assert https.secure_cookies is True
    assert settings.secure_cookies is False


# --- Миграции: применяются на пустой базе до приёма трафика ---------------------


def test_startup_applies_migrations_on_empty_database(settings: Settings) -> None:
    assert _current_revision(settings.database_url) is None
    with TestClient(create_app(settings)) as client:
        # Первый же запрос обслуживается уже на мигрированной базе.
        assert _current_revision(settings.database_url) == _head_revision(settings.database_url)
        assert client.get("/api/health").status_code == 200


def test_restart_on_migrated_database_keeps_revision(settings: Settings) -> None:
    for _ in range(2):
        with TestClient(create_app(settings)):
            pass
    assert _current_revision(settings.database_url) == _head_revision(settings.database_url)


def test_migrations_have_single_head(database_url: str) -> None:
    heads = ScriptDirectory.from_config(alembic_config(database_url)).get_heads()
    assert len(heads) == 1


def test_downgrade_is_not_supported(client: TestClient, settings: Settings) -> None:
    with pytest.raises(NotImplementedError):
        command.downgrade(alembic_config(settings.database_url), "base")


# --- HTTP: OpenAPI, health, неизвестный путь ------------------------------------


def test_openapi_is_published_under_api(client: TestClient) -> None:
    response = client.get("/api/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert schema["openapi"].startswith("3.")
    assert "/api/health" in schema["paths"]


def test_health_reports_ok_with_database(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_unknown_api_path_is_json_404(client: TestClient) -> None:
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")
