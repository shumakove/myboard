"""Приёмка T4.2: присутствие и курсоры — COL-02, COL-03 (протокол), COL-04 (протокол), COL-09.

Независимые клиенты WebSocket со своими cookie. Кадры `awareness = 1` и `presence = 2`
(`varuint тип | varuint длина | JSON`) — из handoff T4.2; смысл — ARCHITECTURE.md 6 и 10.
Сценарии — docs/qa/reports/T4.2.md.
"""

from __future__ import annotations

import socket
import time
from collections.abc import Iterator
from typing import Any

import pytest
from pycrdt import Map

from admin_helpers import create_user
from board_helpers import create_board, get_board, recent_boards, ts, unique_title
from share_helpers import join, link, reset
from stand import Client, clients
from sync_helpers import (
    AWARENESS,
    PRESENCE,
    UPDATE,
    channel_path,
    json_frame,
    peer,
    varuint,
)
from user_helpers import user_login


@pytest.fixture
def token(board_user: Client, board: dict[str, Any]) -> str:
    return link(board_user, board["id"])["token"]


@pytest.fixture
def owner_name(board_user: Client) -> str:
    return board_user.account["name"]  # type: ignore[attr-defined]


def guest(base_url: str, token: str, name: str) -> Client:
    one = Client(name, base_url)
    resp = join(one, token, name)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return one


def has_names(*expected: str):
    return lambda p: p.names() == sorted(expected)


def cursor_of(p, name: str) -> Any:
    for item in p.awareness.values():
        if item["name"] == name:
            return item["state"].get("cursor")
    return None


# --- COL-09 ----------------------------------------------------------------------------


