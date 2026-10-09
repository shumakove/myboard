"""Средства приёмки списка досок (T2.1).

Публичный API из handoff T2.1: `GET /api/boards` (`q`, `sort`, `modified_since`),
`GET /api/boards/recent`, `POST /api/boards`, `GET|PATCH|DELETE /api/boards/{id}`.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from datetime import datetime
from typing import Any

import httpx

from stand import Client


def unique_title(prefix: str = "QA board") -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def create_board(client: Client, title: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {} if title is None else {"title": title}
    resp = client.http.post("/api/boards", json=body)
    assert resp.status_code in (200, 201), (resp.status_code, resp.text)
    board = resp.json()
    assert board.get("id"), board
    return board


def list_boards(client: Client, **params: Any) -> list[dict[str, Any]]:
    resp = client.http.get("/api/boards", params=params)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    boards = resp.json()
    assert isinstance(boards, list), boards
    return boards


def recent_boards(client: Client) -> list[dict[str, Any]]:
    resp = client.http.get("/api/boards/recent")
    assert resp.status_code == 200, (resp.status_code, resp.text)
    boards = resp.json()
    assert isinstance(boards, list), boards
    return boards


def ids(boards: list[dict[str, Any]]) -> list[str]:
    return [b["id"] for b in boards]


def get_board(client: Client, board_id: str) -> httpx.Response:
    return client.http.get(f"/api/boards/{board_id}")


def rename_board(client: Client, board_id: str, title: Any) -> httpx.Response:
    return client.http.patch(f"/api/boards/{board_id}", json={"title": title})


def delete_board(client: Client, board_id: str) -> httpx.Response:
    return client.http.delete(f"/api/boards/{board_id}")


def ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def age_board(board_id: str, days: int) -> None:
    """Подготовка данных (способ из handoff T2.1): сдвинуть дату изменения доски в прошлое.

    Правок содержимого, двигающих `updated_at`, до T4.1 нет; иначе «старую» доску
    для фильтра по дате изменения не получить.
    """
    uuid.UUID(board_id)
    sql = f"UPDATE boards SET updated_at = now() - interval '{int(days)} days' WHERE id = '{board_id}'"
    subprocess.run(
        ["docker", "exec", f"{os.environ.get('QA_COMPOSE_PROJECT') or 'myboard-qa'}-postgres-1", "psql", "-U", "myboard", "-d", "myboard", "-c", sql],
        check=True,
        capture_output=True,
    )
