"""Приёмка T3.1 · ссылка на доску и вход по ссылке (SHR-01…03, SHR-05, SHR-06, ARCH-T31-*).

Сценарии — docs/qa/reports/T3.1.md (зафиксированы до чтения handoff); публичный API —
из handoff T3.1. Только HTTP и WebSocket по PUBLIC_BASE_URL.
"""

from __future__ import annotations

import base64
import re
import secrets
import uuid
from typing import Any

import pytest
from websockets.exceptions import InvalidStatus

from admin_helpers import create_user, list_users
from board_helpers import create_board, delete_board, get_board, list_boards, unique_title
from share_helpers import (
    get_link,
    guest_cookie_headers,
    join,
    link,
    participant,
    refusal,
    reset,
    shared,
)
from stand import Client, clients
from test_stack import _frame_denied, _frame_restricted_at_all
from user_helpers import user_login

TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{43,}$")


def _signed_in_user(admin: Client, base_url: str, name: str) -> Client:
    account = create_user(admin)
    one = Client(name, base_url)
    resp = user_login(one, account["email"], account["_password"])
    assert resp.status_code == 204, (resp.status_code, resp.text)
    return one


def _random_token() -> str:
    return secrets.token_urlsafe(32)


def _flip_char(token: str) -> str:
    """Тот же токен с одним изменённым символом."""
    ch = token[-2]
    repl = "A" if ch != "A" else "B"
    return token[:-2] + repl + token[-1]


def _no_token_leak(body: str, token: str) -> None:
    assert token not in body, body


# ---------- SHR-01 ----------


def test_shr01_owner_gets_link_built_from_public_base_url(
    board_user: Client, board: dict[str, Any], base_url: str
) -> None:
    body = link(board_user, board["id"])
    token = body["token"]
    assert TOKEN_RE.match(token), token
    assert len(base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))) >= 32
    assert body["url"] == f"{base_url}/b/{token}", body
    assert "localhost" not in body["url"] and "127.0.0.1" not in body["url"]


def test_shr01_link_is_stable_until_reset(board_user: Client, board: dict[str, Any]) -> None:
    first = link(board_user, board["id"])
    second = link(board_user, board["id"])
    assert first == second


def test_shr01_link_survives_new_owner_session(
    board_user: Client, board: dict[str, Any], clean_stack: str
) -> None:
    """Ссылку можно скопировать и переслать позже: новая сессия владельца видит ту же ссылку."""
    first = link(board_user, board["id"])
    with clients(clean_stack, "owner-2") as (again,):
        account = board_user.account  # type: ignore[attr-defined]
        assert user_login(again, account["email"], account["_password"]).status_code == 204
        assert link(again, board["id"]) == first


def test_shr01_boards_have_distinct_tokens_without_board_id(board_user: Client) -> None:
    boards = [create_board(board_user, unique_title()) for _ in range(5)]
    tokens = [link(board_user, b["id"])["token"] for b in boards]
    assert len(set(tokens)) == len(tokens), tokens
    for b, token in zip(boards, tokens):
        raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
        board_uuid = uuid.UUID(b["id"])
        assert board_uuid.bytes not in raw
        assert b["id"].replace("-", "") not in token.lower()
        assert b["id"] not in token


@pytest.mark.parametrize("role", ["other_user", "admin", "anonymous", "participant"])
def test_shr01_foreign_roles_cannot_get_link(
    role: str,
    admin: Client,
    board_user: Client,
    board: dict[str, Any],
    clean_stack: str,
) -> None:
    token = link(board_user, board["id"])["token"]
    with clients(clean_stack, role) as (one,):
        if role == "other_user":
            account = create_user(admin)
            assert user_login(one, account["email"], account["_password"]).status_code == 204
        elif role == "admin":
            one.http.cookies.update(admin.http.cookies)
        elif role == "participant":
            assert join(one, token, "Guest").status_code == 200
        resp = get_link(one, board["id"])
        assert resp.status_code in (401, 403, 404), (resp.status_code, resp.text)
        _no_token_leak(resp.text, token)


def test_shr01_unknown_and_deleted_board_have_no_link(board_user: Client) -> None:
    resp = get_link(board_user, str(uuid.uuid4()))
    assert resp.status_code == 404, (resp.status_code, resp.text)
    doomed = create_board(board_user, unique_title())
    token = link(board_user, doomed["id"])["token"]
    assert delete_board(board_user, doomed["id"]).status_code in (200, 204)
    resp = get_link(board_user, doomed["id"])
    assert resp.status_code == 404, (resp.status_code, resp.text)
    _no_token_leak(resp.text, token)


