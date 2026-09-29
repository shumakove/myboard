"""Средства приёмки папок и избранного (T2.2).

Публичный API из handoff T2.2: `GET /api/folders` (`q`), `POST /api/folders`,
`PUT /api/folders/{id}/position`, `PUT|DELETE /api/folders/{id}/favorite`,
`PUT /api/boards/{id}/folder`, `PUT|DELETE /api/boards/{id}/favorite`.
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx

from stand import Client


def unique_folder(prefix: str = "QA folder") -> str:
    return f"{prefix} {uuid.uuid4().hex[:8]}"


def raw_create_folder(client: Client, title: Any, parent_id: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"title": title}
    if parent_id is not None:
        body["parent_id"] = parent_id
    return client.http.post("/api/folders", json=body)


def create_folder(client: Client, title: str | None = None, parent_id: str | None = None) -> dict[str, Any]:
    resp = raw_create_folder(client, title or unique_folder(), parent_id)
    assert resp.status_code in (200, 201), (resp.status_code, resp.text)
    folder = resp.json()
    assert folder.get("id"), folder
    return folder


def list_folders(client: Client, q: str | None = None) -> list[dict[str, Any]]:
    params = {} if q is None else {"q": q}
    resp = client.http.get("/api/folders", params=params)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    folders = resp.json()
    assert isinstance(folders, list), folders
    return folders


def folders_by_id(client: Client) -> dict[str, dict[str, Any]]:
    return {f["id"]: f for f in list_folders(client)}


def children_order(client: Client, parent_id: str | None) -> list[str]:
    """Id папок данного родителя в порядке `position`."""
    kids = [f for f in list_folders(client) if f["parent_id"] == parent_id]
    return [f["id"] for f in sorted(kids, key=lambda f: f["position"])]


def move_folder(client: Client, folder_id: str, parent_id: str | None, position: Any) -> httpx.Response:
    return client.http.put(
        f"/api/folders/{folder_id}/position", json={"parent_id": parent_id, "position": position}
    )


def move_board(client: Client, board_id: str, folder_id: str | None) -> httpx.Response:
    return client.http.put(f"/api/boards/{board_id}/folder", json={"folder_id": folder_id})


def favorite(client: Client, kind: str, target_id: str, on: bool = True) -> httpx.Response:
    path = f"/api/{kind}s/{target_id}/favorite"
    return client.http.put(path) if on else client.http.delete(path)


def board_by_id(client: Client, board_id: str) -> dict[str, Any]:
    resp = client.http.get(f"/api/boards/{board_id}")
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return resp.json()
