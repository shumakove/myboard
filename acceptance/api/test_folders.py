"""Приёмка T2.2 · папки и избранное (BRD-07, BRD-09, BRD-10, BRD-06 — поиск папок).

Сценарии — docs/qa/reports/T2.2.md. Только публичный HTTP. Доступ проверяется
пользователями досок A и B, посторонним без сессии и сессией администратора.
BRD-11 (сворачивание в боковом списке) — только интерфейс, см. acceptance/e2e/folders.spec.ts.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest

from admin_helpers import create_user
from board_helpers import create_board, delete_board, ids, list_boards, recent_boards, unique_title
from folder_helpers import (
    board_by_id,
    children_order,
    create_folder,
    favorite,
    folders_by_id,
    list_folders,
    move_board,
    move_folder,
    raw_create_folder,
    unique_folder,
)
from stand import Client, clients
from user_helpers import user_login

NEW_ENDPOINTS = [
    ("GET", "/api/folders", None),
    ("POST", "/api/folders", {"title": "Hijack"}),
    ("PUT", "/api/folders/{folder}/position", {"parent_id": None, "position": 0}),
    ("PUT", "/api/folders/{folder}/favorite", None),
    ("DELETE", "/api/folders/{folder}/favorite", None),
    ("PUT", "/api/boards/{board}/folder", {"folder_id": None}),
    ("PUT", "/api/boards/{board}/favorite", None),
    ("DELETE", "/api/boards/{board}/favorite", None),
]


@pytest.fixture
def other_user(admin: Client, clean_stack: str) -> Iterator[Client]:
    """Второй пользователь досок B."""
    account = create_user(admin)
    with clients(clean_stack, "other_user") as (one,):
        assert user_login(one, account["email"], account["_password"]).status_code == 204
        one.account = account  # type: ignore[attr-defined]
        yield one


def _is_refused(resp: httpx.Response) -> bool:
    return resp.status_code in (403, 404)


def _fav_folders(client: Client) -> set[str]:
    return {f["id"] for f in list_folders(client) if f.get("favorite")}


def _fav_boards(client: Client) -> set[str]:
    return {b["id"] for b in list_boards(client) if b.get("favorite")}


def _tree_snapshot(client: Client) -> set[tuple[str, Any, Any]]:
    return {(f["id"], f["parent_id"], f["position"]) for f in list_folders(client)}


# ---------- BRD-09: создание и вложение папок ----------


def test_brd09_new_user_has_no_folders(board_user: Client) -> None:
    assert list_folders(board_user) == []


def test_brd09_three_levels_folder_in_folder_in_folder(board_user: Client) -> None:
    top = create_folder(board_user, unique_folder("Top"))
    mid = create_folder(board_user, unique_folder("Mid"), top["id"])
    low = create_folder(board_user, unique_folder("Low"), mid["id"])
    assert top["parent_id"] is None
    assert mid["parent_id"] == top["id"]
    assert low["parent_id"] == mid["id"]
    tree = folders_by_id(board_user)
    assert set(tree) == {top["id"], mid["id"], low["id"]}
    assert tree[low["id"]]["parent_id"] == mid["id"]
    assert tree[mid["id"]]["parent_id"] == top["id"]
    assert tree[top["id"]]["title"] == top["title"]


def test_brd09_depth_ten_is_accepted(board_user: Client) -> None:
    parent: str | None = None
    made = []
    for level in range(10):
        folder = create_folder(board_user, f"Level {level}", parent)
        made.append(folder["id"])
        parent = folder["id"]
    tree = folders_by_id(board_user)
    for upper, lower in zip(made, made[1:], strict=False):
        assert tree[lower]["parent_id"] == upper


def test_brd09_folder_visible_in_another_session(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    with clients(clean_stack, "s1", "s2") as (s1, s2):
        assert user_login(s1, account["email"], account["_password"]).status_code == 204
        assert user_login(s2, account["email"], account["_password"]).status_code == 204
        folder = create_folder(s1)
        assert [f["id"] for f in list_folders(s2)] == [folder["id"]]


@pytest.mark.parametrize("title", ["Проекты 2026", "Идеи 🚀", "<b>bold</b> & 'q' \"dq\""])
def test_brd09_title_kept_as_is(board_user: Client, title: str) -> None:
    folder = create_folder(board_user, title)
    assert folder["title"] == title
    assert folders_by_id(board_user)[folder["id"]]["title"] == title


@pytest.mark.parametrize("title", ["", "   ", "x" * 1000, None, 123, ["a"]])
def test_brd09_bad_title_is_4xx_not_5xx(board_user: Client, title: Any) -> None:
    resp = raw_create_folder(board_user, title)
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)
    assert list_folders(board_user) == []


def test_brd09_unknown_parent_is_refused(board_user: Client) -> None:
    resp = raw_create_folder(board_user, "Orphan", str(uuid.uuid4()))
    assert _is_refused(resp), (resp.status_code, resp.text)
    resp = raw_create_folder(board_user, "Orphan", "not-a-uuid")
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)
    assert list_folders(board_user) == []


def test_brd09_other_user_does_not_see_folders(board_user: Client, other_user: Client) -> None:
    mine = create_folder(board_user)
    create_folder(board_user, parent_id=mine["id"])
    assert list_folders(other_user) == []
    theirs = create_folder(other_user)
    assert {f["id"] for f in list_folders(board_user)}.isdisjoint({theirs["id"]})


def test_brd09_other_user_cannot_create_inside_foreign_folder(board_user: Client, other_user: Client) -> None:
    mine = create_folder(board_user)
    resp = raw_create_folder(other_user, "Intruder", mine["id"])
    assert _is_refused(resp), (resp.status_code, resp.text)
    assert list(folders_by_id(board_user)) == [mine["id"]]
    assert list_folders(other_user) == []


def test_brd09_foreign_and_missing_parent_look_the_same(board_user: Client, other_user: Client) -> None:
    mine = create_folder(board_user)
    foreign = raw_create_folder(other_user, "x", mine["id"])
    missing = raw_create_folder(other_user, "x", str(uuid.uuid4()))
    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())


def test_brd09_new_folders_keep_creation_order(board_user: Client) -> None:
    made = [create_folder(board_user, f"N{i}")["id"] for i in range(4)]
    assert children_order(board_user, None) == made


# ---------- BRD-10: порядок, вложение, перенос досок ----------


def test_brd10_reorder_siblings_persists(board_user: Client) -> None:
    a, b, c = (create_folder(board_user, t)["id"] for t in ("A", "B", "C"))
    resp = move_folder(board_user, c, None, 0)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert children_order(board_user, None) == [c, a, b]
    assert move_folder(board_user, c, None, 2).status_code == 200
    assert children_order(board_user, None) == [a, b, c]
    assert move_folder(board_user, a, None, 1).status_code == 200
    assert children_order(board_user, None) == [b, a, c]


def test_brd10_reorder_inside_nested_level(board_user: Client) -> None:
    parent = create_folder(board_user)["id"]
    x, y = (create_folder(board_user, t, parent)["id"] for t in ("X", "Y"))
    assert move_folder(board_user, y, parent, 0).status_code == 200
    assert children_order(board_user, parent) == [y, x]


def test_brd10_nest_folder_and_move_back_to_root(board_user: Client) -> None:
    home = create_folder(board_user, "Home")["id"]
    work = create_folder(board_user, "Work")["id"]
    inner = create_folder(board_user, "Inner", work)["id"]
    board = create_board(board_user, unique_title())
    assert move_board(board_user, board["id"], inner).status_code == 200
    # Work со всем поддеревом — внутрь Home.
    assert move_folder(board_user, work, home, 0).status_code == 200
    tree = folders_by_id(board_user)
    assert tree[work]["parent_id"] == home
    assert tree[inner]["parent_id"] == work
    assert board_by_id(board_user, board["id"])["folder_id"] == inner
    assert children_order(board_user, None) == [home]
    # И обратно на верхний уровень.
    assert move_folder(board_user, work, None, 0).status_code == 200
    assert children_order(board_user, None) == [work, home]
    assert folders_by_id(board_user)[inner]["parent_id"] == work


def test_brd10_move_board_into_between_and_out_of_folders(board_user: Client) -> None:
    f1 = create_folder(board_user)["id"]
    f2 = create_folder(board_user)["id"]
    board = create_board(board_user, unique_title())
    assert board_by_id(board_user, board["id"]).get("folder_id") is None
    resp = move_board(board_user, board["id"], f1)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert board_by_id(board_user, board["id"])["folder_id"] == f1
    assert move_board(board_user, board["id"], f2).status_code == 200
    assert board_by_id(board_user, board["id"])["folder_id"] == f2
    assert move_board(board_user, board["id"], None).status_code == 200
    assert board_by_id(board_user, board["id"])["folder_id"] is None


def test_brd10_board_in_folder_stays_in_full_list_recent_and_search(board_user: Client) -> None:
    folder = create_folder(board_user)["id"]
    title = unique_title("Foldered")
    board = create_board(board_user, title)
    assert move_board(board_user, board["id"], folder).status_code == 200
    assert board["id"] in ids(list_boards(board_user))
    assert board["id"] in ids(recent_boards(board_user))
    assert ids(list_boards(board_user, q=title)) == [board["id"]]
    listed = {b["id"]: b for b in list_boards(board_user)}
    assert listed[board["id"]]["folder_id"] == folder


def test_brd10_move_visible_in_another_session(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    with clients(clean_stack, "s1", "s2") as (s1, s2):
        assert user_login(s1, account["email"], account["_password"]).status_code == 204
        assert user_login(s2, account["email"], account["_password"]).status_code == 204
        a = create_folder(s1)["id"]
        b = create_folder(s1)["id"]
        board = create_board(s1, unique_title())
        assert move_folder(s1, b, None, 0).status_code == 200
        assert move_board(s1, board["id"], a).status_code == 200
        assert children_order(s2, None) == [b, a]
        assert board_by_id(s2, board["id"])["folder_id"] == a


@pytest.mark.parametrize("target", ["self", "child", "grandchild"])
def test_brd10_cycle_is_refused_and_tree_unchanged(board_user: Client, target: str) -> None:
    top = create_folder(board_user)["id"]
    child = create_folder(board_user, parent_id=top)["id"]
    grandchild = create_folder(board_user, parent_id=child)["id"]
    before = _tree_snapshot(board_user)
    dest = {"self": top, "child": child, "grandchild": grandchild}[target]
    resp = move_folder(board_user, top, dest, 0)
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)
    assert _tree_snapshot(board_user) == before


def test_brd10_move_to_missing_folder_is_refused(board_user: Client) -> None:
    folder = create_folder(board_user)["id"]
    board = create_board(board_user, unique_title())
    before = _tree_snapshot(board_user)
    resp = move_folder(board_user, folder, str(uuid.uuid4()), 0)
    assert _is_refused(resp), (resp.status_code, resp.text)
    resp = move_board(board_user, board["id"], str(uuid.uuid4()))
    assert _is_refused(resp), (resp.status_code, resp.text)
    assert _tree_snapshot(board_user) == before
    assert board_by_id(board_user, board["id"]).get("folder_id") is None


@pytest.mark.parametrize("position", [-1, "abc", None, 1.5])
def test_brd10_bad_position_is_4xx_not_5xx(board_user: Client, position: Any) -> None:
    folder = create_folder(board_user)["id"]
    create_folder(board_user)
    before = _tree_snapshot(board_user)
    resp = move_folder(board_user, folder, None, position)
    assert 400 <= resp.status_code < 500 or resp.status_code == 200, (resp.status_code, resp.text)
    if resp.status_code != 200:
        assert _tree_snapshot(board_user) == before


def test_brd10_position_past_end_is_not_5xx(board_user: Client) -> None:
    a = create_folder(board_user)["id"]
    b = create_folder(board_user)["id"]
    resp = move_folder(board_user, a, None, 99)
    assert resp.status_code < 500, (resp.status_code, resp.text)
    if resp.status_code == 200:
        assert children_order(board_user, None) == [b, a]


def test_brd10_moving_deleted_board_is_404(board_user: Client) -> None:
    folder = create_folder(board_user)["id"]
    board = create_board(board_user, unique_title())
    assert delete_board(board_user, board["id"]).status_code in (200, 204)
    assert move_board(board_user, board["id"], folder).status_code == 404


def test_brd10_other_user_cannot_move_foreign_items(board_user: Client, other_user: Client) -> None:
    a_folder = create_folder(board_user)["id"]
    a_second = create_folder(board_user)["id"]
    a_board = create_board(board_user, unique_title("A"))
    b_folder = create_folder(other_user)["id"]
    b_board = create_board(other_user, unique_title("B"))
    before_a = _tree_snapshot(board_user)
    before_b = _tree_snapshot(other_user)

    attempts = [
        move_board(other_user, a_board["id"], b_folder),  # доска A — в папку B
        move_board(other_user, b_board["id"], a_folder),  # доска B — в папку A
        move_board(other_user, a_board["id"], None),  # доска A — куда угодно
        move_folder(other_user, a_folder, None, 1),  # папка A — порядок
        move_folder(other_user, a_folder, b_folder, 0),  # папка A — в папку B
        move_folder(other_user, b_folder, a_folder, 0),  # папка B — в папку A
        move_folder(board_user, a_second, b_folder, 0),  # A кладёт свою папку в папку B
        move_board(board_user, a_board["id"], b_folder),  # A кладёт свою доску в папку B
    ]
    for resp in attempts:
        assert _is_refused(resp), (resp.request.url, resp.status_code, resp.text)
    assert _tree_snapshot(board_user) == before_a
    assert _tree_snapshot(other_user) == before_b
    assert board_by_id(board_user, a_board["id"]).get("folder_id") is None
    assert board_by_id(other_user, b_board["id"]).get("folder_id") is None


def test_brd10_foreign_and_missing_targets_look_the_same(board_user: Client, other_user: Client) -> None:
    a_folder = create_folder(board_user)["id"]
    b_board = create_board(other_user, unique_title("B"))
    foreign = move_board(other_user, b_board["id"], a_folder)
    missing = move_board(other_user, b_board["id"], str(uuid.uuid4()))
    assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())


def test_brd10_moving_board_keeps_recent_order(board_user: Client) -> None:
    folder = create_folder(board_user)["id"]
    older = create_board(board_user, unique_title("older"))
    newer = create_board(board_user, unique_title("newer"))
    assert ids(recent_boards(board_user))[:2] == [newer["id"], older["id"]]
    assert move_board(board_user, older["id"], folder).status_code == 200
    # Фиксация (handoff: перенос — раскладка, а не правка доски): порядок недавних не меняется.
    assert ids(recent_boards(board_user))[:2] == [newer["id"], older["id"]]


# ---------- BRD-07: избранное ----------


def test_brd07_board_add_and_remove_favorite(board_user: Client) -> None:
    board = create_board(board_user, unique_title())
    other = create_board(board_user, unique_title())
    assert _fav_boards(board_user) == set()
    resp = favorite(board_user, "board", board["id"])
    assert resp.status_code in (200, 204), (resp.status_code, resp.text)
    assert _fav_boards(board_user) == {board["id"]}
    assert board_by_id(board_user, board["id"])["favorite"] is True
    resp = favorite(board_user, "board", board["id"], on=False)
    assert resp.status_code in (200, 204), (resp.status_code, resp.text)
    assert _fav_boards(board_user) == set()
    assert set(ids(list_boards(board_user))) == {board["id"], other["id"]}


def test_brd07_folder_add_and_remove_favorite(board_user: Client) -> None:
    folder = create_folder(board_user)["id"]
    child = create_folder(board_user, parent_id=folder)["id"]
    board = create_board(board_user, unique_title())
    assert move_board(board_user, board["id"], folder).status_code == 200
    assert favorite(board_user, "folder", folder).status_code in (200, 204)
    assert _fav_folders(board_user) == {folder}
    assert favorite(board_user, "folder", folder, on=False).status_code in (200, 204)
    assert _fav_folders(board_user) == set()
    tree = folders_by_id(board_user)
    assert set(tree) == {folder, child}
    assert board_by_id(board_user, board["id"])["folder_id"] == folder


def test_brd07_nested_folder_and_foldered_board_can_be_favorites(board_user: Client) -> None:
    top = create_folder(board_user)["id"]
    deep = create_folder(board_user, parent_id=create_folder(board_user, parent_id=top)["id"])["id"]
    board = create_board(board_user, unique_title())
    assert move_board(board_user, board["id"], deep).status_code == 200
    assert favorite(board_user, "folder", deep).status_code in (200, 204)
    assert favorite(board_user, "board", board["id"]).status_code in (200, 204)
    assert _fav_folders(board_user) == {deep}
    assert _fav_boards(board_user) == {board["id"]}


def test_brd07_repeat_add_and_remove_are_idempotent(board_user: Client) -> None:
    board = create_board(board_user, unique_title())
    folder = create_folder(board_user)["id"]
    for kind, target in (("board", board["id"]), ("folder", folder)):
        assert favorite(board_user, kind, target, on=False).status_code in (200, 204, 404)
        assert favorite(board_user, kind, target).status_code in (200, 204)
        assert favorite(board_user, kind, target).status_code in (200, 204)
    assert _fav_boards(board_user) == {board["id"]}
    assert _fav_folders(board_user) == {folder}
    assert len(list_folders(board_user)) == 1
    assert len(list_boards(board_user)) == 1
    for kind, target in (("board", board["id"]), ("folder", folder)):
        assert favorite(board_user, kind, target, on=False).status_code in (200, 204)
        assert favorite(board_user, kind, target, on=False).status_code in (200, 204, 404)
    assert _fav_boards(board_user) == set()
    assert _fav_folders(board_user) == set()


@pytest.mark.parametrize("kind", ["board", "folder"])
def test_brd07_missing_target_is_404(board_user: Client, kind: str) -> None:
    resp = favorite(board_user, kind, str(uuid.uuid4()))
    assert resp.status_code == 404, (resp.status_code, resp.text)
    resp = favorite(board_user, kind, "not-a-uuid")
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)


def test_brd07_deleted_board_leaves_favorites(board_user: Client) -> None:
    board = create_board(board_user, unique_title())
    assert favorite(board_user, "board", board["id"]).status_code in (200, 204)
    assert delete_board(board_user, board["id"]).status_code in (200, 204)
    assert _fav_boards(board_user) == set()
    assert favorite(board_user, "board", board["id"]).status_code == 404


def test_brd07_favorite_is_per_user_and_foreign_is_refused(board_user: Client, other_user: Client) -> None:
    a_board = create_board(board_user, unique_title("A"))
    a_folder = create_folder(board_user)["id"]
    for kind, target in (("board", a_board["id"]), ("folder", a_folder)):
        resp = favorite(other_user, kind, target)
        assert _is_refused(resp), (kind, resp.status_code, resp.text)
    assert _fav_boards(board_user) == set()
    assert _fav_folders(board_user) == set()
    # Избранное A не видно B и не снимается B.
    assert favorite(board_user, "board", a_board["id"]).status_code in (200, 204)
    assert favorite(board_user, "folder", a_folder).status_code in (200, 204)
    assert list_folders(other_user) == []
    assert list_boards(other_user) == []
    for kind, target in (("board", a_board["id"]), ("folder", a_folder)):
        assert _is_refused(favorite(other_user, kind, target, on=False))
    assert _fav_boards(board_user) == {a_board["id"]}
    assert _fav_folders(board_user) == {a_folder}


def test_brd07_favorite_survives_new_session(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    with clients(clean_stack, "s1", "s2") as (s1, s2):
        assert user_login(s1, account["email"], account["_password"]).status_code == 204
        board = create_board(s1, unique_title())
        folder = create_folder(s1)["id"]
        assert favorite(s1, "board", board["id"]).status_code in (200, 204)
        assert favorite(s1, "folder", folder).status_code in (200, 204)
        assert user_login(s2, account["email"], account["_password"]).status_code == 204
        assert _fav_boards(s2) == {board["id"]}
        assert _fav_folders(s2) == {folder}


# ---------- BRD-06: поиск папок ----------


@pytest.mark.parametrize("query", ["alpha", "ALPHA", "Proj", "ects Al", "pha"])
def test_brd06_folder_search_by_part_of_title(board_user: Client, query: str) -> None:
    work = create_folder(board_user, "Work")["id"]
    target = create_folder(board_user, "Projects Alpha", work)["id"]
    create_folder(board_user, "Beta")
    found = [f["id"] for f in list_folders(board_user, q=query)]
    assert found == [target], (query, found)


def test_brd06_folder_search_cyrillic_case_insensitive(board_user: Client) -> None:
    target = create_folder(board_user, "Проекты Ёлки")["id"]
    create_folder(board_user, "Прочее")
    assert [f["id"] for f in list_folders(board_user, q="ПРОЕКТЫ")] == [target]
    assert [f["id"] for f in list_folders(board_user, q="ёлки")] == [target]


def test_brd06_folder_search_finds_deeply_nested(board_user: Client) -> None:
    parent = None
    for i in range(4):
        parent = create_folder(board_user, f"Level {i}", parent)["id"]
    target = create_folder(board_user, "Needle deep", parent)["id"]
    assert [f["id"] for f in list_folders(board_user, q="needle")] == [target]


def test_brd06_folder_search_no_match_is_empty(board_user: Client) -> None:
    create_folder(board_user, "Something")
    assert list_folders(board_user, q="zzz-nothing-" + uuid.uuid4().hex[:6]) == []


@pytest.mark.parametrize("special", ["%", "_", "\\", "'", "[a]"])
def test_brd06_folder_search_special_chars_literal(board_user: Client, special: str) -> None:
    plain = create_folder(board_user, "plain name")["id"]
    target = create_folder(board_user, f"odd {special} name")["id"]
    found = [f["id"] for f in list_folders(board_user, q=special)]
    assert found == [target], (special, found)
    assert plain not in found


def test_brd06_empty_query_returns_all_folders(board_user: Client) -> None:
    made = {create_folder(board_user)["id"] for _ in range(3)}
    assert {f["id"] for f in list_folders(board_user, q="")} == made


def test_brd06_folder_search_does_not_find_foreign(board_user: Client, other_user: Client) -> None:
    title = unique_folder("Secret")
    create_folder(board_user, title)
    assert list_folders(other_user, q=title) == []
    assert list_folders(other_user, q="Secret") == []


# ---------- доступ: посторонний и администратор ----------


def _call(client: Client, method: str, path: str, body: Any, folder: str, board: str) -> httpx.Response:
    return client.http.request(method, path.format(folder=folder, board=board), json=body)


@pytest.mark.parametrize(("method", "path", "body"), NEW_ENDPOINTS)
def test_access_anonymous_gets_401(client: Client, board_user: Client, method: str, path: str, body: Any) -> None:
    folder = create_folder(board_user)["id"]
    board = create_board(board_user, unique_title())["id"]
    before = _tree_snapshot(board_user)
    resp = _call(client, method, path, body, folder, board)
    assert resp.status_code == 401, (resp.status_code, resp.text)
    assert _tree_snapshot(board_user) == before
    assert _fav_boards(board_user) == set()


@pytest.mark.parametrize(("method", "path", "body"), NEW_ENDPOINTS)
def test_access_admin_session_is_refused(admin: Client, board_user: Client, method: str, path: str, body: Any) -> None:
    folder = create_folder(board_user)["id"]
    board = create_board(board_user, unique_title())["id"]
    before = _tree_snapshot(board_user)
    resp = _call(admin, method, path, body, folder, board)
    assert resp.status_code in (401, 403), (resp.status_code, resp.text)
    assert _tree_snapshot(board_user) == before
    assert _fav_boards(board_user) == set()
    assert _fav_folders(board_user) == set()


# ---------- ARCH ----------


def test_arch_t22_folder_endpoints_published_in_openapi(clean_stack: str) -> None:
    resp = httpx.get(clean_stack + "/api/openapi.json", timeout=10.0)
    assert resp.status_code == 200
    paths = resp.json()["paths"]
    expected = {
        "/api/folders": {"get", "post"},
        "/api/folders/{folder_id}/position": {"put"},
        "/api/folders/{folder_id}/favorite": {"put", "delete"},
        "/api/boards/{board_id}/folder": {"put"},
        "/api/boards/{board_id}/favorite": {"put", "delete"},
    }
    for path, methods in expected.items():
        assert path in paths, (path, sorted(paths))
        assert methods <= set(paths[path]), (path, paths[path].keys())
