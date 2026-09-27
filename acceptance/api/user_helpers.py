"""Средства приёмки входа пользователя досок (T1.2).

Публичный API из handoff T1.2: `POST /api/login`, `POST /api/logout`, `GET /api/session`,
cookie `myboard_session`.

Ограничение частоты входа на стенде общее для всех клиентов (Docker Desktop показывает
API один адрес шлюза), поэтому вспомогательный вход при `429`, вызванном чужими неудачными
попытками, ждёт `Retry-After` и повторяет. Само ограничение проверяет отдельный тест.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from stand import Client

SESSION_COOKIE = "myboard_session"


def raw_login(client: Client, email: str, password: str) -> httpx.Response:
    return client.http.post("/api/login", json={"email": email, "password": password})


def user_login(client: Client, email: str, password: str) -> httpx.Response:
    """Вход пользователя досок; `429` от общего лимита стенда пережидается."""
    for _ in range(3):
        resp = raw_login(client, email, password)
        if resp.status_code != 429:
            return resp
        time.sleep(int(resp.headers.get("retry-after", "60")) + 1)
    return resp


def logout(client: Client) -> httpx.Response:
    return client.http.post("/api/logout")


def session(client: Client) -> dict[str, Any]:
    resp = client.http.get("/api/session")
    assert resp.status_code in (200, 401), (resp.status_code, resp.text)
    if resp.status_code == 401:
        return {"authenticated": False}
    return resp.json()


def is_signed_in(client: Client) -> bool:
    return session(client).get("authenticated") is True


def session_cookie_headers(resp: httpx.Response) -> list[str]:
    return [h for h in resp.headers.get_list("set-cookie") if h.lower().startswith(SESSION_COOKIE + "=")]


def gives_session(resp: httpx.Response) -> bool:
    """Ответ выдаёт непустую cookie сессии пользователя."""
    for header in session_cookie_headers(resp):
        value = header.split(";", 1)[0].split("=", 1)[1].strip().strip('"')
        if value and "max-age=0" not in header.lower():
            return True
    return False


def with_cookie(base_url: str, name: str, value: str) -> Client:
    other = Client(name, base_url)
    other.http.cookies.set(SESSION_COOKIE, value)
    return other
