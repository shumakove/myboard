"""Приёмка T6.12 (повторная проверка BUG-027): заметка доски в корне `notes` глазами сервера.

Клиент создаёт текст заметки одним и тем же обновлением Yjs от служебного клиента 0
(узел `0:0` в корне `notes`, `Y.XmlFragment` — ARCHITECTURE.md 6). Обновление собирается здесь
так же, как его описывает handoff T6.12 (побайтно совпадает с `yjs`), и шлётся независимыми
клиентами `pycrdt` по `/api/ws`. Проверяется, что сервер принимает повтор одного и того же
обновления, не закрывает соединения, хранит заметку в снимке и журнале и отдаёт её после
перезапуска `api`, а другие корни документа не страдают (NTE-01, COL-01).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from pycrdt import Doc, Map, XmlFragment, XmlText

from history_helpers import content, doc_from, eventually, restart_api, snapshot_interval, snapshots, sticker, update_seqs
from share_helpers import join, link
from stand import Client, clients
from sync_helpers import UPDATE, channel_path, frame, peer

# служебное обновление «в корне notes есть текст заметки» (clientID 0)
NOTE_CREATE = bytes.fromhex("010100000701056e6f7465730600")


def _note_create_update() -> bytes:
    seed = Doc(client_id=0)
    seed.get("notes", type=XmlFragment).children.append(XmlText())
    return seed.get_update()


@pytest.fixture
def owner_path(board: dict[str, Any]) -> str:
    return channel_path(board=board["id"])


@pytest.fixture
def guest(board_user: Client, board: dict[str, Any], clean_stack: str) -> Iterator[Client]:
    token = link(board_user, board["id"])["token"]
    with clients(clean_stack, "guest") as (one,):
        resp = join(one, token, "QA Note " + uuid.uuid4().hex[:6])
        assert resp.status_code == 200, (resp.status_code, resp.text)
        one.token = token  # type: ignore[attr-defined]
        yield one


@pytest.fixture
def guest_path(guest: Client) -> str:
    return channel_path(token=guest.token)  # type: ignore[attr-defined]


def _pin(doc: Doc) -> None:
    """NTE-02: флаг «открывать всем» — атрибут текста заметки (handoff T6.12)."""
    _note_text(doc).attributes["openForAll"] = True


def _note_text(doc: Doc) -> XmlText:
    children = list(doc.get("notes", type=XmlFragment).children)
    assert len(children) == 1, f"в notes {len(children)} узлов: {[str(c) for c in children]}"
    return children[0]  # type: ignore[return-value]


def _late(client: Client, path: str) -> Doc:
    with peer(client, path) as late:
        late.pump(0.5)
        return late.doc


def test_nte01_note_create_update_matches_client_bytes() -> None:
    """Обновление, которое шлют тесты ниже, — то же, что собирает `yjs` с clientID 0."""
    assert _note_create_update() == NOTE_CREATE


def test_nte01_col01_same_note_create_update_from_two_peers_is_one_text_on_server(
    board_user: Client, guest: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("keep", "canvas object"))
        other.wait_for(lambda p: "keep" in p.snapshot())
        # оба «начинают пустую заметку» одновременно — одно и то же обновление дважды
        for p in (owner, other):
            p.doc.apply_update(NOTE_CREATE)
            p.send_raw(frame(UPDATE, NOTE_CREATE))
        owner.edit(lambda d: _note_text(d).insert(0, "OWNERWORD "))
        other.edit(lambda d: _note_text(d).insert(0, "GUESTWORD "))
        for p in (owner, other):
            p.wait_for(lambda q: "OWNERWORD" in str(_note_text(q.doc)) and "GUESTWORD" in str(_note_text(q.doc)))
        assert owner.is_open() and other.is_open(), "сервер закрыл соединение после повтора обновления"
        # повтор того же обновления ещё раз (третий участник/переподключение) — ничего не меняет
        other.send_raw(frame(UPDATE, NOTE_CREATE))
        owner.pump(0.5)
        assert other.is_open()
        expected = str(_note_text(owner.doc))
    late = _late(guest, guest_path)
    assert str(_note_text(late)) == expected
    assert content(late)["objects"]["keep"]["text"] == "canvas object"


def test_nte01_col01_note_from_service_client_survives_snapshot_journal_and_restart(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, clean_stack: str
) -> None:
    interval = snapshot_interval()
    if interval > 20:
        pytest.skip(f"SNAPSHOT_INTERVAL_SECONDS={interval}: поднимите стек QA с SNAPSHOT_INTERVAL_SECONDS=5")
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("a", "alpha"))
        for p in (owner, other):
            p.doc.apply_update(NOTE_CREATE)
            p.send_raw(frame(UPDATE, NOTE_CREATE))
        owner.edit(lambda d: _note_text(d).insert(0, "first "))
        other.edit(lambda d: _note_text(d).insert(0, "second "))
        owner.edit(_pin)
        other.wait_for(lambda q: "first" in str(_note_text(q.doc)) and _note_text(q.doc).attributes.get("openForAll") is True)
        owner.wait_for(lambda q: "second" in str(_note_text(q.doc)))
        # снимок снят и журнал отрезан, пока доска открыта
        eventually(
            lambda: len(snapshots(board["id"])) >= 1 and not update_seqs(board["id"]),
            3 * interval + 5,
            "журнал не сжат",
        )
        snap = doc_from(snapshots(board["id"])[-1]["state"])
        assert str(_note_text(snap)) == str(_note_text(owner.doc))
        assert dict(_note_text(snap).attributes) == {"openForAll": True}
        assert content(snap)["objects"]["a"]["text"] == "alpha"
        # хвост журнала после снимка: ещё правка заметки и повтор обновления создания
        owner.edit(lambda d: _note_text(d).insert(len(str(_note_text(d))), "tail"))
        other.send_raw(frame(UPDATE, NOTE_CREATE))
        other.wait_for(lambda q: str(_note_text(q.doc)).endswith("tail"))
        assert owner.is_open() and other.is_open()
        expected_text = str(_note_text(owner.doc))
        expected_content = content(owner.doc)
        restart_api(clean_stack)
    late = _late(guest, guest_path)
    assert str(_note_text(late)) == expected_text
    assert dict(_note_text(late).attributes) == {"openForAll": True}
    assert content(late) == expected_content
    # после перезапуска клиент «создаёт» заметку снова — узел тот же, правки ходят
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.doc.apply_update(NOTE_CREATE)
        owner.send_raw(frame(UPDATE, NOTE_CREATE))
        owner.edit(lambda d: _note_text(d).insert(0, "after "))
        other.wait_for(lambda q: str(_note_text(q.doc)).startswith("after "))
        assert owner.is_open()
    assert str(_note_text(_late(guest, guest_path))) == "after " + expected_text
    assert isinstance(_late(guest, guest_path).get("objects", type=Map), Map)
