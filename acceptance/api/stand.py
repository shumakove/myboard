"""Общие средства приёмочного стенда QA (Q0.1).

Стенд работает только через публичные интерфейсы — HTTP и WebSocket — и
ничего не импортирует из `apps/`. Базовый адрес берётся из PUBLIC_BASE_URL.
"""

from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from urllib.parse import urlsplit, urlunsplit

import httpx
from websockets.sync.client import ClientConnection, connect

_FORBIDDEN_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


class StandConfigError(RuntimeError):
    """Стенд настроен неверно: прогон не имеет смысла."""


def public_base_url() -> str:
    """Базовый адрес стека из PUBLIC_BASE_URL, без завершающего `/`.

    `localhost` запрещён: доску открывают по адресу машины в сети (ARCHITECTURE.md, 11).
    """
    raw = os.environ.get("PUBLIC_BASE_URL", "").strip()
    if not raw:
        raise StandConfigError(
            "PUBLIC_BASE_URL не задан. Пример: PUBLIC_BASE_URL=http://192.168.1.20 uv run pytest"
        )
    parts = urlsplit(raw)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise StandConfigError(f"PUBLIC_BASE_URL должен быть http(s)://<хост>[:порт], получено: {raw!r}")
    if parts.hostname in _FORBIDDEN_HOSTS:
        raise StandConfigError(
            f"PUBLIC_BASE_URL={raw!r}: localhost не используется, укажите IP машины в локальной сети"
        )
    return raw.rstrip("/")


def ws_url(base_url: str, path: str = "/api/ws") -> str:
    """Адрес WebSocket, собранный из базового адреса (http → ws, https → wss)."""
    parts = urlsplit(base_url)
    scheme = "wss" if parts.scheme == "https" else "ws"
    return urlunsplit((scheme, parts.netloc, path, "", ""))


def pending(fixture: str, task: str) -> None:
    """Заготовка фикстуры, для которой в продукте ещё нет публичного API.

    Падает (а не пропускает тест), чтобы тест на заготовке не выглядел зелёным.
    """
    import pytest

    pytest.fail(
        f"Фикстура «{fixture}» — заготовка стенда Q0.1: появится после {task}, "
        "когда станет известен публичный API из handoff задачи.",
        pytrace=False,
    )


@dataclass
class Client:
    """Независимый клиент: своё хранилище cookie для HTTP и WebSocket."""

    name: str
    base_url: str
    http: httpx.Client = field(init=False)

    def __post_init__(self) -> None:
        self.http = httpx.Client(base_url=self.base_url, follow_redirects=False, timeout=10.0)

    def cookie_header(self) -> str:
        return "; ".join(f"{c.name}={c.value}" for c in self.http.cookies.jar)

    @contextmanager
    def websocket(self, path: str = "/api/ws") -> Iterator[ClientConnection]:
        """WebSocket с cookie этого клиента и Origin страницы (как у браузера)."""
        headers = {"Origin": self.base_url}
        cookie = self.cookie_header()
        if cookie:
            headers["Cookie"] = cookie
        with connect(ws_url(self.base_url, path), additional_headers=headers, open_timeout=10) as ws:
            yield ws

    def close(self) -> None:
        self.http.close()


@contextmanager
def clients(base_url: str, *names: str) -> Iterator[tuple[Client, ...]]:
    """Несколько независимых клиентов (для COL-*, SHR-04, realtime)."""
    made = tuple(Client(name, base_url) for name in names)
    try:
        yield made
    finally:
        for client in made:
            client.close()
