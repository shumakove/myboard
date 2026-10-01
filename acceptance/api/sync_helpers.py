"""Независимый клиент канала доски (T4.1): WebSocket `/api/ws` + документ Yjs (`pycrdt`).

Публичный протокол из ARCHITECTURE.md 10 и handoff T4.1: двоичные кадры y-protocols
`varuint тип | varuint подтип | varuint длина | байты`, тип `sync = 0`, подтипы
`0 STEP1` (вектор версии), `1 STEP2` (недостающие обновления), `2 UPDATE`.
Адрес канала: `/api/ws?board={id}` (сессия владельца) или `/api/ws?token={token}` (участник).
Код из `apps/` не импортируется: кадры собираются здесь.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

from pycrdt import Doc, Map
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import ClientConnection

from stand import Client

SYNC = 0
STEP1, STEP2, UPDATE = 0, 1, 2
DOC_ROOTS = ("objects", "trash", "comments", "timer", "votes")


def varuint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def read_varuint(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if byte < 0x80:
            return result, pos
        shift += 7


def frame(sub: int, payload: bytes, msg_type: int = SYNC) -> bytes:
    return varuint(msg_type) + varuint(sub) + varuint(len(payload)) + payload


def parse(data: bytes) -> tuple[int, int, bytes]:
    msg_type, pos = read_varuint(data, 0)
    sub, pos = read_varuint(data, pos)
    length, pos = read_varuint(data, pos)
    payload = data[pos : pos + length]
    assert len(payload) == length and pos + length == len(data), f"кадр сервера разобран не полностью: {data!r}"
    return msg_type, sub, payload


def channel_path(*, board: str | None = None, token: str | None = None) -> str:
    if board is not None:
        return f"/api/ws?board={board}"
    return f"/api/ws?token={token}"


def handshake_status(client: Client, path: str) -> int:
    """Код ответа на рукопожатие: 101 — канал открыт, иначе HTTP-код отказа."""
    try:
        with client.websocket(path):
            return 101
    except InvalidStatus as exc:
        return exc.response.status_code


def handshake_refusal(client: Client, path: str) -> tuple[int, bytes]:
    """Отказ рукопожатия (код и тело) — для сравнения неразличимости."""
    try:
        with client.websocket(path):
            raise AssertionError(f"канал {path} открылся у {client.name}")
    except InvalidStatus as exc:
        return exc.response.status_code, exc.response.body or b""


class SyncPeer:
    """Клиент канала доски со своим документом Yjs."""

    def __init__(self, ws: ClientConnection, doc: Doc | None = None) -> None:
        self.ws = ws
        self.doc = doc if doc is not None else Doc()
        self.received: list[tuple[int, int, bytes]] = []

    # --- документ ---------------------------------------------------------------

    @property
    def objects(self) -> Map:
        return self.doc.get("objects", type=Map)

    def snapshot(self) -> dict[str, Any]:
        return self.objects.to_py() or {}

    def state(self) -> bytes:
        return self.doc.get_state()

    # --- протокол ----------------------------------------------------------------

    def send_raw(self, data: bytes | str) -> None:
        self.ws.send(data)

    def sync(self, timeout: float = 5.0) -> None:
        """Рукопожатие: свой STEP1, ответ STEP2 на STEP1 сервера, ждать STEP2 сервера."""
        self.ws.send(frame(STEP1, self.state()))
        got_step2 = False
        deadline = time.monotonic() + timeout
        while not got_step2:
            remaining = deadline - time.monotonic()
            assert remaining > 0, "сервер не прислал STEP2 на STEP1 клиента"
            sub = self._recv_one(remaining)
            got_step2 = sub == STEP2

    def _recv_one(self, timeout: float) -> int:
        data = self.ws.recv(timeout=timeout)
        assert isinstance(data, bytes), f"сервер прислал не двоичный кадр: {data!r}"
        msg_type, sub, payload = parse(data)
        self.received.append((msg_type, sub, payload))
        assert msg_type == SYNC, f"неожиданный тип сообщения {msg_type}"
        if sub == STEP1:
            self.ws.send(frame(STEP2, self.doc.get_update(payload)))
        elif sub in (STEP2, UPDATE):
            self.doc.apply_update(payload)
        else:
            raise AssertionError(f"неизвестный подтип sync {sub}")
        return sub

    def pump(self, duration: float = 0.7) -> int:
        """Принимать кадры `duration` секунд; вернуть число принятых."""
        count = 0
        deadline = time.monotonic() + duration
        while (remaining := deadline - time.monotonic()) > 0:
            try:
                self._recv_one(remaining)
            except TimeoutError:
                break
            count += 1
        return count

    def wait_for(self, predicate: Callable[[SyncPeer], bool], timeout: float = 5.0) -> None:
        deadline = time.monotonic() + timeout
        while not predicate(self):
            remaining = deadline - time.monotonic()
            assert remaining > 0, f"не дождались состояния, документ: {self.snapshot()}"
            try:
                self._recv_one(remaining)
            except TimeoutError:
                pass

    def edit(self, change: Callable[[Doc], None], *, send: bool = True) -> bytes:
        """Локальная правка; вернуть её обновление и (по умолчанию) отправить как UPDATE."""
        before = self.state()
        with self.doc.transaction():
            change(self.doc)
        update = self.doc.get_update(before)
        if send:
            self.ws.send(frame(UPDATE, update))
        return update

    def close_code(self, timeout: float = 5.0) -> int | None:
        """Дождаться закрытия соединения сервером и вернуть код закрытия."""
        deadline = time.monotonic() + timeout
        while (remaining := deadline - time.monotonic()) > 0:
            try:
                self.ws.recv(timeout=remaining)
            except TimeoutError:
                break
            except ConnectionClosed as exc:
                return exc.rcvd.code if exc.rcvd else None
        raise AssertionError("сервер не закрыл соединение")

    def is_open(self) -> bool:
        try:
            self.ws.ping().wait(3)
            return True
        except Exception:  # noqa: BLE001
            return False


@contextmanager
def peer(client: Client, path: str, *, doc: Doc | None = None, synced: bool = True) -> Iterator[SyncPeer]:
    with client.websocket(path) as ws:
        p = SyncPeer(ws, doc)
        if synced:
            p.sync()
        yield p


def objects_of(doc: Doc) -> Map:
    return doc.get("objects", type=Map)
