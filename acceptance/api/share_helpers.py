"""Средства приёмки ссылки на доску (T3.1).

Публичный API из handoff T3.1: `GET /api/boards/{id}/share`, `POST /api/boards/{id}/share/reset`,
`GET /api/share/{token}`, `POST /api/share/{token}/join {"name"}`; cookie участника — своя на доску.
"""

from __future__ import annotations

from typing import Any

import httpx

from stand import Client

GUEST_COOKIE_PREFIX = "myboard_board_"


def get_link(client: Client, board_id: str) -> httpx.Response:
    return client.http.get(f"/api/boards/{board_id}/share")


def link(client: Client, board_id: str) -> dict[str, Any]:
    resp = get_link(client, board_id)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    body = resp.json()
    assert body.get("token") and body.get("url"), body
    return body


def reset(client: Client, board_id: str) -> httpx.Response:
    return client.http.post(f"/api/boards/{board_id}/share/reset")


def shared(client: Client, token: str) -> httpx.Response:
    return client.http.get(f"/api/share/{token}")


def join(client: Client, token: str, name: Any) -> httpx.Response:
    return client.http.post(f"/api/share/{token}/join", json={"name": name})


def participant(client: Client, token: str) -> dict[str, Any] | None:
    resp = shared(client, token)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return resp.json().get("participant")


def guest_cookie_headers(resp: httpx.Response) -> list[str]:
    return [h for h in resp.headers.get_list("set-cookie") if h.lower().startswith(GUEST_COOKIE_PREFIX)]


def refusal(resp: httpx.Response) -> tuple[int, str]:
    """Отказ по ссылке в виде, по которому сравнивается неразличимость (код и тело)."""
    return resp.status_code, resp.text
