"""Средства приёмки панели администратора (T1.1): учётные данные и вызовы API.

Публичный API панели — из handoff T1.1: `POST /api/admin/login`, `POST /api/admin/logout`,
`GET /api/admin/session`, `GET|POST /api/admin/users`, `PATCH /api/admin/users/{id}`.
Учётные данные администратора — из ADMIN_EMAIL/ADMIN_PASSWORD окружения прогона,
а если их нет — из `deploy/compose/.env` (с ним поднят стек QA).
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

import httpx

from stand import Client

ADMIN_COOKIE = "myboard_admin"
_ENV_FILE = Path(__file__).resolve().parents[2] / "deploy" / "compose" / ".env"


def _env_file_values() -> dict[str, str]:
    if not _ENV_FILE.exists():
        return {}
    values: dict[str, str] = {}
    for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip()
    return values


def admin_credentials() -> tuple[str, str]:
    """Почта и пароль первого администратора, с которыми поднят стек."""
    file_values = _env_file_values()
    email = os.environ.get("ADMIN_EMAIL") or file_values.get("ADMIN_EMAIL", "")
    password = os.environ.get("ADMIN_PASSWORD") or file_values.get("ADMIN_PASSWORD", "")
    if not email or not password:
        raise RuntimeError("Нет ADMIN_EMAIL/ADMIN_PASSWORD ни в окружении, ни в deploy/compose/.env")
    return email, password


def login(client: Client, email: str, password: str) -> httpx.Response:
    return client.http.post("/api/admin/login", json={"email": email, "password": password})


def unique_email(prefix: str = "user") -> str:
    return f"qa-{prefix}-{uuid.uuid4().hex[:10]}@example.com"


def new_user_payload(**overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": "QA User " + uuid.uuid4().hex[:6],
        "email": unique_email(),
        "password": "pw-" + uuid.uuid4().hex,
    }
    payload.update(overrides)
    return payload


def create_user(admin: Client, **overrides: Any) -> dict[str, Any]:
    payload = new_user_payload(**overrides)
    resp = admin.http.post("/api/admin/users", json=payload)
    assert resp.status_code == 201, (resp.status_code, resp.text)
    body = resp.json()
    body["_password"] = payload["password"]
    return body


def list_users(admin: Client) -> list[dict[str, Any]]:
    resp = admin.http.get("/api/admin/users")
    assert resp.status_code == 200, (resp.status_code, resp.text)
    users = resp.json()
    assert isinstance(users, list), users
    return users


def find_user(admin: Client, user_id: str) -> dict[str, Any] | None:
    return next((u for u in list_users(admin) if u["id"] == user_id), None)


def users_with_email(admin: Client, email: str) -> list[dict[str, Any]]:
    wanted = email.strip().lower()
    return [u for u in list_users(admin) if str(u["email"]).strip().lower() == wanted]


def patch_user(client: Client, user_id: str, **fields: Any) -> httpx.Response:
    return client.http.patch(f"/api/admin/users/{user_id}", json=fields)
