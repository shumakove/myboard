"""Канал доски при сбое записи в журнал и при участнике, переставшем читать (COL-01).

Расследование docs/qa/reports/flaky-sync.md. Оба теста падают на текущем коде: BUG-038, BUG-039.
Первый останавливает postgres проекта QA_COMPOSE_PROJECT, поэтому параллельно с другими тестами не запускается.
"""

from __future__ import annotations

import base64
import os
import socket
import time
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import urlsplit

import pytest
from pycrdt import Doc, Map

from history_helpers import container, docker, wait_api_ready
from stand import Client
from sync_helpers import UPDATE, SyncPeer, channel_path, frame


def _set(key: str):
    return lambda doc: doc.get("objects", type=Map).__setitem__(key, 1)


def _has(key: str):
    return lambda peer: key in peer.snapshot()


@contextmanager
def _postgres_down() -> Iterator[None]:
    name = container("postgres")
    assert docker("stop", name).returncode == 0
    try:
        yield
    finally:
        assert docker("start", name).returncode == 0
        for _ in range(60):
            if docker("exec", name, "pg_isready").returncode == 0:
                break
            time.sleep(1)


@pytest.mark.xfail(strict=True, reason="BUG-038: правка, не записанная в журнал, не рассылается и позже")
def test_col01_bug038_edit_during_journal_failure_reaches_open_client(board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    path = channel_path(board=board["id"])
    with board_user.websocket(path) as wa, board_user.websocket(path) as wb:
        author_doc = Doc()
        author, other = SyncPeer(wa, author_doc), SyncPeer(wb)
        author.sync()
        other.sync()
        author.edit(_set("before"))
        other.wait_for(_has("before"))
        with _postgres_down():
            time.sleep(1)
            author.edit(_set("during"))
            author.close_code(timeout=40)
        wait_api_ready(clean_stack)
        time.sleep(3)
        # Автор подключается заново тем же документом, как это делает клиент после разрыва.
        with board_user.websocket(path) as wa2:
            again = SyncPeer(wa2, author_doc)
            again.sync(timeout=30)
            again.pump(2)
            # Соединение второго клиента не рвалось: правка должна дойти до него.
            other.wait_for(_has("during"), timeout=15)


def _stalled_socket(client: Client, base_url: str, path: str) -> socket.socket:
    """Открывает канал и больше ничего не читает: как участник за застрявшей сетью."""
    url = urlsplit(base_url)
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)
    sock.connect((url.hostname, url.port or 80))
    key = base64.b64encode(os.urandom(16)).decode()
    sock.sendall(
        (
            f"GET {path} HTTP/1.1\r\nHost: {url.netloc}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nOrigin: {base_url}\r\n"
            f"Cookie: {client.cookie_header()}\r\n\r\n"
        ).encode()
    )
    head = b""
    while b"\r\n\r\n" not in head:
        head += sock.recv(1)
    assert b" 101 " in head.split(b"\r\n")[0], head
    return sock


def _large_update(key: str, kilobytes: int = 256) -> bytes:
    doc = Doc()
    with doc.transaction():
        # Случайное значение: сжатие в канале не уменьшает кадр.
        doc.get("objects", type=Map)[key] = base64.b64encode(os.urandom(kilobytes * 768)).decode()
    return doc.get_update()


@pytest.mark.xfail(strict=True, reason="BUG-039: участник, переставший читать, останавливает всю доску")
def test_col01_bug039_peer_that_stopped_reading_does_not_freeze_board(board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    path = channel_path(board=board["id"])
    with board_user.websocket(path) as wa, board_user.websocket(path) as wb:
        author, other = SyncPeer(wa), SyncPeer(wb)
        author.sync()
        other.sync()
        stalled = _stalled_socket(board_user, clean_stack, path)
        try:
            for i in range(160):  # 40 МБ: заведомо больше буферов на пути к застрявшему сокету
                key = f"big{i}"
                wa.send(frame(UPDATE, _large_update(key)))
                other.wait_for(_has(key), timeout=15)
        finally:
            stalled.close()
