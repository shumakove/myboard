"""Средства приёмки журнала, снимков и корзины (T4.3, основа COL-07, COL-08).

Интерфейса истории до T8.2 нет, поэтому таблицы `board_updates`, `board_snapshots`,
`board_events` (ARCHITECTURE.md 7) читаются SQL-запросами только на чтение к сервису
`postgres` стека QA — так же, как предлагает handoff T4.3. Перезапуск `api` — через Docker CLI.
Формат записи корзины — ARCHITECTURE.md 6 и handoff T4.3:
`trash[id] = { object, deletedAt, deletedBy }`, перенос — одной транзакцией Yjs.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import time
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from pycrdt import Doc, Map, Text

PROJECT = os.environ.get("QA_COMPOSE_PROJECT", "myboard-qa")


def docker(*args: str, timeout: float = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout, check=False)


def container(service: str) -> str:
    out = docker(
        "ps",
        "-aq",
        "--filter",
        f"label=com.docker.compose.project={PROJECT}",
        "--filter",
        f"label=com.docker.compose.service={service}",
    ).stdout.strip()
    if not out:
        pytest.fail(f"Контейнер {service} проекта {PROJECT} не найден", pytrace=False)
    return out.splitlines()[0]


def container_env(name: str) -> dict[str, str]:
    out = docker("inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", name).stdout
    return dict(line.split("=", 1) for line in out.splitlines() if "=" in line)


def psql(sql: str) -> str:
    pg = container("postgres")
    env = container_env(pg)
    res = docker("exec", pg, "psql", "-U", env["POSTGRES_USER"], "-d", env["POSTGRES_DB"], "-tAc", sql)
    assert res.returncode == 0, res.stderr
    return res.stdout.strip()


def _board_id(board_id: str) -> str:
    return str(uuid.UUID(board_id))


def update_seqs(board_id: str) -> list[int]:
    out = psql(f"SELECT seq FROM board_updates WHERE board_id = '{_board_id(board_id)}' ORDER BY seq")
    return [int(x) for x in out.splitlines() if x]


def update_blobs(board_id: str) -> list[bytes]:
    out = psql(
        "SELECT translate(encode(update, 'base64'), E'\\n', '') FROM board_updates "
        f"WHERE board_id = '{_board_id(board_id)}' ORDER BY seq"
    )
    return [base64.b64decode(x) for x in out.splitlines() if x]


def snapshots(board_id: str) -> list[dict[str, Any]]:
    """Снимки доски по возрастанию времени: id, created_at, state (байты)."""
    out = psql(
        "SELECT coalesce(json_agg(json_build_object('id', id, 'created_at', created_at, "
        "'state', translate(encode(state, 'base64'), E'\\n', '')) ORDER BY created_at, id), '[]') "
        f"FROM board_snapshots WHERE board_id = '{_board_id(board_id)}'"
    )
    rows = json.loads(out)
    for row in rows:
        row["state"] = base64.b64decode(row["state"])
    return rows


def events(board_id: str) -> list[dict[str, Any]]:
    out = psql(
        "SELECT coalesce(json_agg(json_build_object('actor_name', actor_name, 'event_type', event_type, "
        "'payload', payload, 'created_at', created_at) ORDER BY created_at, id), '[]') "
        f"FROM board_events WHERE board_id = '{_board_id(board_id)}'"
    )
    return list(json.loads(out))


def snapshot_interval() -> float:
    """Период фонового снимка стека QA (`SNAPSHOT_INTERVAL_SECONDS`, по умолчанию 300)."""
    return float(container_env(container("api")).get("SNAPSHOT_INTERVAL_SECONDS", "300"))


def eventually(check: Callable[[], bool], timeout: float, message: str) -> None:
    deadline = time.monotonic() + timeout
    while not check():
        assert time.monotonic() < deadline, message
        time.sleep(0.3)


def doc_from(state: bytes) -> Doc:
    doc = Doc()
    doc.apply_update(state)
    return doc


def content(doc: Doc) -> dict[str, Any]:
    """Содержимое `objects` и `trash` документа в виде Python-структур."""
    return {
        "objects": doc.get("objects", type=Map).to_py() or {},
        "trash": doc.get("trash", type=Map).to_py() or {},
    }


# --- документ: объекты и корзина -------------------------------------------------------


def sticker(oid: str, text: str, **fields: Any) -> Callable[[Doc], None]:
    def change(doc: Doc) -> None:
        doc.get("objects", type=Map)[oid] = Map({"type": "sticker", "x": 10.0, "y": 20.0, "z": 1, **fields, "text": Text(text)})

    return change


def _clone(value: Any) -> Any:
    if isinstance(value, Text):
        return Text(str(value))
    if isinstance(value, Map):
        return Map({k: _clone(v) for k, v in value.items()})
    return value


def move_to_trash(ids: list[str], deleted_by: str) -> Callable[[Doc], None]:
    """Перенос в корзину одной транзакцией — формат клиента `apps/web` из handoff T4.3."""

    def change(doc: Doc) -> None:
        objects = doc.get("objects", type=Map)
        trash = doc.get("trash", type=Map)
        now = datetime.now(UTC).isoformat()
        for oid in ids:
            if oid not in objects:
                continue
            copy = _clone(objects[oid])
            del objects[oid]
            trash[oid] = Map({"object": copy, "deletedAt": now, "deletedBy": deleted_by})

    return change


# --- перезапуск api ----------------------------------------------------------------------


def wait_api_ready(base_url: str, timeout: float = 90) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if httpx.get(base_url + "/api/health", timeout=3).status_code == 200:
                return
        except httpx.HTTPError:
            pass
        time.sleep(1)
    pytest.fail(f"api не ответил за {timeout} с после перезапуска", pytrace=False)


def restart_api(base_url: str) -> None:
    res = docker("restart", container("api"))
    assert res.returncode == 0, res.stderr
    wait_api_ready(base_url)


def crash_api(base_url: str) -> None:
    """Аварийная остановка (SIGKILL, без корректного завершения процесса) и запуск."""
    name = container("api")
    res = docker("kill", "-s", "KILL", name)
    assert res.returncode == 0, res.stderr
    res = docker("start", name)
    assert res.returncode == 0, res.stderr
    wait_api_ready(base_url)