# ---------- SHR-02 ----------


def test_shr02_anonymous_joins_by_valid_link(
    board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    assert not list(client.http.cookies.jar)
    before = shared(client, token)
    assert before.status_code == 200, (before.status_code, before.text)
    assert before.json()["participant"] is None
    resp = join(client, token, "Dana")
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert guest_cookie_headers(resp), resp.headers.get_list("set-cookie")
    after = shared(client, token).json()
    assert after["participant"]["name"] == "Dana"
    assert after["title"] == board["title"]


def test_shr02_no_account_is_created_for_participant(
    admin: Client, board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    before = list_users(admin)
    name = f"Guest {uuid.uuid4().hex[:8]}"
    assert join(client, token, name).status_code == 200
    after = list_users(admin)
    assert len(after) == len(before)
    assert not any(name in str(u) for u in after)


def test_shr02_other_board_user_joins_as_participant_without_getting_board(
    admin: Client, board_user: Client, board: dict[str, Any], clean_stack: str
) -> None:
    token = link(board_user, board["id"])["token"]
    b = _signed_in_user(admin, clean_stack, "user-b")
    try:
        assert join(b, token, "Bob").status_code == 200
        assert participant(b, token)["name"] == "Bob"  # type: ignore[index]
        assert board["id"] not in [x["id"] for x in list_boards(b)]
        assert get_board(b, board["id"]).status_code in (403, 404)
        assert get_link(b, board["id"]).status_code in (403, 404)
    finally:
        b.close()


def test_shr02_two_participants_join_independently(
    board_user: Client, board: dict[str, Any], two_clients: tuple[Client, Client]
) -> None:
    token = link(board_user, board["id"])["token"]
    a, b = two_clients
    assert join(a, token, "Alice").status_code == 200
    assert join(b, token, "Bob").status_code == 200
    assert participant(a, token)["name"] == "Alice"  # type: ignore[index]
    assert participant(b, token)["name"] == "Bob"  # type: ignore[index]


# ---------- SHR-03 ----------


def test_shr03_name_is_requested_before_entry(link_participant: Client, client: Client) -> None:
    token = link_participant.token  # type: ignore[attr-defined]
    assert participant(client, token) is None
    assert participant(link_participant, token)["name"] == "QA Guest"  # type: ignore[index]


@pytest.mark.parametrize("name", ["", "   ", "\t\n", None])
def test_shr03_empty_name_is_rejected(
    name: Any, board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    resp = join(client, token, name)
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)
    assert not guest_cookie_headers(resp)
    assert participant(client, token) is None


def test_shr03_missing_name_field_is_rejected(
    board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    resp = client.http.post(f"/api/share/{token}/join", json={})
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)
    assert participant(client, token) is None


def test_shr03_very_long_name_is_not_server_error(
    board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    resp = join(client, token, "N" * 1000)
    assert resp.status_code < 500, (resp.status_code, resp.text)
    if resp.status_code == 200:
        assert len(participant(client, token)["name"]) <= 1000  # type: ignore[index]
    else:
        assert participant(client, token) is None


@pytest.mark.parametrize("name", ["Даша Ёлкина", "Zoë 🎨", "<script>alert(1)</script>", "  Pad  "])
def test_shr03_name_is_kept_as_text(
    name: str, board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    resp = join(client, token, name)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert participant(client, token)["name"] in (name, name.strip())  # type: ignore[index]


def test_shr03_same_session_is_not_asked_again(link_participant: Client) -> None:
    token = link_participant.token  # type: ignore[attr-defined]
    for _ in range(3):
        assert participant(link_participant, token)["name"] == "QA Guest"  # type: ignore[index]


# ---------- SHR-05 ----------


def _refusal_variants(board_user: Client, owner_board: dict[str, Any]) -> dict[str, str]:
    """Токены, на которые ожидается одинаковый отказ."""
    revoked_board = create_board(board_user, unique_title())
    revoked = link(board_user, revoked_board["id"])["token"]
    assert reset(board_user, revoked_board["id"]).status_code == 200
    deleted_board = create_board(board_user, unique_title())
    deleted = link(board_user, deleted_board["id"])["token"]
    assert delete_board(board_user, deleted_board["id"]).status_code in (200, 204)
    live = link(board_user, owner_board["id"])["token"]
    return {
        "unknown": _random_token(),
        "revoked": revoked,
        "deleted_board": deleted,
        "one_char_changed": _flip_char(live),
        "case_changed": live.swapcase() if live.swapcase() != live else _flip_char(live),
        "short": "x",
        "long": "A" * 500,
        "board_id": owner_board["id"],
    }


def test_shr05_unknown_revoked_and_malformed_tokens_get_same_refusal(
    board_user: Client, board: dict[str, Any], client: Client
) -> None:
    variants = _refusal_variants(board_user, board)
    gets = {k: refusal(shared(client, t)) for k, t in variants.items()}
    posts = {k: refusal(join(client, t, "Eve")) for k, t in variants.items()}
    assert len(set(gets.values())) == 1, gets
    assert len(set(posts.values())) == 1, posts
    status, body = gets["unknown"]
    assert 400 <= status < 500
    assert board["title"] not in body
    assert not list(client.http.cookies.jar)


def test_shr05_board_id_does_not_open_board_without_owner_session(
    admin: Client, board_user: Client, board: dict[str, Any], link_participant: Client, clean_stack: str
) -> None:
    b = _signed_in_user(admin, clean_stack, "user-b")
    with clients(clean_stack, "anon") as (anon,):
        try:
            for who in (anon, link_participant, b):
                resp = get_board(who, board["id"])
                assert resp.status_code in (401, 403, 404), (who.name, resp.status_code, resp.text)
                assert board["title"] not in resp.text
        finally:
            b.close()


def test_shr05_participant_session_is_bound_to_its_board(
    board_user: Client, board: dict[str, Any], link_participant: Client
) -> None:
    other = create_board(board_user, unique_title())
    other_token = link(board_user, other["id"])["token"]
    assert participant(link_participant, other_token) is None
    assert get_board(link_participant, other["id"]).status_code in (401, 403, 404)
    assert get_link(link_participant, other["id"]).status_code in (401, 403, 404)


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/boards", None),
        ("GET", "/api/boards/recent", None),
        ("POST", "/api/boards", {"title": "guest board"}),
        ("GET", "/api/folders", None),
        ("POST", "/api/folders", {"title": "guest folder"}),
        ("GET", "/api/session", None),
    ],
)
def test_shr05_participant_has_no_library_access(
    method: str, path: str, body: Any, link_participant: Client
) -> None:
    resp = link_participant.http.request(method, path, json=body)
    if path == "/api/session" and resp.status_code == 200:
        assert resp.json().get("authenticated") is not True, resp.text
        return
    assert resp.status_code in (401, 403), (resp.status_code, resp.text)


# ---------- SHR-06 ----------


def test_shr06_reset_issues_new_link_and_old_one_is_refused(
    board_user: Client, board: dict[str, Any], client: Client, base_url: str
) -> None:
    old = link(board_user, board["id"])
    resp = reset(board_user, board["id"])
    assert resp.status_code == 200, (resp.status_code, resp.text)
    new = resp.json()
    assert new["token"] != old["token"]
    assert TOKEN_RE.match(new["token"])
    assert new["url"] == f"{base_url}/b/{new['token']}"
    assert link(board_user, board["id"]) == new
    unknown = refusal(shared(client, _random_token()))
    assert refusal(shared(client, old["token"])) == unknown
    assert refusal(join(client, old["token"], "Late")) == refusal(join(client, _random_token(), "Late"))
    assert shared(client, new["token"]).status_code == 200
    assert join(client, new["token"], "Fresh").status_code == 200


def test_shr06_reset_revokes_cookie_issued_by_old_link(
    board_user: Client, link_participant: Client, clean_stack: str
) -> None:
    board = link_participant.board  # type: ignore[attr-defined]
    old = link_participant.token  # type: ignore[attr-defined]
    assert participant(link_participant, old)["name"] == "QA Guest"  # type: ignore[index]
    new = reset(board_user, board["id"]).json()["token"]
    with clients(clean_stack, "probe") as (probe,):
        unknown = refusal(shared(probe, _random_token()))
    assert refusal(shared(link_participant, old)) == unknown
    assert participant(link_participant, new) is None


def test_shr06_old_cookie_does_not_open_websocket(
    board_user: Client, link_participant: Client
) -> None:
    board = link_participant.board  # type: ignore[attr-defined]
    assert reset(board_user, board["id"]).status_code == 200
    for path in ("/api/ws", f"/api/ws?board={board['id']}", f"/api/ws?token={link_participant.token}"):  # type: ignore[attr-defined]
        with pytest.raises(InvalidStatus) as err:
            with link_participant.websocket(path):
                pass
        assert err.value.response.status_code in (401, 403, 404), path


def test_shr06_repeated_reset_keeps_only_last_link(
    board_user: Client, board: dict[str, Any], two_clients: tuple[Client, Client]
) -> None:
    a, b = two_clients
    t0 = link(board_user, board["id"])["token"]
    t1 = reset(board_user, board["id"]).json()["token"]
    assert join(a, t1, "Joined by t1").status_code == 200
    assert participant(a, t1)["name"] == "Joined by t1"  # type: ignore[index]
    t2 = reset(board_user, board["id"]).json()["token"]
    assert len({t0, t1, t2}) == 3
    unknown = refusal(shared(b, _random_token()))
    assert refusal(shared(b, t0)) == unknown
    assert refusal(shared(b, t1)) == unknown
    assert participant(a, t2) is None
    assert join(b, t2, "Joined by t2").status_code == 200


def test_shr06_tokens_are_not_sequential(board_user: Client, board: dict[str, Any]) -> None:
    tokens = [reset(board_user, board["id"]).json()["token"] for _ in range(10)]
    assert len(set(tokens)) == 10
    prefixes = {t[:8] for t in tokens}
    assert len(prefixes) == 10, tokens


@pytest.mark.parametrize("role", ["other_user", "admin", "anonymous", "participant"])
def test_shr06_only_owner_can_reset(
    role: str,
    admin: Client,
    board_user: Client,
    board: dict[str, Any],
    clean_stack: str,
) -> None:
    token = link(board_user, board["id"])["token"]
    with clients(clean_stack, role) as (one,):
        if role == "other_user":
            account = create_user(admin)
            assert user_login(one, account["email"], account["_password"]).status_code == 204
        elif role == "admin":
            one.http.cookies.update(admin.http.cookies)
        elif role == "participant":
            assert join(one, token, "Guest").status_code == 200
        resp = reset(one, board["id"])
        assert resp.status_code in (401, 403, 404), (resp.status_code, resp.text)
    assert link(board_user, board["id"])["token"] == token


def test_shr06_reset_does_not_touch_other_boards_and_owner_session(
    board_user: Client, board: dict[str, Any], two_clients: tuple[Client, Client]
) -> None:
    other = create_board(board_user, unique_title())
    other_token = link(board_user, other["id"])["token"]
    a, _ = two_clients
    assert join(a, other_token, "Other guest").status_code == 200
    assert reset(board_user, board["id"]).status_code == 200
    assert participant(a, other_token)["name"] == "Other guest"  # type: ignore[index]
    assert link(board_user, other["id"])["token"] == other_token
    assert get_board(board_user, board["id"]).status_code == 200


# ---------- ARCH-T31 ----------


def test_arch_t31_01_participant_cookie_flags(
    board_user: Client, board: dict[str, Any], client: Client, base_url: str
) -> None:
    token = link(board_user, board["id"])["token"]
    resp = join(client, token, "Cookie")
    headers = guest_cookie_headers(resp)
    assert len(headers) == 1, headers
    attrs = [p.strip().lower() for p in headers[0].split(";")[1:]]
    assert "httponly" in attrs
    assert "samesite=lax" in attrs
    if base_url.startswith("http://"):
        assert "secure" not in attrs
    value = headers[0].split(";", 1)[0].split("=", 1)[1]
    assert len(value) >= 32 and value != token


def test_arch_t31_02_embed_allows_frame_other_pages_deny(
    board_user: Client, board: dict[str, Any], client: Client
) -> None:
    token = link(board_user, board["id"])["token"]
    assert not _frame_restricted_at_all(client.http.get(f"/b/{token}/embed"))
    assert _frame_denied(client.http.get(f"/b/{token}"))
    assert _frame_denied(client.http.get(f"/boards/{board['id']}"))
    assert _frame_denied(client.http.get(f"/api/share/{token}"))


def test_arch_t31_03_share_endpoints_in_openapi(client: Client) -> None:
    paths = client.http.get("/api/openapi.json").json()["paths"]
    for path, method in [
        ("/api/boards/{board_id}/share", "get"),
        ("/api/boards/{board_id}/share/reset", "post"),
        ("/api/share/{token}", "get"),
        ("/api/share/{token}/join", "post"),
    ]:
        assert method in paths.get(path, {}), (path, sorted(paths))
