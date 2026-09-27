"""Приёмка T0.2 · Каркас API: обязательные переменные, миграции, OpenAPI.

HTTP-проверки идут через Caddy по PUBLIC_BASE_URL. Проверки запуска процесса
(ARCH-CFG-*, ARCH-MIG-*) запускают собранный образ `api` стека QA отдельным
контейнером в сети стека: это публичный интерфейс оператора — переменные
окружения, код выхода и вывод процесса. Код из `apps/` не импортируется.

Нужен запущенный стек `myboard-qa` и Docker CLI. Имя проекта Compose можно
переопределить переменной QA_COMPOSE_PROJECT.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
import uuid
from collections.abc import Iterator

import pytest

from stand import Client

PROJECT = os.environ.get("QA_COMPOSE_PROJECT", "myboard-qa")
API_IMAGE = f"{PROJECT}-api"
NETWORK = f"{PROJECT}_default"

REQUIRED = (
    "PUBLIC_BASE_URL",
    "SECRET_KEY",
    "DATABASE_URL",
    "MEDIA_ROOT",
    "ADMIN_EMAIL",
    "ADMIN_PASSWORD",
    "MAX_UPLOAD_BYTES",
)

# Отличимые значения секретов — чтобы проверить, что они не попадают в вывод.
SECRET_VALUE = "qa-secret-" + uuid.uuid4().hex
ADMIN_PASSWORD_VALUE = "qa-admin-pw-" + uuid.uuid4().hex

needs_docker = pytest.mark.skipif(shutil.which("docker") is None, reason="нужен Docker CLI")


def _docker(*args: str, timeout: float = 60) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args], capture_output=True, text=True, timeout=timeout, check=False
    )


def _service_container(service: str) -> str:
    out = _docker(
        "ps",
        "-q",
        "--filter",
        f"label=com.docker.compose.project={PROJECT}",
        "--filter",
        f"label=com.docker.compose.service={service}",
    ).stdout.strip()
    if not out:
        pytest.fail(f"Контейнер {service} проекта {PROJECT} не запущен", pytrace=False)
    return out.splitlines()[0]


def _container_env(container: str) -> dict[str, str]:
    out = _docker("inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", container).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


def _psql(sql: str, db: str | None = None) -> str:
    pg = _service_container("postgres")
    env = _container_env(pg)
    res = _docker(
        "exec",
        pg,
        "psql",
        "-U",
        env["POSTGRES_USER"],
        "-d",
        db or env["POSTGRES_DB"],
        "-tAc",
        sql,
    )
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


@pytest.fixture(scope="module")
def stack_env() -> dict[str, str]:
    """Рабочий набор обязательных переменных — тот, с которым запущен стек."""
    env = _container_env(_service_container("api"))
    missing = [name for name in REQUIRED if name not in env]
    assert not missing, f"в контейнере api стека нет переменных {missing}"
    base = {name: env[name] for name in REQUIRED}
    base["SECRET_KEY"] = SECRET_VALUE
    base["ADMIN_PASSWORD"] = ADMIN_PASSWORD_VALUE
    return base


@pytest.fixture
def fresh_database(stack_env: dict[str, str]) -> Iterator[str]:
    """Пустая база в PostgreSQL стека; возвращает DATABASE_URL на неё."""
    name = "qa_" + uuid.uuid4().hex[:12]
    _psql(f"CREATE DATABASE {name}")
    url = stack_env["DATABASE_URL"].rsplit("/", 1)[0] + "/" + name
    try:
        yield url
    finally:
        _psql(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


def _run_once(env: dict[str, str], timeout: float = 60) -> subprocess.CompletedProcess[str]:
    """Запускает процесс API и ждёт его завершения (он не должен стартовать)."""
    args = ["run", "--rm", "--network", NETWORK]
    for key, value in env.items():
        args += ["-e", f"{key}={value}"]
    try:
        return _docker(*args, API_IMAGE, timeout=timeout)
    except subprocess.TimeoutExpired:
        pytest.fail(
            f"процесс API не завершился за {timeout} с — он стартовал вопреки неверной конфигурации",
            pytrace=False,
        )


def _output(res: subprocess.CompletedProcess[str]) -> str:
    return res.stdout + res.stderr


class Detached:
    """Процесс API, запущенный в фоне отдельным контейнером."""

    def __init__(self, env: dict[str, str]) -> None:
        self.name = "qa-api-" + uuid.uuid4().hex[:10]
        args = ["run", "-d", "--name", self.name, "--network", NETWORK]
        for key, value in env.items():
            args += ["-e", f"{key}={value}"]
        res = _docker(*args, API_IMAGE)
        assert res.returncode == 0, res.stderr

    def health(self) -> int | None:
        """Код ответа /api/health изнутри контейнера; None — порт не слушает."""
        res = _docker(
            "exec",
            self.name,
            "python",
            "-c",
            "import urllib.request as u,urllib.error as e\n"
            "try: print(u.urlopen('http://127.0.0.1:8000/api/health',timeout=2).status)\n"
            "except e.HTTPError as x: print(x.code)\n"
            "except Exception: print('none')",
            timeout=20,
        )
        value = res.stdout.strip()
        return int(value) if value.isdigit() else None

    def running(self) -> bool:
        return _docker("inspect", "-f", "{{.State.Running}}", self.name).stdout.strip() == "true"

    def exit_code(self) -> int:
        return int(_docker("inspect", "-f", "{{.State.ExitCode}}", self.name).stdout.strip())

    def wait_healthy(self, timeout: float = 60) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if not self.running():
                pytest.fail(f"процесс API завершился:\n{self.logs()}", pytrace=False)
            if self.health() == 200:
                return
            time.sleep(1)
        pytest.fail(f"процесс API не стал готов за {timeout} с:\n{self.logs()}", pytrace=False)

    def logs(self) -> str:
        res = _docker("logs", self.name)
        return res.stdout + res.stderr

    def remove(self) -> None:
        _docker("rm", "-f", self.name)


@pytest.fixture
def detached() -> Iterator[list[Detached]]:
    started: list[Detached] = []
    yield started
    for proc in started:
        proc.remove()


# --- ARCH-CFG: обязательные переменные --------------------------------------


@needs_docker
@pytest.mark.parametrize("missing", REQUIRED)
def test_arch_cfg01_missing_required_variable_stops_process(
    stack_env: dict[str, str], missing: str
) -> None:
    env = {k: v for k, v in stack_env.items() if k != missing}
    res = _run_once(env)
    assert res.returncode != 0, f"процесс без {missing} завершился с кодом 0:\n{_output(res)}"
    assert missing in _output(res), f"вывод не называет {missing}:\n{_output(res)}"


@needs_docker
def test_arch_cfg02_full_configuration_starts(
    stack_env: dict[str, str], fresh_database: str, detached: list[Detached]
) -> None:
    proc = Detached({**stack_env, "DATABASE_URL": fresh_database})
    detached.append(proc)
    proc.wait_healthy()


def test_arch_cfg02_stack_api_answers_through_caddy(client: Client) -> None:
    resp = client.http.get("/api/openapi.json")
    assert resp.status_code == 200


@needs_docker
def test_arch_cfg03_two_missing_variables_named(stack_env: dict[str, str]) -> None:
    env = {k: v for k, v in stack_env.items() if k not in {"SECRET_KEY", "MEDIA_ROOT"}}
    res = _run_once(env)
    out = _output(res)
    assert res.returncode != 0
    assert "SECRET_KEY" in out and "MEDIA_ROOT" in out, out


@needs_docker
@pytest.mark.parametrize("empty", REQUIRED)
def test_arch_cfg04_empty_required_variable_stops_process(
    stack_env: dict[str, str], empty: str
) -> None:
    res = _run_once({**stack_env, empty: ""})
    assert res.returncode != 0, f"пустой {empty} принят:\n{_output(res)}"
    assert empty in _output(res), _output(res)


@needs_docker
def test_arch_cfg05_non_integer_max_upload_bytes_stops_process(
    stack_env: dict[str, str],
) -> None:
    res = _run_once({**stack_env, "MAX_UPLOAD_BYTES": "abc"})
    assert res.returncode != 0
    assert "MAX_UPLOAD_BYTES" in _output(res), _output(res)


@needs_docker
@pytest.mark.parametrize("missing", ["PUBLIC_BASE_URL", "MEDIA_ROOT", "MAX_UPLOAD_BYTES"])
def test_arch_cfg06_error_does_not_print_secrets(stack_env: dict[str, str], missing: str) -> None:
    env = {k: v for k, v in stack_env.items() if k != missing}
    out = _output(_run_once(env))
    db_password = re.search(r"://[^:/@]+:([^@]+)@", stack_env["DATABASE_URL"])
    assert SECRET_VALUE not in out
    assert ADMIN_PASSWORD_VALUE not in out
    if db_password:
        assert db_password.group(1) not in out


# --- ARCH-MIG: миграции до приёма трафика -----------------------------------


def test_arch_mig01_stack_database_has_alembic_revision(client: Client) -> None:
    rows = _psql("SELECT version_num FROM alembic_version").splitlines()
    assert len(rows) == 1 and rows[0], rows
    assert client.http.get("/api/health").status_code == 200


@needs_docker
def test_arch_mig01_02_empty_database_migrated_before_traffic(
    stack_env: dict[str, str], fresh_database: str, detached: list[Detached]
) -> None:
    db = fresh_database.rsplit("/", 1)[1]
    assert _psql("SELECT to_regclass('public.alembic_version') IS NULL", db) == "t"
    proc = Detached({**stack_env, "DATABASE_URL": fresh_database})
    detached.append(proc)
    proc.wait_healthy()
    rows = _psql("SELECT version_num FROM alembic_version", db).splitlines()
    assert len(rows) == 1 and rows[0], rows
    logs = proc.logs()
    upgrade = logs.find("Running upgrade")
    serving = logs.find("Uvicorn running on")
    assert upgrade != -1, f"в логе нет применения миграций:\n{logs}"
    assert serving != -1, f"в логе нет начала приёма соединений:\n{logs}"
    assert upgrade < serving, f"порт открыт до миграций:\n{logs}"


@needs_docker
def test_arch_mig03_restart_on_migrated_database(
    stack_env: dict[str, str], fresh_database: str, detached: list[Detached]
) -> None:
    db = fresh_database.rsplit("/", 1)[1]
    proc = Detached({**stack_env, "DATABASE_URL": fresh_database})
    detached.append(proc)
    proc.wait_healthy()
    before = _psql("SELECT version_num FROM alembic_version", db)
    tables_before = _psql("SELECT count(*) FROM pg_tables WHERE schemaname='public'", db)
    assert _docker("restart", proc.name).returncode == 0
    proc.wait_healthy()
    runs = proc.logs().split("Started server process")
    assert len(runs) >= 3, "перезапуск не виден в логе"
    after_logs = runs[-1]
    assert "Traceback" not in after_logs, after_logs
    assert "Running upgrade" not in after_logs, after_logs
    assert _psql("SELECT version_num FROM alembic_version", db) == before
    assert _psql("SELECT count(*) FROM pg_tables WHERE schemaname='public'", db) == tables_before


@needs_docker
def test_arch_mig04_unreachable_database_does_not_accept_traffic(
    stack_env: dict[str, str], detached: list[Detached]
) -> None:
    url = re.sub(r"@[^/]+/", "@qa-no-such-host:5432/", stack_env["DATABASE_URL"])
    proc = Detached({**stack_env, "DATABASE_URL": url})
    detached.append(proc)
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if not proc.running():
            assert proc.exit_code() != 0, proc.logs()
            return
        assert proc.health() != 200, f"API обслуживает запросы без базы:\n{proc.logs()}"
        time.sleep(1)
    # Процесс жив, но так и не начал отвечать 200 — трафик не принимается.
    assert proc.health() != 200


# --- ARCH-OAS: OpenAPI -------------------------------------------------------


def test_arch_oas01_openapi_published(client: Client) -> None:
    resp = client.http.get("/api/openapi.json")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    doc = resp.json()
    assert str(doc.get("openapi", "")).startswith("3."), doc.get("openapi")
    assert doc["info"]["title"] and doc["info"]["version"]
    assert isinstance(doc.get("paths"), dict)


def test_arch_oas02_paths_are_under_api(client: Client) -> None:
    doc = client.http.get("/api/openapi.json").json()
    servers = [s.get("url", "") for s in doc.get("servers", [])]
    prefixed_by_server = any(url.rstrip("/").endswith("/api") for url in servers)
    for path in doc["paths"]:
        assert prefixed_by_server or path.startswith("/api/"), path


@pytest.mark.parametrize("method,path", [("GET", "/api/openapi.json?x=1"), ("HEAD", "/api/openapi.json")])
def test_arch_oas03_openapi_variants(client: Client, method: str, path: str) -> None:
    resp = client.http.request(method, path)
    assert resp.status_code == 200, resp.status_code
    assert resp.headers["content-type"].startswith("application/json")
    if method == "GET":
        assert "<html" not in resp.text.lower()
        assert "paths" in resp.json()


def test_arch_oas04_unknown_api_path_is_fastapi_404(client: Client) -> None:
    resp = client.http.get("/api/qa-" + uuid.uuid4().hex)
    assert resp.status_code == 404
    assert resp.headers["content-type"].startswith("application/json")
    assert "detail" in resp.json()


def test_arch_oas05_schema_has_no_localhost(client: Client) -> None:
    text = client.http.get("/api/openapi.json").text
    for needle in ("localhost", "127.0.0.1", "0.0.0.0", "[::1]"):
        assert needle not in text, needle