def test_col09_presence_lists_everyone_and_updates_on_join_and_leave(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Kate QA")
    with peer(board_user, channel_path(board=board["id"])) as owner:
        owner.wait_presence(has_names(owner_name))
        with peer(g, channel_path(token=token)) as kate:
            owner.wait_presence(has_names(owner_name, "Kate QA"))
            kate.wait_presence(has_names(owner_name, "Kate QA"))
            # своя запись отмечена: self указывает на peer получателя
            assert owner.presence and owner.presence["self"] in {p["peer"] for p in owner.peers()}
            assert kate.presence and kate.presence["self"] != owner.presence["self"]
        spent = owner.wait_presence(has_names(owner_name))
        assert spent <= 5, spent
    g.close()


def test_col09_two_participants_with_same_name_are_two_entries(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    a, b = guest(clean_stack, token, "Twin"), guest(clean_stack, token, "Twin")
    with peer(board_user, channel_path(board=board["id"])) as owner:
        with peer(a, channel_path(token=token)), peer(b, channel_path(token=token)):
            owner.wait_presence(has_names(owner_name, "Twin", "Twin"))
            assert len({p["peer"] for p in owner.peers()}) == 3
        owner.wait_presence(has_names(owner_name))
    a.close()
    b.close()


def test_col09_abrupt_disconnect_removes_participant(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Dropped")
    with peer(board_user, channel_path(board=board["id"])) as owner:
        with g.websocket(channel_path(token=token)) as ws:
            owner.wait_presence(has_names(owner_name, "Dropped"))
            # обрыв без кадра закрытия WebSocket
            ws.socket.shutdown(socket.SHUT_RDWR)
            ws.socket.close()
            spent = owner.wait_presence(has_names(owner_name), timeout=60)
        print(f"запись пропала через {spent:.1f} с")
        assert spent <= 60
    g.close()


def test_col09_presence_and_cursors_do_not_leak_to_other_board(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    other = create_board(board_user, unique_title())
    g = guest(clean_stack, token, "Elsewhere")
    with peer(board_user, channel_path(board=other["id"])) as watcher:
        watcher.wait_presence(has_names(owner_name))
        with peer(g, channel_path(token=token)) as p:
            p.send_awareness({"cursor": {"x": 1, "y": 2}, "camera": None, "following": None})
            watcher.pump(1.5)
            assert watcher.names() == [owner_name]
            assert watcher.awareness == {}
    g.close()


def test_col09_shr06_reset_removes_old_link_participant_from_presence(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Revoked")
    with peer(board_user, channel_path(board=board["id"])) as owner:
        with peer(g, channel_path(token=token)) as p:
            owner.wait_presence(has_names(owner_name, "Revoked"))
            assert reset(board_user, board["id"]).status_code in (200, 201, 204)
            spent = owner.wait_presence(has_names(owner_name))
            assert spent <= 5
            assert p.close_code() == 4403
    g.close()


def test_col09_outsider_user_b_and_admin_get_no_presence(
    board: dict[str, Any], admin: Client, client: Client, clean_stack: str
) -> None:
    account = create_user(admin)
    with clients(clean_stack, "user_B") as (other,):
        assert user_login(other, account["email"], account["_password"]).status_code == 204
        for who in (client, other, admin):
            with pytest.raises(Exception):
                with who.websocket(channel_path(board=board["id"])) as ws:
                    ws.recv(timeout=3)


# --- COL-02 ----------------------------------------------------------------------------


def test_col02_cursor_and_session_name_reach_other_participant(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Kate QA")
    with peer(board_user, channel_path(board=board["id"])) as owner, peer(g, channel_path(token=token)) as kate:
        owner.wait_presence(has_names(owner_name, "Kate QA"))
        kate.send_awareness({"cursor": {"x": 120.5, "y": -40}, "camera": None, "following": None})
        owner.wait_presence(lambda p: cursor_of(p, "Kate QA") == {"x": 120.5, "y": -40})
        owner.send_awareness({"cursor": {"x": 7, "y": 8}, "camera": None, "following": None})
        kate.wait_presence(lambda p: cursor_of(p, owner_name) == {"x": 7, "y": 8})
        # курсор следует за движением
        kate.send_awareness({"cursor": {"x": 300, "y": 200}, "camera": None, "following": None})
        owner.wait_presence(lambda p: cursor_of(p, "Kate QA") == {"x": 300, "y": 200})
        # своё состояние отправителю не возвращается
        kate.pump(1.0)
        assert all(item["name"] != "Kate QA" for item in kate.awareness.values())
        assert all(item["peer"] != kate.presence["self"] for item in kate.awareness_log)  # type: ignore[index]
    g.close()


def test_col02_participant_cannot_impersonate_owner_name(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Mallory")
    with peer(board_user, channel_path(board=board["id"])) as owner, peer(g, channel_path(token=token)) as m:
        owner.wait_presence(has_names(owner_name, "Mallory"))
        m.send_awareness({"cursor": {"x": 1, "y": 1}, "name": owner_name, "user": {"name": owner_name},
                          "camera": None, "following": None})
        owner.wait_presence(lambda p: cursor_of(p, "Mallory") == {"x": 1, "y": 1})
        assert owner.names() == sorted([owner_name, "Mallory"])
        assert [i["name"] for i in owner.awareness.values()] == ["Mallory"]
    g.close()


def test_col02_late_participant_receives_current_cursors(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Late")
    with peer(board_user, channel_path(board=board["id"])) as owner:
        owner.send_awareness({"cursor": {"x": 50, "y": 60}, "camera": {"x": 0, "y": 0, "zoom": 1}, "following": None})
        owner.pump(0.5)
        with peer(g, channel_path(token=token)) as late:
            late.wait_presence(lambda p: cursor_of(p, owner_name) == {"x": 50, "y": 60})
    g.close()


def test_col02_cursor_disappears_when_owner_hides_it_by_null(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Watcher")
    with peer(board_user, channel_path(board=board["id"])) as owner, peer(g, channel_path(token=token)) as w:
        owner.send_awareness({"cursor": {"x": 5, "y": 5}, "camera": None, "following": None})
        w.wait_presence(lambda p: cursor_of(p, owner_name) == {"x": 5, "y": 5})
        owner.send_awareness({"cursor": None, "camera": None, "following": None})
        w.wait_presence(lambda p: cursor_of(p, owner_name) is None)
    g.close()


# --- COL-04 (протокол) --------------------------------------------------------------------


def test_col04_camera_and_following_reach_other_participants(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Follower")
    with peer(board_user, channel_path(board=board["id"])) as owner, peer(g, channel_path(token=token)) as f:
        owner.wait_presence(has_names(owner_name, "Follower"))
        owner_peer = owner.presence["self"]  # type: ignore[index]
        f.send_awareness({"cursor": None, "camera": None, "following": owner_peer})
        owner.wait_presence(lambda p: any(i["state"].get("following") == owner_peer for i in p.awareness.values()))
        for cam in ({"x": 100, "y": 50, "zoom": 1}, {"x": -30, "y": 10, "zoom": 2.5}):
            owner.send_awareness({"cursor": None, "camera": cam, "following": None})
            f.wait_presence(lambda p, cam=cam: any(i["state"].get("camera") == cam for i in p.awareness.values()))
    g.close()


# --- ARCH-T42-01: протокол присутствия ----------------------------------------------------


@pytest.mark.parametrize(
    "bad",
    [
        pytest.param(varuint(AWARENESS) + varuint(5) + b"nojso", id="awareness-not-json"),
        pytest.param(json_frame(AWARENESS, [1, 2]), id="awareness-not-object"),
        pytest.param(json_frame(AWARENESS, b'{"cursor": {"x": NaN, "y": 1}}'), id="awareness-nan"),
        pytest.param(json_frame(AWARENESS, {"cursor": None, "pad": "x" * 5000}), id="awareness-too-big"),
        pytest.param(json_frame(AWARENESS, {"cursor": None}) + b"\x00", id="awareness-trailing"),
        pytest.param(varuint(AWARENESS) + varuint(100) + b"{}", id="awareness-short"),
        pytest.param(json_frame(PRESENCE, {"self": "x", "peers": [{"peer": "x", "name": "Fake"}]}), id="client-presence"),
    ],
)
def test_arch_t42_01_bad_presence_frames_close_only_sender(
    bad: bytes, board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Bad")
    with peer(board_user, channel_path(board=board["id"])) as owner:
        with peer(g, channel_path(token=token)) as p:
            owner.wait_presence(has_names(owner_name, "Bad"))
            p.send_raw(bad)
            assert p.close_code() == 1007
        owner.wait_presence(has_names(owner_name))
        assert owner.is_open()
        assert "Fake" not in owner.names()
        assert all(i["name"] != "Fake" for i in owner.awareness_log)
    g.close()


def test_arch_t42_01_valid_awareness_keeps_connection_and_sync_still_works(
    board_user: Client, board: dict[str, Any], token: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Mixer")
    with peer(board_user, channel_path(board=board["id"])) as owner, peer(g, channel_path(token=token)) as p:
        for i in range(30):
            p.send_awareness({"cursor": {"x": i, "y": i}, "camera": None, "following": None})
        p.edit(lambda d: d.get("objects", type=Map).__setitem__("o1", Map({"type": "sticky"})))
        owner.wait_for(lambda q: "o1" in q.snapshot())
        assert p.is_open()
    g.close()


# --- ARCH-T42-02: присутствие не в документе -------------------------------------------


def test_arch_t42_02_awareness_does_not_enter_document_or_touch_updated_at(
    board_user: Client, board: dict[str, Any], token: str, owner_name: str, clean_stack: str
) -> None:
    g = guest(clean_stack, token, "Ghost")
    before = ts(get_board(board_user, board["id"]).json()["updated_at"])
    newer = create_board(board_user, unique_title())
    with peer(board_user, channel_path(board=board["id"])) as owner, peer(g, channel_path(token=token)) as p:
        owner.wait_presence(has_names(owner_name, "Ghost"))
        for i in range(10):
            p.send_awareness({"cursor": {"x": i, "y": 0}, "camera": {"x": i, "y": 0, "zoom": 1}, "following": None})
            owner.send_awareness({"cursor": {"x": 0, "y": i}, "camera": None, "following": None})
        owner.pump(1.0)
        # ни одного кадра sync UPDATE от обмена присутствием
        assert not [r for r in owner.received if r[1] == UPDATE]
    time.sleep(0.5)
    with clients(clean_stack, "late") as (late_client,):
        late_client.http.cookies.update(board_user.http.cookies)
        with peer(late_client, channel_path(board=board["id"])) as late:
            late.pump(0.5)
            state = late.doc.get_state()
            assert state in (b"\x00",), state  # пустой документ: ни одного обновления
    after = ts(get_board(board_user, board["id"]).json()["updated_at"])
    assert after == before
    assert recent_boards(board_user)[0]["id"] == newer["id"]
    g.close()
