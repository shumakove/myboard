"""Приёмка T4.3: журнал, снимки, корзина — основа COL-07, COL-08; ARCH-T42-02 (снимок).

Наблюдение — через канал `/api/ws` (независимый клиент `pycrdt`), HTTP и SQL только на чтение
к таблицам `board_updates`, `board_snapshots`, `board_events` стека QA (history_helpers.py).
Проверки фонового снимка открытой доски требуют короткого периода: стек QA поднимается
с `SNAPSHOT_INTERVAL_SECONDS=5`; при периоде больше 20 с они пропускаются с причиной.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from pycrdt import Doc, Map

from admin_helpers import create_user
from board_helpers import create_board, unique_title
from history_helpers import (
    container,
    container_env,
    content,
    crash_api,
    doc_from,
    docker,
    eventually,
    events,
    move_to_trash,
    restart_api,
    snapshot_interval,
    snapshots,
    sticker,
    update_blobs,
    update_seqs,
)
from share_helpers import join, link, reset
from stand import Client, clients
from sync_helpers import UPDATE, channel_path, frame, handshake_status, peer
from user_helpers import user_login

ALLOWED_ROOTS = {"objects", "trash", "comments", "timer", "votes", "notes"}


# --- фикстуры ---------------------------------------------------------------------


@pytest.fixture
def interval() -> float:
    value = snapshot_interval()
    if value > 20:
        pytest.skip(f"SNAPSHOT_INTERVAL_SECONDS={value}: поднимите стек QA с SNAPSHOT_INTERVAL_SECONDS=5")
    return value


@pytest.fixture
def owner_path(board: dict[str, Any]) -> str:
    return channel_path(board=board["id"])


@pytest.fixture
def guest_name() -> str:
    return "QA Guest " + uuid.uuid4().hex[:6]


@pytest.fixture
def guest(board_user: Client, board: dict[str, Any], clean_stack: str, guest_name: str) -> Iterator[Client]:
    token = link(board_user, board["id"])["token"]
    with clients(clean_stack, "guest") as (one,):
        resp = join(one, token, guest_name)
        assert resp.status_code == 200, (resp.status_code, resp.text)
        one.token = token  # type: ignore[attr-defined]
        yield one


@pytest.fixture
def guest_path(guest: Client) -> str:
    return channel_path(token=guest.token)  # type: ignore[attr-defined]


def _wait_compacted(board_id: str, timeout: float, *, min_snapshots: int = 1) -> list[dict[str, Any]]:
    eventually(
        lambda: len(snapshots(board_id)) >= min_snapshots and not update_seqs(board_id),
        timeout,
        f"журнал не сжат: снимков {len(snapshots(board_id))}, строк журнала {len(update_seqs(board_id))}",
    )
    return snapshots(board_id)


def _late_content(client: Client, path: str, doc: Doc | None = None) -> dict[str, Any]:
    with peer(client, path, doc=doc) as late:
        late.pump(0.5)
        return content(late.doc)


# --- COL-07 (основа): фоновый снимок и отрезание журнала --------------------------------


def test_col07_open_board_gets_snapshot_and_journal_is_trimmed(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, interval: float
) -> None:
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        for i in range(3):
            owner.edit(sticker(f"s{i}", f"text {i}"))
        other.wait_for(lambda p: len(p.snapshot()) == 3)
        seqs_before = update_seqs(board["id"])
        rows = _wait_compacted(board["id"], 3 * interval + 5)
        # снимок снят, пока доска открыта: оба соединения живы
        assert owner.is_open() and other.is_open()
        assert content(doc_from(rows[-1]["state"])) == content(owner.doc)
        owner.edit(sticker("after", "after snapshot"))
        other.wait_for(lambda p: "after" in p.snapshot())
        seqs_after = update_seqs(board["id"])
        if seqs_after and seqs_before:
            assert min(seqs_after) > max(seqs_before), (seqs_before, seqs_after)


def test_col07_snapshots_accumulate_and_idle_board_gets_none(
    board_user: Client, board: dict[str, Any], owner_path: str, interval: float
) -> None:
    with peer(board_user, owner_path) as owner:
        owner.edit(sticker("a", "first"))
        first = _wait_compacted(board["id"], 3 * interval + 5)
        assert len(first) == 1
        # без правок новых снимков нет
        time.sleep(2.5 * interval)
        owner.pump(0.2)
        assert len(snapshots(board["id"])) == 1
        owner.edit(sticker("b", "second"))
        rows = _wait_compacted(board["id"], 3 * interval + 5, min_snapshots=2)
        assert rows[0]["id"] == first[0]["id"], "первый снимок удалён"
        assert rows[0]["created_at"] < rows[-1]["created_at"]
        assert set(content(doc_from(rows[0]["state"]))["objects"]) == {"a"}
        assert set(content(doc_from(rows[-1]["state"]))["objects"]) == {"a", "b"}


def test_col07_late_client_after_compaction_gets_full_state(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, interval: float
) -> None:
    with peer(board_user, owner_path) as owner:
        owner.edit(sticker("keep", "hello"))
        owner.edit(sticker("gone", "will be deleted"))
        owner.edit(sticker("field", "f", color="red"))
        mid = Doc()
        mid.apply_update(owner.doc.get_update())  # клиент со «старым» вектором версии
        owner.edit(lambda d: d.get("objects", type=Map)["keep"]["text"].insert(5, " world"))
        owner.edit(move_to_trash(["gone"], board_user.account["name"]))  # type: ignore[attr-defined]
        owner.edit(lambda d: d.get("objects", type=Map)["field"].pop("color"))
        owner.pump(0.5)
        _wait_compacted(board["id"], 3 * interval + 5)
        expected = content(owner.doc)
        assert expected["objects"]["keep"]["text"] == "hello world"
        # пустой вектор версии — полный документ
        assert _late_content(guest, guest_path) == expected
        # вектор, снятый до сжатия, — сходится, удалённое не возвращается
        got = _late_content(guest, guest_path, doc=mid)
        assert got == expected
        assert "gone" not in got["objects"] and "color" not in got["objects"]["field"]
        # хвост журнала после снимка тоже приходит
        owner.edit(sticker("tail", "after snapshot"))
        owner.pump(0.3)
        assert update_seqs(board["id"]), "правка после снимка не попала в журнал"
        assert _late_content(guest, guest_path) == content(owner.doc)


def test_col07_late_client_after_everyone_left_gets_full_state(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str
) -> None:
    """Сжатие при уходе всех клиентов не зависит от периода; поздний клиент получает всё."""
    with peer(board_user, owner_path) as owner:
        for i in range(5):
            owner.edit(sticker(f"o{i}", f"text {i}"))
        owner.edit(move_to_trash(["o0"], "owner"))
        owner.pump(0.5)
        expected = content(owner.doc)
    time.sleep(1.5)
    assert _late_content(guest, guest_path) == expected


def test_col07_edits_across_snapshot_boundary_are_not_lost(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, interval: float
) -> None:
    sent = 0
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        deadline = time.monotonic() + 2.5 * interval
        while time.monotonic() < deadline:
            owner.edit(sticker(f"k{sent}", str(sent)))
            if sent % 3 == 0:
                other.edit(sticker(f"g{sent}", str(sent)))
            sent += 1
            owner.pump(0.05)
            other.pump(0.05)
        other.wait_for(lambda p: sum(1 for k in p.snapshot() if k.startswith("k")) == sent, timeout=10)
        owner.wait_for(lambda p: p.snapshot().keys() == other.snapshot().keys(), timeout=10)
        expected = content(owner.doc)
        assert len(snapshots(board["id"])) >= 2, "за 2.5 периода снимков меньше двух"
    with clients(guest.base_url, "late") as (late,):
        assert join(late, guest.token, "Late").status_code == 200  # type: ignore[attr-defined]
        assert _late_content(late, guest_path) == expected


def test_col07_compaction_isolated_between_boards(
    board_user: Client, board: dict[str, Any], owner_path: str, interval: float
) -> None:
    other_board = create_board(board_user, unique_title())
    other_path = channel_path(board=other_board["id"])
    with peer(board_user, owner_path) as x, peer(board_user, other_path) as y:
        x.edit(sticker("only-x", "x"))
        y.edit(sticker("only-y", "y"))
        rows_x = _wait_compacted(board["id"], 3 * interval + 5)
        rows_y = _wait_compacted(other_board["id"], 3 * interval + 5)
        assert set(content(doc_from(rows_x[-1]["state"]))["objects"]) == {"only-x"}
        assert set(content(doc_from(rows_y[-1]["state"]))["objects"]) == {"only-y"}


def test_col07_corrupted_update_stays_out_of_journal_and_snapshot(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, interval: float
) -> None:
    with peer(board_user, owner_path) as owner:
        owner.edit(sticker("ok", "valid"))
        owner.pump(0.3)
        with peer(guest, guest_path) as bad:
            journal = update_blobs(board["id"])
            bad.send_raw(frame(UPDATE, b"\xff\xfe\xfd\xfc garbage \x00\x01"))
            assert bad.close_code() == 1007
        assert update_blobs(board["id"]) in (journal, [])  # мусор не дописан (или журнал уже сжат)
        assert owner.is_open()
        owner.edit(sticker("ok2", "still works"))
        rows = _wait_compacted(board["id"], 3 * interval + 5)
        assert content(doc_from(rows[-1]["state"])) == content(owner.doc)
        assert set(content(owner.doc)["objects"]) == {"ok", "ok2"}


# --- COL-07 (основа): перезапуск api ----------------------------------------------------


def test_col07_api_restart_keeps_board_content(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, clean_stack: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("a", "alpha"))
        owner.edit(sticker("b", "beta"))
        other.wait_for(lambda p: len(p.snapshot()) == 2)
        other.edit(move_to_trash(["b"], "guest"))
        owner.wait_for(lambda p: "b" not in p.snapshot())
        owner.pump(0.3)
        expected = content(owner.doc)
        assert set(expected["trash"]) == {"b"}
        restart_api(clean_stack)
    assert _late_content(guest, guest_path) == expected
    # после перезапуска правки ходят
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("c", "after restart"))
        other.wait_for(lambda p: "c" in p.snapshot())
        expected = content(owner.doc)
    time.sleep(1.5)
    assert _late_content(guest, guest_path) == expected


def test_col07_api_crash_keeps_journal_tail(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, clean_stack: str
) -> None:
    """SIGKILL без корректного завершения: правки, ещё не вошедшие в снимок, — из журнала."""
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("k1", "one"))
        owner.edit(sticker("k2", "two"))
        other.wait_for(lambda p: len(p.snapshot()) == 2)
        expected = content(owner.doc)
        crash_api(clean_stack)
    assert _late_content(guest, guest_path) == expected
    with peer(board_user, owner_path) as owner:
        owner.edit(sticker("k3", "three"))
        owner.pump(0.3)
        expected = content(owner.doc)
    time.sleep(1.5)
    assert _late_content(guest, guest_path) == expected


# --- ARCH-T42-02: присутствие не попадает в снимок и журнал -----------------------------


def test_arch_t42_02_presence_stays_out_of_snapshot_and_journal(
    board_user: Client, guest: Client, guest_name: str, board: dict[str, Any], owner_path: str, guest_path: str,
    interval: float,
) -> None:
    marker = "qa-marker-" + uuid.uuid4().hex
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        for i in range(3):
            other.send_awareness({"cursor": {"x": 12345.5 + i, "y": -777.25}, "name": marker, "camera": {"x": 1, "y": 2, "zoom": 3}})
            owner.send_awareness({"cursor": {"x": 4321.5, "y": 99.75}, "user": {"name": marker}})
        owner.wait_presence(lambda p: any(a.get("state", {}).get("cursor") for a in p.awareness.values()))
        owner.edit(sticker("s", "plain"))
        other.wait_for(lambda p: "s" in p.snapshot())
        rows = _wait_compacted(board["id"], 3 * interval + 5)
        journal_after = update_blobs(board["id"])
    for blob in [r["state"] for r in rows] + journal_after:
        for needle in (marker, guest_name, board_user.account["name"], "cursor", "awareness", "presence", "12345.5"):  # type: ignore[attr-defined]
            assert needle.encode() not in blob, f"в снимке/журнале есть {needle!r}"
    doc = doc_from(rows[-1]["state"])
    assert set(doc.keys()) <= ALLOWED_ROOTS, doc.keys()


# --- COL-08 (основа): корзина и лента ----------------------------------------------------


def test_col08_owner_delete_moves_object_to_trash_and_logs_event(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str
) -> None:
    owner_name = board_user.account["name"]  # type: ignore[attr-defined]
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("s1", "to trash", color="yellow"))
        owner.edit(sticker("s2", "stays"))
        other.wait_for(lambda p: len(p.snapshot()) == 2)
        before = content(owner.doc)["objects"]["s1"]
        owner.edit(move_to_trash(["s1"], owner_name))
        other.wait_for(lambda p: "s1" not in p.snapshot())
        trash = content(other.doc)["trash"]
        assert set(trash) == {"s1"}
        entry = trash["s1"]
        assert entry["object"] == before
        assert entry["deletedBy"] == owner_name and entry["deletedAt"]
        assert set(content(other.doc)["objects"]) == {"s2"}
    assert _late_content(guest, guest_path)["trash"]["s1"]["object"] == before
    eventually(lambda: len(events(board["id"])) == 1, 5, f"события: {events(board['id'])}")
    (event,) = events(board["id"])
    assert event["actor_name"] == owner_name
    assert event["event_type"] == "objects_deleted"
    assert event["payload"]["object_ids"] == ["s1"]


def test_col08_participant_delete_logged_with_session_name_not_spoofed(
    board_user: Client, guest: Client, guest_name: str, board: dict[str, Any], owner_path: str, guest_path: str
) -> None:
    owner_name = board_user.account["name"]  # type: ignore[attr-defined]
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("x", "owner's object"))
        other.wait_for(lambda p: "x" in p.snapshot())
        other.edit(move_to_trash(["x"], owner_name))  # подменённый deletedBy
        owner.wait_for(lambda p: "x" not in p.snapshot())
        assert "x" in content(owner.doc)["trash"]
    eventually(lambda: len(events(board["id"])) == 1, 5, f"события: {events(board['id'])}")
    (event,) = events(board["id"])
    assert event["actor_name"] == guest_name, event
    assert event["payload"]["object_ids"] == ["x"]


def test_col08_several_objects_in_one_update(
    board_user: Client, board: dict[str, Any], owner_path: str
) -> None:
    with peer(board_user, owner_path) as owner:
        for oid in ("m1", "m2", "m3"):
            owner.edit(sticker(oid, oid))
        owner.edit(move_to_trash(["m1", "m3"], "o"))
        owner.pump(0.5)
        assert set(content(owner.doc)["trash"]) == {"m1", "m3"}
    eventually(lambda: bool(events(board["id"])), 5, "события удаления нет")
    ids = sorted(i for e in events(board["id"]) for i in e["payload"]["object_ids"])
    assert ids == ["m1", "m3"]
    assert all(e["event_type"] == "objects_deleted" for e in events(board["id"]))


def test_col08_edits_without_delete_and_repeats_give_no_events(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, clean_stack: str
) -> None:
    with peer(board_user, owner_path) as owner:
        owner.edit(sticker("e1", "text"))
        owner.edit(lambda d: d.get("objects", type=Map)["e1"].__setitem__("x", 500.0))
        owner.edit(lambda d: d.get("objects", type=Map)["e1"]["text"].insert(0, "edited "))
        owner.edit(move_to_trash(["nope"], "o"))  # несуществующий — ничего не пишет
        owner.pump(0.5)
        assert events(board["id"]) == []
        update = owner.edit(move_to_trash(["e1"], "o"))
        owner.pump(0.5)
        eventually(lambda: len(events(board["id"])) == 1, 5, f"события: {events(board['id'])}")
        owner.send_raw(frame(UPDATE, update))  # повтор того же обновления
        owner.edit(lambda d: d.get("trash", type=Map)["e1"].__setitem__("deletedBy", "changed"))
        owner.pump(0.5)
    with peer(guest, guest_path) as other:
        other.pump(0.3)
    time.sleep(1.5)
    restart_api(clean_stack)
    with peer(guest, guest_path) as other:
        other.pump(0.3)
        assert content(other.doc)["trash"]["e1"]["deletedBy"] == "changed"
    assert len(events(board["id"])) == 1, events(board["id"])


def test_col08_revoked_participant_cannot_delete(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str
) -> None:
    with peer(board_user, owner_path) as owner, peer(guest, guest_path) as other:
        owner.edit(sticker("r", "keep me"))
        other.wait_for(lambda p: "r" in p.snapshot())
        assert reset(board_user, board["id"]).status_code in (200, 204)
        assert other.close_code() == 4403
        try:
            other.edit(move_to_trash(["r"], "revoked"))
        except Exception:  # noqa: BLE001 — канал уже закрыт
            pass
        owner.pump(1.0)
        assert "r" in owner.snapshot() and not content(owner.doc)["trash"]
    assert handshake_status(guest, guest_path) != 101
    assert events(board["id"]) == []


def test_col08_trash_survives_compaction(
    board_user: Client, guest: Client, board: dict[str, Any], owner_path: str, guest_path: str, interval: float
) -> None:
    with peer(board_user, owner_path) as owner:
        owner.edit(sticker("t", "trash me"))
        owner.edit(move_to_trash(["t"], "o"))
        rows = _wait_compacted(board["id"], 3 * interval + 5)
        assert set(content(doc_from(rows[-1]["state"]))["trash"]) == {"t"}
        expected = content(owner.doc)
    assert _late_content(guest, guest_path) == expected


# --- доступ и окружение ----------------------------------------------------------------


@pytest.fixture
def other_user(admin: Client, clean_stack: str) -> Iterator[Client]:
    account = create_user(admin)
    with clients(clean_stack, "user_B") as (one,):
        assert user_login(one, account["email"], account["_password"]).status_code == 204
        yield one


def test_col07_col08_strangers_have_no_channel_or_history_routes(
    board: dict[str, Any], other_user: Client, admin: Client, client: Client, owner_path: str
) -> None:
    for who in (other_user, admin, client):
        assert handshake_status(who, owner_path) == 403, who.name
    paths = client.http.get("/api/openapi.json").json()["paths"]
    leaked = [p for p in paths if any(w in p.lower() for w in ("snapshot", "history", "trash", "event"))]
    assert leaked == [], f"в задаче не ожидались HTTP-маршруты истории: {leaked}"


def test_arch_t43_env_stack_starts_without_snapshot_interval() -> None:
    """Переменная периода снимков необязательна: процесс api стартует без неё."""
    api = container("api")
    env = {k: v for k, v in container_env(api).items() if k != "SNAPSHOT_INTERVAL_SECONDS"}
    image = docker("inspect", "-f", "{{.Config.Image}}", api).stdout.strip()
    network = next(iter(docker("inspect", "-f", "{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}", api).stdout.split()))
    name = "qa-api-" + uuid.uuid4().hex[:10]
    args = ["run", "-d", "--name", name, "--network", network]
    for key in ("PUBLIC_BASE_URL", "SECRET_KEY", "DATABASE_URL", "MEDIA_ROOT", "ADMIN_EMAIL", "ADMIN_PASSWORD", "MAX_UPLOAD_BYTES"):
        args += ["-e", f"{key}={env[key]}"]
    assert docker(*args, image).returncode == 0
    try:
        probe = (
            "import urllib.request as u\n"
            "try: print(u.urlopen('http://127.0.0.1:8000/api/health',timeout=2).status)\n"
            "except Exception: print('none')"
        )
        deadline = time.monotonic() + 60
        status = "none"
        while time.monotonic() < deadline and status != "200":
            running = docker("inspect", "-f", "{{.State.Running}}", name).stdout.strip()
            assert running == "true", docker("logs", name).stderr
            status = docker("exec", name, "python", "-c", probe, timeout=20).stdout.strip()
            time.sleep(1)
        assert status == "200", docker("logs", name).stderr
    finally:
        docker("rm", "-f", name)
