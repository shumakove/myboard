"""Приёмка T2.1 · список досок (ACC-04, BRD-01…06) и перенос ADM-05 (доски сохраняются).

Сценарии — docs/qa/reports/T2.1.md. Только публичный HTTP: `/api/boards*`, вход
`/api/login`, панель `/api/admin/*`. Изоляция проверяется двумя пользователями досок,
посторонним без сессии и сессией администратора.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from datetime import timedelta

import httpx
import pytest

from admin_helpers import create_user, patch_user
from board_helpers import (
    age_board,
    create_board,
    delete_board,
    get_board,
    ids,
    list_boards,
    recent_boards,
    rename_board,
    ts,
    unique_title,
)
from stand import Client, clients
from user_helpers import user_login

BOARD_ENDPOINTS = [
    ("GET", "/api/boards"),
    ("GET", "/api/boards/recent"),
    ("POST", "/api/boards"),
    ("GET", "/api/boards/{id}"),
    ("PATCH", "/api/boards/{id}"),
    ("DELETE", "/api/boards/{id}"),
]


def _call(client: Client, method: str, path: str, board_id: str) -> httpx.Response:
    url = path.format(id=board_id)
    body = {"title": "Hijacked " + uuid.uuid4().hex[:6]} if method in ("POST", "PATCH") else None
    return client.http.request(method, url, json=body)


@pytest.fixture
def other_user(admin: Client, clean_stack: str) -> Iterator[Client]:
    """Второй пользователь досок B."""
    account = create_user(admin)
    with clients(clean_stack, "other_user") as (one,):
        assert user_login(one, account["email"], account["_password"]).status_code == 204
        one.account = account  # type: ignore[attr-defined]
        yield one


# ---------- ACC-04 ----------


def test_acc04_new_user_has_empty_list(board_user: Client) -> None:
    assert list_boards(board_user) == []
    assert recent_boards(board_user) == []


def test_acc04_list_shows_only_own_boards(board_user: Client, other_user: Client) -> None:
    mine = [create_board(board_user, unique_title("A")) for _ in range(2)]
    theirs = create_board(other_user, unique_title("B"))
    assert set(ids(list_boards(board_user))) == set(ids(mine))
    assert set(ids(recent_boards(board_user))) == set(ids(mine))
    assert ids(list_boards(other_user)) == [theirs["id"]]
    titles = {b["title"] for b in list_boards(board_user)}
    assert titles == {b["title"] for b in mine}


def test_acc04_list_right_after_login_through_new_session(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    with clients(clean_stack, "s1", "s2") as (s1, s2):
        assert user_login(s1, account["email"], account["_password"]).status_code == 204
        board = create_board(s1, unique_title())
        assert user_login(s2, account["email"], account["_password"]).status_code == 204
        assert ids(list_boards(s2)) == [board["id"]]


@pytest.mark.parametrize(("method", "path"), BOARD_ENDPOINTS)
def test_acc04_anonymous_gets_401(client: Client, board: dict[str, str], method: str, path: str) -> None:
    resp = _call(client, method, path, board["id"])
    assert resp.status_code == 401, (resp.status_code, resp.text)


@pytest.mark.parametrize(("method", "path"), BOARD_ENDPOINTS)
def test_acc04_admin_session_gives_no_access_to_boards(
    admin: Client, board: dict[str, str], method: str, path: str
) -> None:
    resp = _call(admin, method, path, board["id"])
    assert resp.status_code in (401, 403), (resp.status_code, resp.text)


def test_acc04_board_untouched_after_foreign_attempts(
    board_user: Client, client: Client, admin: Client, board: dict[str, str]
) -> None:
    for who in (client, admin):
        for method, path in BOARD_ENDPOINTS:
            _call(who, method, path, board["id"])
    assert ids(list_boards(board_user)) == [board["id"]]
    assert get_board(board_user, board["id"]).json()["title"] == board["title"]


# ---------- BRD-01 ----------


def test_brd01_created_board_is_listed_and_opens(board_user: Client) -> None:
    title = unique_title("Created")
    board = create_board(board_user, title)
    assert board["title"] == title
    resp = get_board(board_user, board["id"])
    assert resp.status_code == 200 and resp.json()["title"] == title
    assert board["id"] in ids(list_boards(board_user))
    assert board["id"] in ids(recent_boards(board_user))


def test_brd01_create_returns_201(board_user: Client) -> None:
    resp = board_user.http.post("/api/boards", json={"title": unique_title()})
    assert resp.status_code == 201, (resp.status_code, resp.text)


def test_brd01_board_without_title_gets_nonempty_default(board_user: Client) -> None:
    board = create_board(board_user)
    assert isinstance(board["title"], str) and board["title"].strip()


def test_brd01_duplicate_titles_are_separate_boards(board_user: Client) -> None:
    title = unique_title("Twin")
    one, two = create_board(board_user, title), create_board(board_user, title)
    assert one["id"] != two["id"]
    listed = [b for b in list_boards(board_user) if b["title"] == title]
    assert len(listed) == 2


@pytest.mark.parametrize("title", ["Ретро спринта 12 — итоги", "Emoji 🚀 board", "<script>alert(1)</script>", "O'Reilly & \"Co\""])
def test_brd01_title_is_kept_verbatim(board_user: Client, title: str) -> None:
    board = create_board(board_user, title)
    assert get_board(board_user, board["id"]).json()["title"] == title
    assert any(b["title"] == title for b in list_boards(board_user))


@pytest.mark.parametrize("length", [1000, 100_000])
def test_brd01_very_long_title_is_not_a_server_error(board_user: Client, length: int) -> None:
    resp = board_user.http.post("/api/boards", json={"title": "x" * length})
    assert resp.status_code < 500, (resp.status_code, resp.text[:200])
    if resp.status_code >= 400:
        assert list_boards(board_user) == []


@pytest.mark.parametrize("body", [{"title": 123}, {"title": None}, {"title": ["a"]}])
def test_brd01_malformed_body_is_rejected_without_5xx(board_user: Client, body: dict[str, object]) -> None:
    resp = board_user.http.post("/api/boards", json=body)
    assert resp.status_code < 500, (resp.status_code, resp.text[:200])


def test_brd01_ids_are_distinct_and_not_sequential_integers(board_user: Client) -> None:
    boards = [create_board(board_user) for _ in range(3)]
    values = ids(boards)
    assert len(set(values)) == 3
    assert not all(v.isdigit() for v in values)


# ---------- BRD-02 ----------


def test_brd02_rename_is_reflected_in_list_and_by_id(board_user: Client, board: dict[str, str]) -> None:
    new_title = unique_title("Renamed")
    resp = rename_board(board_user, board["id"], new_title)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert resp.json()["title"] == new_title
    assert get_board(board_user, board["id"]).json()["title"] == new_title
    listed = {b["id"]: b["title"] for b in list_boards(board_user)}
    assert listed[board["id"]] == new_title
    assert {b["id"]: b["title"] for b in recent_boards(board_user)}[board["id"]] == new_title


def test_brd02_rename_persists_for_another_session(
    admin: Client, clean_stack: str
) -> None:
    account = create_user(admin)
    with clients(clean_stack, "s1", "s2") as (s1, s2):
        assert user_login(s1, account["email"], account["_password"]).status_code == 204
        board = create_board(s1, unique_title())
        new_title = unique_title("Persisted")
        assert rename_board(s1, board["id"], new_title).status_code == 200
        assert user_login(s2, account["email"], account["_password"]).status_code == 204
        assert {b["id"]: b["title"] for b in list_boards(s2)}[board["id"]] == new_title


def test_brd02_other_user_cannot_rename(
    board_user: Client, other_user: Client, client: Client, board: dict[str, str]
) -> None:
    for who in (other_user, client):
        resp = rename_board(who, board["id"], "Hijacked")
        assert resp.status_code in (401, 403, 404), (resp.status_code, resp.text)
    assert get_board(board_user, board["id"]).json()["title"] == board["title"]


@pytest.mark.parametrize("title", ["", "   ", "\t\n"])
def test_brd02_blank_title_does_not_leave_board_without_name(
    board_user: Client, board: dict[str, str], title: str
) -> None:
    resp = rename_board(board_user, board["id"], title)
    assert resp.status_code < 500, (resp.status_code, resp.text)
    stored = get_board(board_user, board["id"]).json()["title"]
    assert stored.strip(), f"после переименования в {title!r} у доски пустое название ({resp.status_code})"


def test_brd02_rename_deleted_board_is_404(board_user: Client, board: dict[str, str]) -> None:
    assert delete_board(board_user, board["id"]).status_code in (200, 204)
    assert rename_board(board_user, board["id"], "Ghost").status_code == 404


# ---------- BRD-03 ----------


def test_brd03_deleted_board_leaves_lists_and_cannot_be_opened(board_user: Client) -> None:
    keep = create_board(board_user, unique_title("Keep"))
    gone = create_board(board_user, unique_title("Gone"))
    resp = delete_board(board_user, gone["id"])
    assert resp.status_code in (200, 204), (resp.status_code, resp.text)
    assert ids(list_boards(board_user)) == [keep["id"]]
    assert ids(recent_boards(board_user)) == [keep["id"]]
    assert get_board(board_user, gone["id"]).status_code == 404
    assert list_boards(board_user, q=gone["title"]) == []
    assert get_board(board_user, keep["id"]).status_code == 200


def test_brd03_delete_twice_and_missing_is_404(board_user: Client, board: dict[str, str]) -> None:
    assert delete_board(board_user, board["id"]).status_code in (200, 204)
    assert delete_board(board_user, board["id"]).status_code == 404
    assert delete_board(board_user, str(uuid.uuid4())).status_code == 404


def test_brd03_other_user_cannot_delete(
    board_user: Client, other_user: Client, client: Client, board: dict[str, str]
) -> None:
    for who in (other_user, client):
        resp = delete_board(who, board["id"])
        assert resp.status_code in (401, 403, 404), (resp.status_code, resp.text)
    assert ids(list_boards(board_user)) == [board["id"]]


# ---------- BRD-04 ----------


def test_brd04_recent_newest_first_and_subset_of_full_list(board_user: Client) -> None:
    created = []
    for i in range(3):
        created.append(create_board(board_user, unique_title(f"R{i}")))
        time.sleep(0.05)
    recent = recent_boards(board_user)
    assert ids(recent)[:3] == [b["id"] for b in reversed(created)]
    stamps = [ts(b["updated_at"]) for b in recent]
    assert stamps == sorted(stamps, reverse=True)
    assert set(ids(recent)) <= set(ids(list_boards(board_user)))


def test_brd04_full_list_shows_all_boards_beyond_recent_block(board_user: Client) -> None:
    created = [create_board(board_user, unique_title(f"N{i}")) for i in range(12)]
    full = list_boards(board_user)
    recent = recent_boards(board_user)
    assert set(ids(full)) == set(ids(created))
    assert 0 < len(recent) < len(full), "недавние должны быть подмножеством, а полный список — все 12"
    newest_first = [b["id"] for b in reversed(created)]
    assert ids(recent) == newest_first[: len(recent)]


def test_brd04_recent_follows_last_change_not_creation(board_user: Client) -> None:
    old = create_board(board_user, unique_title("Old"))
    time.sleep(0.05)
    new = create_board(board_user, unique_title("New"))
    age_board(new["id"], days=3)
    age_board(old["id"], days=1)
    assert ids(recent_boards(board_user))[:2] == [old["id"], new["id"]]


def test_brd04_rename_moves_board_to_top_of_recent(board_user: Client) -> None:
    """Фиксация: переименование — изменение доски (handoff: двигает `updated_at`)."""
    first = create_board(board_user, unique_title("First"))
    time.sleep(0.05)
    create_board(board_user, unique_title("Second"))
    time.sleep(0.05)
    assert rename_board(board_user, first["id"], unique_title("First renamed")).status_code == 200
    assert ids(recent_boards(board_user))[0] == first["id"]


def test_brd04_recent_of_other_user_excludes_my_boards(board_user: Client, other_user: Client) -> None:
    create_board(board_user, unique_title())
    assert recent_boards(other_user) == []


# ---------- BRD-05 ----------


def _three_boards(user: Client) -> list[dict[str, str]]:
    boards = []
    for title in ("banana plan", "Apple roadmap", "cherry retro"):
        boards.append(create_board(user, f"{title} {uuid.uuid4().hex[:4]}"))
        time.sleep(0.05)
    return boards


def test_brd05_sort_by_title(board_user: Client) -> None:
    _three_boards(board_user)
    titles = [b["title"] for b in list_boards(board_user, sort="title")]
    assert titles == sorted(titles, key=str.casefold), titles


def test_brd05_sort_by_creation_date(board_user: Client) -> None:
    boards = _three_boards(board_user)
    rename_board(board_user, boards[0]["id"], "zzz renamed")  # меняет дату изменения, но не создания
    listed = list_boards(board_user, sort="created")
    stamps = [ts(b["created_at"]) for b in listed]
    assert stamps == sorted(stamps, reverse=True) or stamps == sorted(stamps)
    assert ids(listed) in ([b["id"] for b in reversed(boards)], ids(boards))


def test_brd05_sort_by_last_modified(board_user: Client) -> None:
    boards = _three_boards(board_user)
    time.sleep(0.05)
    rename_board(board_user, boards[0]["id"], "touched " + uuid.uuid4().hex[:4])
    listed = list_boards(board_user, sort="updated")
    assert ids(listed)[0] == boards[0]["id"]
    stamps = [ts(b["updated_at"]) for b in listed]
    assert stamps == sorted(stamps, reverse=True)


def test_brd05_default_order_is_last_modified(board_user: Client) -> None:
    boards = _three_boards(board_user)
    assert ids(list_boards(board_user)) == [b["id"] for b in reversed(boards)]


def test_brd05_filter_by_modified_since(board_user: Client) -> None:
    fresh = create_board(board_user, unique_title("Fresh"))
    week = create_board(board_user, unique_title("Week"))
    old = create_board(board_user, unique_title("Old"))
    age_board(week["id"], days=3)
    age_board(old["id"], days=40)
    now = ts(fresh["updated_at"])

    def since(delta: timedelta) -> set[str]:
        return set(ids(list_boards(board_user, modified_since=(now - delta).isoformat())))

    assert since(timedelta(hours=24)) == {fresh["id"]}
    assert since(timedelta(days=7)) == {fresh["id"], week["id"]}
    assert since(timedelta(days=30)) == {fresh["id"], week["id"]}
    assert set(ids(list_boards(board_user))) == {fresh["id"], week["id"], old["id"]}


def test_brd05_filter_and_sort_and_search_combine(board_user: Client) -> None:
    tag = uuid.uuid4().hex[:6]
    a = create_board(board_user, f"beta {tag}")
    b = create_board(board_user, f"alpha {tag}")
    old = create_board(board_user, f"gamma {tag}")
    create_board(board_user, "unrelated")
    age_board(old["id"], days=10)
    week_ago = (ts(a["updated_at"]) - timedelta(days=7)).isoformat()
    listed = list_boards(board_user, q=tag, sort="title", modified_since=week_ago)
    assert ids(listed) == [b["id"], a["id"]]


@pytest.mark.parametrize("params", [{"sort": "bogus"}, {"modified_since": "not-a-date"}, {"sort": "title; DROP TABLE boards"}])
def test_brd05_invalid_params_are_4xx(board_user: Client, params: dict[str, str]) -> None:
    resp = board_user.http.get("/api/boards", params=params)
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)


def test_brd05_sort_and_filter_never_return_foreign_boards(board_user: Client, other_user: Client) -> None:
    create_board(other_user, unique_title("Foreign"))
    mine = create_board(board_user, unique_title("Mine"))
    for sort in ("updated", "created", "title"):
        assert ids(list_boards(board_user, sort=sort)) == [mine["id"]]
    assert ids(list_boards(board_user, modified_since="2000-01-01T00:00:00+00:00")) == [mine["id"]]


# ---------- BRD-06 ----------


def test_brd06_search_by_any_part_ignoring_case(board_user: Client) -> None:
    tag = uuid.uuid4().hex[:6]
    target = create_board(board_user, f"Quarterly Retro {tag} Notes")
    create_board(board_user, f"Roadmap {uuid.uuid4().hex[:6]}")
    for query in ("quarterly", "RETRO", f"{tag} notes", "notes", "rly Re"):
        assert ids(list_boards(board_user, q=query)) == [target["id"]], query


def test_brd06_search_cyrillic_ignoring_case(board_user: Client) -> None:
    target = create_board(board_user, "Ретроспектива Ёлки " + uuid.uuid4().hex[:4])
    create_board(board_user, "План " + uuid.uuid4().hex[:4])
    for query in ("ретро", "РЕТРОСПЕКТИВА", "ёлки", "ЁЛК"):
        assert ids(list_boards(board_user, q=query)) == [target["id"]], query


def test_brd06_no_match_gives_empty_list(board_user: Client) -> None:
    create_board(board_user, unique_title())
    assert list_boards(board_user, q="no-such-board-" + uuid.uuid4().hex) == []


def test_brd06_empty_query_returns_all(board_user: Client) -> None:
    boards = [create_board(board_user, unique_title()) for _ in range(2)]
    assert set(ids(list_boards(board_user, q=""))) == set(ids(boards))


def test_brd06_query_is_trimmed_or_matches_literally(board_user: Client) -> None:
    target = create_board(board_user, "Design sync " + uuid.uuid4().hex[:4])
    assert ids(list_boards(board_user, q="  design  ")) == [target["id"]]


@pytest.mark.parametrize("wild", ["%", "_", "\\", "'", "%'--", "[a]"])
def test_brd06_special_characters_are_literal(board_user: Client, wild: str) -> None:
    plain = create_board(board_user, "plain board " + uuid.uuid4().hex[:4])
    special = create_board(board_user, f"odd {wild} title")
    resp = board_user.http.get("/api/boards", params={"q": wild})
    assert resp.status_code == 200, (resp.status_code, resp.text)
    found = ids(resp.json())
    assert special["id"] in found
    assert plain["id"] not in found


def test_brd06_search_never_finds_foreign_boards(board_user: Client, other_user: Client) -> None:
    foreign = create_board(other_user, "Secret merger " + uuid.uuid4().hex[:6])
    assert list_boards(board_user, q="secret merger") == []
    assert list_boards(board_user, q=foreign["title"]) == []


def test_brd06_search_on_recent_is_not_required_but_full_search_finds_old_boards(board_user: Client) -> None:
    target = create_board(board_user, "Ancient archive " + uuid.uuid4().hex[:4])
    for _ in range(10):
        create_board(board_user, unique_title())
    assert target["id"] not in ids(recent_boards(board_user))
    assert ids(list_boards(board_user, q="ancient archive")) == [target["id"]]


# ---------- Изоляция ----------


def test_isolation_other_user_cannot_open_by_id(board_user: Client, other_user: Client, board: dict[str, str]) -> None:
    foreign = get_board(other_user, board["id"])
    missing = get_board(other_user, str(uuid.uuid4()))
    assert foreign.status_code == 404, (foreign.status_code, foreign.text)
    assert board["title"] not in foreign.text
    # Ответ на чужую доску не отличается от ответа на несуществующую.
    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())


@pytest.mark.parametrize("bad_id", ["not-a-uuid", "1", "0" * 300, "00000000-0000-0000-0000-00000000000g"])
def test_isolation_malformed_id_is_not_a_server_error(board_user: Client, bad_id: str) -> None:
    for method in ("GET", "PATCH", "DELETE"):
        resp = board_user.http.request(method, f"/api/boards/{bad_id}", json={"title": "x"} if method == "PATCH" else None)
        assert resp.status_code < 500 and resp.status_code != 200, (method, bad_id, resp.status_code)


# ---------- ADM-05 ----------


def test_adm05_disabled_user_boards_survive(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    with clients(clean_stack, "before", "during", "after") as (before, during, after):
        assert user_login(before, account["email"], account["_password"]).status_code == 204
        boards = [create_board(before, unique_title("Keep")) for _ in range(3)]
        rename_board(before, boards[0]["id"], "Renamed before disable")
        expected = {b["id"]: b["title"] for b in list_boards(before)}

        assert patch_user(admin, account["id"], disabled=True).status_code == 200
        assert before.http.get("/api/boards").status_code == 401
        assert user_login(during, account["email"], account["_password"]).status_code == 401
        assert during.http.get("/api/boards").status_code == 401

        assert patch_user(admin, account["id"], disabled=False).status_code == 200
        assert user_login(after, account["email"], account["_password"]).status_code == 204
        assert {b["id"]: b["title"] for b in list_boards(after)} == expected
        for board_id in expected:
            assert get_board(after, board_id).status_code == 200


# ---------- Архитектура ----------


def test_arch_t21_board_endpoints_published_in_openapi(clean_stack: str) -> None:
    spec = httpx.get(clean_stack + "/api/openapi.json", timeout=10.0).json()
    paths = spec["paths"]
    assert {"get", "post"} <= set(paths["/api/boards"])
    assert "get" in paths["/api/boards/recent"]
    item = next(p for p in paths if p.startswith("/api/boards/{"))
    assert {"get", "patch", "delete"} <= set(paths[item])
