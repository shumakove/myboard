"""Средства приёмки модуля media (T7.1).

Публичный API из handoff T7.1: `POST /api/boards/{board_id}/media?name=<имя>` — тело запроса
сам файл, `Content-Type` — объявленный тип; `GET /api/media/{id}`.
"""

from __future__ import annotations

import os
import struct
import zlib
from typing import Any

import httpx

from admin_helpers import _env_file_values
from stand import Client


def max_upload_bytes() -> int:
    """MAX_UPLOAD_BYTES, с которым поднят стек QA (окружение прогона или deploy/compose/.env)."""
    raw = os.environ.get("MAX_UPLOAD_BYTES") or _env_file_values().get("MAX_UPLOAD_BYTES", "")
    assert raw.isdigit(), "MAX_UPLOAD_BYTES не задан ни в окружении, ни в deploy/compose/.env"
    return int(raw)


def png(width: int = 4, height: int = 3, rgba: tuple[int, int, int, int] = (200, 30, 30, 255)) -> bytes:
    """Минимальный корректный PNG однотонного цвета."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b"\x00" + bytes(rgba) * width
    raw = row * height
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def padded_png(size: int) -> bytes:
    """PNG ровно `size` байт: корректная картинка плюс хвост нулей после IEND."""
    base = png()
    assert size >= len(base)
    return base + b"\x00" * (size - len(base))


SVG_WITH_SCRIPT = (
    b'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" onload="document.title=\'pwned-onload\'">'
    b'<rect width="40" height="40" fill="green"/>'
    b"<script>document.title='pwned-script';fetch('/api/session')</script>"
    b"</svg>"
)

HTML_PAYLOAD = b"<!doctype html><html><body><script>document.title='pwned-html'</script>x</body></html>"


def upload(client: Client, board_id: str, data: bytes, mime: str | None = "image/png", name: str = "qa.png") -> httpx.Response:
    headers = {} if mime is None else {"Content-Type": mime}
    return client.http.post(f"/api/boards/{board_id}/media", params={"name": name}, content=data, headers=headers, timeout=120.0)


def uploaded(client: Client, board_id: str, data: bytes, mime: str = "image/png", name: str = "qa.png") -> dict[str, Any]:
    resp = upload(client, board_id, data, mime, name)
    assert resp.status_code == 201, (resp.status_code, resp.text)
    body = resp.json()
    assert body.get("id") and body.get("url") == f"/api/media/{body['id']}", body
    return body


def fetch(client: Client, media_id: str) -> httpx.Response:
    return client.http.get(f"/api/media/{media_id}")


def refusal(resp: httpx.Response) -> tuple[int, str]:
    return resp.status_code, resp.text
