"""Приёмка T4.1: синхронизация документа доски — COL-01, SHR-04 (канал), SHR-06 (WebSocket).

Два и более независимых клиента WebSocket со своими cookie и своим документом Yjs (`pycrdt`).
Протокол — `sync_helpers.py`; маршрут `/api/ws?board=` / `?token=` — из handoff T4.1.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from pycrdt import Doc, Map, Text

from admin_helpers import create_user
from board_helpers import create_board, delete_board, get_board, recent_boards, ts, unique_title
from share_helpers import join, link, reset
from stand import Client, clients
from sync_helpers import (
    STEP1,
    STEP2,
    SYNC,
    UPDATE,
    channel_path,
    frame,
    handshake_refusal,
    handshake_status,
    objects_of,
    peer,
    varuint,
)
from user_helpers import logout, user_login


# --- фикстуры ---------------------------------------------------------------------


@pytest.fixture
def owner_path(board: dict[str, Any]) -> str:
    return channel_path(board=board["id"])


@pytest.fixture
def guest_path(link_participant: Client) -> str:
    return channel_path(token=link_participant.token)  # type: ignore[attr-defined]


@pytest.fixture
def other_user(admin: Client, clean_stack: str) -> Iterator[Client]:
    """Пользователь досок B — другая учётка."""
    account = create_user(admin)
    with clients(clean_stack, "user_B") as (one,):
        assert user_login(one, account["email"], account["_password"]).status_code == 204
        yield one


def _new_guest(base_url: str, token: str, name: str) -> Client:
    guest = Client(name, base_url)
    resp = join(guest, token, name)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return guest


def _put_object(oid: str, **fields: Any) -> Any:
    def change(doc: Doc) -> None:
        data = dict(fields)
        text = data.pop("text", None)
        if text is not None:
            data["text"] = Text(text)
        objects_of(doc)[oid] = Map(data)

    return change


def _set_field(oid: str, key: str, value: Any) -> Any:
    def change(doc: Doc) -> None:
        objects_of(doc)[oid][key] = value

    return change


def _insert_text(oid: str, index: int, chunk: str) -> Any:
    def change(doc: Doc) -> None:
        objects_of(doc)[oid]["text"].insert(index, chunk)

    return change


def _has(oid: str) -> Any:
    return lambda p: oid in p.snapshot()


# --- COL-01 / SHR-04: правки видны другому клиенту ----------------------------------


def test_col01_shr04_owner_edit_reaches_participant_and_back(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        owner.edit(_put_object("o1", type="sticky", x=10, y=20, text="Hello"))
        guest.wait_for(_has("o1"))
        assert guest.snapshot()["o1"] == {"type": "sticky", "x": 10.0, "y": 20.0, "text": "Hello"}

        guest.edit(_set_field("o1", "x", 99))
        owner.wait_for(lambda p: p.snapshot()["o1"]["x"] == 99)


def test_shr04_participant_creates_changes_and_deletes_objects(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        guest.edit(_put_object("g1", type="shape", x=1))
        guest.edit(_put_object("g2", type="shape", x=2))
        owner.wait_for(lambda p: {"g1", "g2"} <= set(p.snapshot()))

        guest.edit(_set_field("g1", "x", 42))
        owner.wait_for(lambda p: p.snapshot()["g1"]["x"] == 42)

        guest.edit(lambda doc: objects_of(doc).pop("g2"))
        owner.wait_for(lambda p: "g2" not in p.snapshot())

        # объект, созданный владельцем, участник тоже удаляет (те же права)
        owner.edit(_put_object("own", type="text"))
        guest.wait_for(_has("own"))
        guest.edit(lambda doc: objects_of(doc).pop("own"))
        owner.wait_for(lambda p: "own" not in p.snapshot())


def test_col01_sender_gets_no_echo_breaking_state(
    board_user: Client, owner_path: str
) -> None:
    """Граничный: эхо своей правки, если приходит, состояние не меняет."""
    with peer(board_user, owner_path) as owner:
        owner.edit(_put_object("e1", type="text", text="abc"))
        before = owner.snapshot()
        owner.pump(1.0)
        assert owner.snapshot() == before


# --- COL-01: одновременные правки одного объекта и одного текста ----------------------


def test_col01_concurrent_edits_of_same_object_fields_merge(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        owner.edit(_put_object("o", type="sticky", x=0, color="yellow", text="Hello"))
        guest.wait_for(_has("o"))

        # обе правки уходят до того, как клиент увидел чужую
        owner.edit(_set_field("o", "x", 5))
        guest.edit(_set_field("o", "color", "red"))

        expected = {"type": "sticky", "x": 5.0, "color": "red", "text": "Hello"}
        owner.wait_for(lambda p: p.snapshot()["o"] == expected)
        guest.wait_for(lambda p: p.snapshot()["o"] == expected)
        assert owner.state() == guest.state() or owner.snapshot() == guest.snapshot()


@pytest.mark.parametrize(
    ("owner_at", "guest_at"),
    [(0, 5), (5, 5), (0, 0), (2, 3)],
    ids=["start_and_end", "same_end", "same_start", "middle"],
)
def test_col01_concurrent_text_edits_of_same_object_merge(
    board_user: Client,
    link_participant: Client,
    owner_path: str,
    guest_path: str,
    owner_at: int,
    guest_at: int,
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        owner.edit(_put_object("t", type="text", text="Hello"))
        guest.wait_for(_has("t"))

        owner.edit(_insert_text("t", owner_at, "AAA"))
        guest.edit(_insert_text("t", guest_at, "BBB"))

        owner.pump(1.0)
        guest.pump(1.0)
        a, b = owner.snapshot()["t"]["text"], guest.snapshot()["t"]["text"]
        assert a == b, (a, b)
        assert sorted(a) == sorted("HelloAAABBB"), a
        # ни один символ не потерян и порядок исходного текста сохранён
        assert a.replace("AAA", "").replace("BBB", "") == "Hello", a


def test_col01_three_clients_burst_converge(
    board_user: Client, link_participant: Client, clean_stack: str, owner_path: str, guest_path: str
) -> None:
    guest2 = _new_guest(clean_stack, link_participant.token, "QA Guest 2")  # type: ignore[attr-defined]
    try:
        with (
            peer(board_user, owner_path) as a,
            peer(link_participant, guest_path) as b,
            peer(guest2, guest_path) as c,
        ):
            a.edit(_put_object("shared", type="text", text=""))
            b.wait_for(_has("shared"))
            c.wait_for(_has("shared"))
            for i in range(20):
                for name, p in (("a", a), ("b", b), ("c", c)):
                    p.edit(_put_object(f"{name}{i}", type="sticky", n=i))
                    p.edit(_insert_text("shared", 0, name))
                    p.edit(_set_field("shared", f"by_{name}", i))
            for p in (a, b, c):
                p.wait_for(lambda q: len(q.snapshot()) == 61, timeout=10)
            for p in (a, b, c):
                p.pump(1.0)
            snaps = [p.snapshot() for p in (a, b, c)]
            assert snaps[0] == snaps[1] == snaps[2]
            text = snaps[0]["shared"]["text"]
            assert sorted(text) == sorted("abc" * 20), text
            assert {snaps[0]["shared"][f"by_{n}"] for n in "abc"} == {19.0}
    finally:
        guest2.close()


# --- COL-01: поздний клиент получает текущее состояние ----------------------------------


def test_col01_late_client_receives_state_after_everyone_left(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        owner.edit(_put_object("o1", type="sticky", text="Hi"))
        guest.wait_for(_has("o1"))
        guest.edit(_insert_text("o1", 2, " there"))
        guest.edit(_put_object("o2", type="shape"))
        owner.wait_for(lambda p: "o2" in p.snapshot() and p.snapshot()["o1"]["text"] == "Hi there")
        expected = owner.snapshot()
    time.sleep(0.5)
    # все ушли; новый клиент владельца и новый клиент участника видят то же
    with peer(board_user, owner_path) as late:
        assert late.snapshot() == expected
    with peer(link_participant, guest_path) as late_guest:
        assert late_guest.snapshot() == expected


def test_col01_late_client_with_partial_state_gets_only_missing(
    board_user: Client, owner_path: str
) -> None:
    with peer(board_user, owner_path) as first:
        first.edit(_put_object("o1", type="text", text="one"))
        known = Doc()
        known.apply_update(first.doc.get_update())
        first.edit(_put_object("o2", type="text", text="two"))
        first.edit(_insert_text("o1", 3, "!"))
        expected = first.snapshot()
    time.sleep(0.3)
    with peer(board_user, owner_path, doc=known) as late:
        assert late.snapshot() == expected
        step2 = [payload for t, sub, payload in late.received if t == SYNC and sub == STEP2]
        assert step2, late.received


def test_col01_offline_edits_reach_others_after_reconnect(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    """Клиент без связи копит правки; после переподключения его правки уходят, чужие — приходят."""
    with peer(board_user, owner_path) as owner:
        owner.edit(_put_object("o", type="text", text="base"))
        offline_doc = Doc()
        with peer(link_participant, guest_path, doc=offline_doc) as guest:
            guest.wait_for(_has("o"))
        # связь потеряна: правки копятся локально
        offline = peer  # для читаемости
        local = Doc()
        local.apply_update(offline_doc.get_update())
        with local.transaction():
            objects_of(local)["offline"] = Map({"type": "sticky"})
            objects_of(local)["o"]["text"].insert(4, "+guest")
        owner.edit(_insert_text("o", 0, "owner+"))
        # переподключение: сервер присылает STEP1, клиент отвечает накопленным STEP2
        with offline(link_participant, guest_path, doc=local) as back:
            owner.wait_for(lambda p: "offline" in p.snapshot(), timeout=5)
            back.pump(0.7)
            owner.pump(0.7)
            assert back.snapshot() == owner.snapshot()
            assert owner.snapshot()["o"]["text"] == "owner+base+guest"


# --- COL-01: повреждённое обновление -------------------------------------------------

CORRUPTED_FRAMES: dict[str, bytes | str] = {
    "garbage_update": frame(UPDATE, b"\xff\xfe\xfd\xfc garbage \x00\x01"),
    "truncated_update": b"",  # заполняется в тесте обрезанным реальным обновлением
    "garbage_step2": frame(STEP2, b"\x07\x07\x07\x07\x07"),
    "garbage_step1": frame(STEP1, b"\xff\xff\xff"),
    "length_beyond_frame": varuint(SYNC) + varuint(UPDATE) + varuint(1000) + b"\x00\x00",
    "trailing_bytes": frame(UPDATE, b"\x00\x00") + b"\x09\x09",
    "unknown_type": frame(0, b"\x00", msg_type=77),
    "unknown_subtype": frame(9, b"\x00"),
    "random_binary": b"\x80",
    "text_frame": "hello",
}


@pytest.mark.parametrize("kind", list(CORRUPTED_FRAMES))
def test_col01_corrupted_update_closes_only_sender(
    board_user: Client,
    link_participant: Client,
    clean_stack: str,
    owner_path: str,
    guest_path: str,
    kind: str,
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        owner.edit(_put_object("o", type="text", text="clean"))
        guest.wait_for(_has("o"))
        expected = owner.snapshot()

        data = CORRUPTED_FRAMES[kind]
        if kind == "truncated_update":
            probe = Doc()
            probe.apply_update(guest.doc.get_update())
            before = probe.get_state()
            with probe.transaction():
                objects_of(probe)["evil"] = Map({"type": "text", "text": Text("x" * 50)})
            update = probe.get_update(before)
            data = frame(UPDATE, update[: len(update) // 2])
        guest.send_raw(data)

        code = guest.close_code()
        assert code is not None and code != 1000, code
        # остальные: соединение открыто, документ не изменился, правки ходят
        owner.pump(1.0)
        assert owner.is_open()
        assert owner.snapshot() == expected
        owner.edit(_put_object("after", type="text"))
        with peer(board_user, owner_path) as late:
            late.wait_for(_has("after"))
            snap = late.snapshot()
            assert "evil" not in snap
            assert {k: v for k, v in snap.items() if k != "after"} == expected
    # HTTP живо
    assert get_board(board_user, link_participant.board["id"]).status_code == 200  # type: ignore[attr-defined]


def test_col01_corrupted_update_does_not_leak_to_other_clients(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        owner.pump(0.3)
        seen = len(owner.received)
        guest.send_raw(frame(UPDATE, b"\xff\xfe\xfd\xfc garbage"))
        guest.close_code()
        owner.pump(1.0)
        assert len(owner.received) == seen, owner.received[seen:]


# --- COL-01: изоляция досок -----------------------------------------------------------


def test_col01_edit_of_one_board_does_not_reach_another(
    board_user: Client, owner_path: str
) -> None:
    other = create_board(board_user, unique_title())
    other_path = channel_path(board=other["id"])
    with peer(board_user, other_path) as y, peer(board_user, owner_path) as x:
        y.pump(0.3)
        seen = len(y.received)
        x.edit(_put_object("only_x", type="text"))
        y.pump(1.0)
        assert len(y.received) == seen
        assert "only_x" not in y.snapshot()
    with peer(board_user, other_path) as late:
        assert late.snapshot() == {}


# --- COL-01: updated_at --------------------------------------------------------------


def test_col01_accepted_edit_moves_board_up_in_recent(
    board_user: Client, board: dict[str, Any], owner_path: str
) -> None:
    before = ts(get_board(board_user, board["id"]).json()["updated_at"])
    newer = create_board(board_user, unique_title())
    assert recent_boards(board_user)[0]["id"] == newer["id"]
    time.sleep(1.1)
    with peer(board_user, owner_path) as owner:
        owner.edit(_put_object("o", type="text"))
        owner.pump(0.5)
    after = ts(get_board(board_user, board["id"]).json()["updated_at"])
    assert after > before
    assert recent_boards(board_user)[0]["id"] == board["id"]


def test_col01_participant_edit_moves_board_up_in_recent(
    board_user: Client, link_participant: Client, guest_path: str
) -> None:
    board = link_participant.board  # type: ignore[attr-defined]
    newer = create_board(board_user, unique_title())
    assert recent_boards(board_user)[0]["id"] == newer["id"]
    time.sleep(1.1)
    with peer(link_participant, guest_path) as guest:
        guest.edit(_put_object("o", type="text"))
        guest.pump(0.5)
    assert recent_boards(board_user)[0]["id"] == board["id"]


def test_col01_rejected_update_does_not_corrupt_board(
    board_user: Client, board: dict[str, Any], owner_path: str
) -> None:
    """Граничный: после мусорного кадра доска открывается и HTTP-метаданные целы."""
    with peer(board_user, owner_path) as owner:
        owner.send_raw(frame(UPDATE, b"\xff\xff\xff\xff"))
        owner.close_code()
    resp = get_board(board_user, board["id"])
    assert resp.status_code == 200
    with peer(board_user, owner_path) as again:
        assert again.snapshot() == {}


# --- Доступ к каналу (ARCH-T41-01, SHR-05) -------------------------------------------


def test_arch_t41_01_owner_and_participant_open_channel(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    assert handshake_status(board_user, owner_path) == 101
    assert handshake_status(link_participant, guest_path) == 101


def test_arch_t41_01_stranger_without_cookie_is_refused(
    client: Client, board: dict[str, Any], board_user: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    for path in ("/api/ws", channel_path(board=board["id"]), channel_path(token=token)):
        assert handshake_status(client, path) in (401, 403, 404), path


def test_arch_t41_01_other_user_and_admin_are_refused(
    board: dict[str, Any], board_user: Client, other_user: Client, admin: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    for who in (other_user, admin):
        for path in (channel_path(board=board["id"]), channel_path(token=token)):
            assert handshake_status(who, path) in (401, 403, 404), (who.name, path)


def test_arch_t41_01_refusal_does_not_reveal_board_existence(
    board: dict[str, Any], board_user: Client, other_user: Client, clean_stack: str
) -> None:
    token = link(board_user, board["id"])["token"]
    foreign = handshake_refusal(other_user, channel_path(board=board["id"]))
    missing = handshake_refusal(other_user, channel_path(board=str(uuid.uuid4())))
    assert foreign == missing
    with clients(clean_stack, "stranger") as (stranger,):
        bad_token = handshake_refusal(stranger, channel_path(token="A" * 43))
        real_token = handshake_refusal(stranger, channel_path(token=token))
    assert bad_token == real_token


def test_arch_t41_01_deleted_board_channel_is_refused(
    board_user: Client, board: dict[str, Any], owner_path: str
) -> None:
    assert delete_board(board_user, board["id"]).status_code in (200, 204)
    assert handshake_status(board_user, owner_path) in (403, 404)


def test_shr04_participant_cookie_of_board_x_does_not_open_board_y(
    board_user: Client, link_participant: Client
) -> None:
    other = create_board(board_user, unique_title())
    other_token = link(board_user, other["id"])["token"]
    assert handshake_status(link_participant, channel_path(token=other_token)) in (401, 403, 404)
    assert handshake_status(link_participant, channel_path(board=other["id"])) in (401, 403, 404)
    board = link_participant.board  # type: ignore[attr-defined]
    assert handshake_status(link_participant, channel_path(board=board["id"])) in (401, 403, 404)


def test_arch_t41_01_signed_out_owner_cannot_open_and_open_channel_closes(
    board_user: Client, owner_path: str, clean_stack: str
) -> None:
    cookie = board_user.http.cookies.get("myboard_session")
    with peer(board_user, owner_path) as owner:
        assert logout(board_user).status_code in (200, 204)
        code = owner.close_code(timeout=10)
        assert code is not None and code != 1000
    stale = Client("stale", clean_stack)
    stale.http.cookies.set("myboard_session", cookie)
    try:
        assert handshake_status(stale, owner_path) in (401, 403)
    finally:
        stale.close()


# --- SHR-06 (WebSocket) --------------------------------------------------------------


def test_shr06_reset_closes_open_participant_channel_and_keeps_owner(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str, clean_stack: str
) -> None:
    board = link_participant.board  # type: ignore[attr-defined]
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        new = reset(board_user, board["id"]).json()["token"]
        code = guest.close_code(timeout=3)
        assert code is not None and code != 1000
        # правки владельца продолжаются, отключённый участник их не получает
        owner.edit(_put_object("after_reset", type="text"))
        assert owner.is_open()
        fresh = _new_guest(clean_stack, new, "New Guest")
        try:
            with peer(fresh, channel_path(token=new)) as g2:
                assert "after_reset" in g2.snapshot()
        finally:
            fresh.close()


def test_shr06_old_cookie_and_old_token_refused_on_websocket(
    board_user: Client, link_participant: Client, guest_path: str, clean_stack: str
) -> None:
    board = link_participant.board  # type: ignore[attr-defined]
    new = reset(board_user, board["id"]).json()["token"]
    assert handshake_status(link_participant, guest_path) in (401, 403, 404)
    assert handshake_status(link_participant, channel_path(token=new)) in (401, 403, 404)
    fresh = _new_guest(clean_stack, new, "New Guest")
    try:
        assert handshake_status(fresh, channel_path(token=new)) == 101
        assert handshake_status(fresh, guest_path) in (401, 403, 404)
    finally:
        fresh.close()


def test_shr06_old_link_participant_edits_are_not_applied_after_reset(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    board = link_participant.board  # type: ignore[attr-defined]
    with peer(board_user, owner_path) as owner, peer(link_participant, guest_path) as guest:
        reset(board_user, board["id"])
        try:
            guest.edit(_put_object("ghost", type="text"))
        except Exception:  # noqa: BLE001 — соединение уже закрыто: правка не ушла
            pass
        owner.pump(1.5)
        assert "ghost" not in owner.snapshot()
    with peer(board_user, owner_path) as late:
        assert "ghost" not in late.snapshot()


# --- ARCH-T41-03: смысл кадров sync ---------------------------------------------------


def test_arch_t41_03_server_speaks_sync_step1_step2_update(
    board_user: Client, link_participant: Client, owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path, synced=False) as owner:
        owner.sync()
        subs = [sub for t, sub, _ in owner.received if t == SYNC]
        assert STEP1 in subs and STEP2 in subs, owner.received
        with peer(link_participant, guest_path) as guest:
            guest.edit(_put_object("u", type="text"))
            owner.wait_for(_has("u"))
            assert owner.received[-1][1] == UPDATE
