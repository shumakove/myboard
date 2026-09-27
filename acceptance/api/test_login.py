"""Приёмка T1.2 · вход пользователя досок (ACC-01…03) и перенос из T1.1 (ADM-01, ADM-04…06).

Сценарии — docs/qa/reports/T1.2.md. Только публичный HTTP: `POST /api/login`,
`POST /api/logout`, `GET /api/session`, API панели `/api/admin/*`.
Тест ограничения частоты стоит в конце файла: он исчерпывает общий лимит стенда.
"""

from __future__ import annotations

import base64
import time
import uuid

import httpx

from admin_helpers import ADMIN_COOKIE, create_user, patch_user
from stand import Client, clients
from user_helpers import (
    SESSION_COOKIE,
    gives_session,
    is_signed_in,
    logout,
    raw_login,
    session,
    session_cookie_headers,
    user_login,
    with_cookie,
)

GENERIC_REJECT = "Invalid email or password"


def _signed_in_client(base_url: str, email: str, password: str, name: str = "c") -> Client:
    one = Client(name, base_url)
    resp = user_login(one, email, password)
    assert resp.status_code == 204, (resp.status_code, resp.text)
    return one


def _cookie_value(client: Client) -> str:
    value = client.http.cookies.get(SESSION_COOKIE)
    assert value, "cookie сессии пользователя не выдана"
    return value


def _reject_signature(resp: httpx.Response) -> tuple[int, str, bool]:
    return resp.status_code, resp.text, gives_session(resp)


# ---------- ACC-01 ----------


def test_acc01_login_with_credentials_set_by_admin(admin: Client, client: Client) -> None:
    account = create_user(admin)
    assert not is_signed_in(client)
    resp = user_login(client, account["email"], account["_password"])
    assert resp.status_code == 204, (resp.status_code, resp.text)
    assert gives_session(resp)
    me = session(client)
    assert me["authenticated"] is True
    assert me.get("email") == account["email"]
    assert me.get("name") == account["name"]


def test_acc01_session_does_not_expose_password(board_user: Client) -> None:
    body = board_user.http.get("/api/session").text
    password = board_user.account["_password"]  # type: ignore[attr-defined]
    assert password not in body
    assert "argon2" not in body.lower() and "hash" not in body.lower()


def test_acc01_email_case_and_surrounding_spaces(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    variant = "  " + account["email"].upper() + " "
    with clients(clean_stack, "u") as (one,):
        resp = user_login(one, variant, account["_password"])
        assert resp.status_code == 204, (resp.status_code, resp.text)
        assert session(one)["email"] == account["email"]


def test_acc01_password_is_exact(admin: Client, clean_stack: str) -> None:
    password = " пароль с пробелами Ё "
    account = create_user(admin, password=password)
    with clients(clean_stack, "trimmed", "upper", "exact") as (trimmed, upper, exact):
        assert _reject_signature(user_login(trimmed, account["email"], password.strip()))[0] == 401
        assert user_login(upper, account["email"], password.upper()).status_code == 401
        assert not is_signed_in(trimmed) and not is_signed_in(upper)
        assert user_login(exact, account["email"], password).status_code == 204
        assert is_signed_in(exact)


def test_acc01_two_users_get_own_sessions(admin: Client, clean_stack: str) -> None:
    a = create_user(admin)
    b = create_user(admin)
    ca = _signed_in_client(clean_stack, a["email"], a["_password"], "A")
    cb = _signed_in_client(clean_stack, b["email"], b["_password"], "B")
    try:
        assert _cookie_value(ca) != _cookie_value(cb)
        assert session(ca)["email"] == a["email"]
        assert session(cb)["email"] == b["email"]
    finally:
        ca.close()
        cb.close()


def test_acc01_malformed_requests_rejected_without_session(client: Client) -> None:
    bodies: list[dict[str, object]] = [
        {"email": "", "password": ""},
        {"email": "a@example.com"},
        {"password": "x"},
        {},
    ]
    for body in bodies:
        resp = client.http.post("/api/login", json=body)
        assert 400 <= resp.status_code < 500 and resp.status_code != 404, (body, resp.status_code)
        assert not gives_session(resp)
    resp = client.http.post("/api/login", content=b"not json", headers={"content-type": "application/json"})
    assert 400 <= resp.status_code < 500, resp.status_code
    assert not is_signed_in(client)


def test_acc01_admin_credentials_rejected_like_wrong_password(
    admin: Client, clean_stack: str, admin_creds: tuple[str, str]
) -> None:
    account = create_user(admin)
    with clients(clean_stack, "adm", "wrong") as (adm, wrong):
        by_admin = user_login(adm, *admin_creds)
        by_wrong = user_login(wrong, account["email"], "wrong-" + uuid.uuid4().hex)
        assert _reject_signature(by_admin) == _reject_signature(by_wrong)
        assert by_admin.status_code == 401
        assert not is_signed_in(adm)


def test_adm01_user_session_does_not_open_admin_api(board_user: Client) -> None:
    assert board_user.http.get("/api/admin/users").status_code in (401, 403)
    resp = board_user.http.post("/api/admin/users", json={"name": "x", "email": "x@example.com", "password": "x"})
    assert resp.status_code in (401, 403)
    admin_session = board_user.http.get("/api/admin/session")
    if admin_session.status_code == 200:
        assert admin_session.json().get("authenticated") is not True


def test_adm01_admin_session_is_not_user_session(admin: Client, clean_stack: str) -> None:
    assert not is_signed_in(admin)
    # Значение cookie администратора, подложенное как cookie пользователя, не действует.
    forged = with_cookie(clean_stack, "forged", admin.http.cookies.get(ADMIN_COOKIE) or "")
    try:
        assert not is_signed_in(forged)
    finally:
        forged.close()


# ---------- ACC-02 ----------


def test_acc02_unknown_email_wrong_password_disabled_identical(admin: Client, clean_stack: str) -> None:
    active = create_user(admin)
    disabled = create_user(admin)
    assert patch_user(admin, disabled["id"], disabled=True).status_code == 200
    with clients(clean_stack, "a", "b", "c") as (a, b, c):
        unknown = user_login(a, "qa-nobody-" + uuid.uuid4().hex[:8] + "@example.com", "whatever-1")
        wrong_pw = user_login(b, active["email"], "wrong-" + uuid.uuid4().hex)
        off = user_login(c, disabled["email"], disabled["_password"])
        signatures = {_reject_signature(r) for r in (unknown, wrong_pw, off)}
        assert len(signatures) == 1, signatures
        status, text, cookie = signatures.pop()
        assert status == 401 and not cookie
        assert GENERIC_REJECT.lower() in text.lower()
        for one in (a, b, c):
            assert not is_signed_in(one)


def test_adm05_disabled_user_cannot_login_and_session_revoked(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    before = _signed_in_client(clean_stack, account["email"], account["_password"], "before")
    try:
        assert is_signed_in(before)
        assert patch_user(admin, account["id"], disabled=True).status_code == 200
        assert not is_signed_in(before), "сессия отключённого пользователя продолжает действовать"
        with clients(clean_stack, "after") as (after,):
            resp = user_login(after, account["email"], account["_password"])
            assert resp.status_code == 401 and not gives_session(resp)
            assert not is_signed_in(after)
    finally:
        before.close()


def test_adm06_enable_restores_login_with_same_password(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    assert patch_user(admin, account["id"], disabled=True).status_code == 200
    with clients(clean_stack, "u1", "u2") as (u1, u2):
        assert user_login(u1, account["email"], account["_password"]).status_code == 401
        assert patch_user(admin, account["id"], disabled=False).status_code == 200
        assert user_login(u2, account["email"], account["_password"]).status_code == 204
        assert is_signed_in(u2)


def test_adm04_new_password_works_old_does_not(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    new_password = "new-" + uuid.uuid4().hex
    assert patch_user(admin, account["id"], password=new_password).status_code == 200
    with clients(clean_stack, "old", "new") as (old, new):
        old_resp = user_login(old, account["email"], account["_password"])
        assert old_resp.status_code == 401 and not gives_session(old_resp)
        assert user_login(new, account["email"], new_password).status_code == 204
        assert is_signed_in(new)


def test_adm04_new_email_works_old_does_not(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    new_email = "qa-moved-" + uuid.uuid4().hex[:10] + "@example.com"
    assert patch_user(admin, account["id"], email=new_email).status_code == 200
    with clients(clean_stack, "old", "new") as (old, new):
        assert user_login(old, account["email"], account["_password"]).status_code == 401
        assert user_login(new, new_email, account["_password"]).status_code == 204
        assert session(new)["email"] == new_email


def test_adm04_session_issued_before_password_change_revoked(admin: Client, clean_stack: str) -> None:
    """ADM-04 (редакция f65eab9): после смены пароля действующие сессии учётки отзываются (T1.3)."""
    account = create_user(admin)
    one = _signed_in_client(clean_stack, account["email"], account["_password"])
    try:
        assert is_signed_in(one)
        assert patch_user(admin, account["id"], password="changed-" + uuid.uuid4().hex).status_code == 200
        assert not is_signed_in(one)
    finally:
        one.close()


# ---------- ACC-03 ----------


def test_acc03_session_cookie_is_persistent(admin: Client, client: Client) -> None:
    account = create_user(admin)
    resp = user_login(client, account["email"], account["_password"])
    headers = session_cookie_headers(resp)
    assert len(headers) == 1, headers
    attrs = {p.strip().split("=", 1)[0].lower(): p.strip() for p in headers[0].split(";")[1:]}
    assert "max-age" in attrs or "expires" in attrs, f"сессионная cookie браузера: {headers[0]}"
    if "max-age" in attrs:
        assert int(attrs["max-age"].split("=", 1)[1]) >= 365 * 24 * 3600, headers[0]


def test_acc03_cookie_keeps_working_on_later_visits(board_user: Client, clean_stack: str) -> None:
    value = _cookie_value(board_user)
    # «Новый визит» — новый клиент только с сохранённой cookie.
    for i in range(3):
        revisit = with_cookie(clean_stack, f"visit{i}", value)
        try:
            assert is_signed_in(revisit)
        finally:
            revisit.close()


def test_acc03_logout_revokes_copied_cookie(board_user: Client, clean_stack: str) -> None:
    value = _cookie_value(board_user)
    copy = with_cookie(clean_stack, "copy", value)
    try:
        assert is_signed_in(copy)
        resp = logout(board_user)
        assert resp.status_code in (200, 204), resp.status_code
        assert not is_signed_in(board_user)
        assert not is_signed_in(copy), "скопированная cookie действует после выхода"
    finally:
        copy.close()


def test_acc03_logout_in_one_browser_keeps_other(board_user: Client, clean_stack: str) -> None:
    account = board_user.account  # type: ignore[attr-defined]
    other = _signed_in_client(clean_stack, account["email"], account["_password"], "other")
    try:
        assert logout(board_user).status_code in (200, 204)
        assert not is_signed_in(board_user)
        assert is_signed_in(other)
    finally:
        other.close()


def test_acc03_repeat_and_anonymous_logout_no_error(board_user: Client, client: Client) -> None:
    assert logout(board_user).status_code in (200, 204)
    assert logout(board_user).status_code < 500
    assert logout(client).status_code < 500


def test_acc03_anonymous_and_forged_cookie_not_signed_in(client: Client, clean_stack: str) -> None:
    assert not is_signed_in(client)
    for value in ("forged", base64.urlsafe_b64encode(b"\0" * 32).decode().rstrip("="), ""):
        forged = with_cookie(clean_stack, "forged", value)
        try:
            assert not is_signed_in(forged)
        finally:
            forged.close()


# ---------- Архитектура ----------


def test_arch_acc01_cookie_flags_on_http(admin: Client, client: Client) -> None:
    account = create_user(admin)
    resp = user_login(client, account["email"], account["_password"])
    header = session_cookie_headers(resp)[0]
    parts = [p.strip().lower() for p in header.split(";")]
    assert "httponly" in parts, header
    assert "samesite=lax" in parts, header
    assert client.base_url.startswith("http://")
    assert "secure" not in parts, header


def test_arch_acc02_session_ids_random(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    values = []
    for i in range(2):
        one = _signed_in_client(clean_stack, account["email"], account["_password"], f"s{i}")
        values.append(_cookie_value(one))
        one.close()
    assert values[0] != values[1]
    for value in values:
        assert len(value) >= 22, value
        assert account["email"].split("@")[0] not in value
        assert account["id"] not in value


def test_arch_acc03_login_page_forbids_framing(client: Client) -> None:
    resp = client.http.get("/login")
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    xfo = resp.headers.get("x-frame-options", "").upper()
    csp = resp.headers.get("content-security-policy", "")
    assert xfo in ("DENY", "SAMEORIGIN") or "frame-ancestors 'none'" in csp, resp.headers


def test_arch_acc06_login_contracts_in_openapi(client: Client) -> None:
    paths = client.http.get("/api/openapi.json").json()["paths"]
    assert "post" in paths.get("/api/login", {}), sorted(paths)
    assert "post" in paths.get("/api/logout", {}), sorted(paths)
    assert "get" in paths.get("/api/session", {}), sorted(paths)


# ---------- ACC-02 · ограничение частоты (последним: исчерпывает общий лимит) ----------


def test_acc02_zz_login_attempts_limited_then_released(admin: Client, clean_stack: str) -> None:
    account = create_user(admin)
    with clients(clean_stack, "attacker", "owner", "probe") as (attacker, owner, probe):
        limited: httpx.Response | None = None
        for _ in range(30):
            resp = raw_login(attacker, "qa-enum-" + uuid.uuid4().hex[:8] + "@example.com", "x-1")
            if resp.status_code == 429:
                limited = resp
                break
            assert resp.status_code == 401, resp.status_code
        assert limited is not None, "30 неудачных входов подряд не ограничены"
        # Во время ограничения ответ не различает существующую и несуществующую почту.
        existing = raw_login(probe, account["email"], "wrong-" + uuid.uuid4().hex)
        missing = raw_login(probe, "qa-none-" + uuid.uuid4().hex[:8] + "@example.com", "wrong")
        assert _reject_signature(existing) == _reject_signature(missing)
        correct = raw_login(probe, account["email"], account["_password"])
        assert correct.status_code == 429 and not gives_session(correct)
        retry_after = int(limited.headers.get("retry-after", "60"))
        assert 0 < retry_after <= 3600
        time.sleep(retry_after + 1)
        released = raw_login(owner, account["email"], account["_password"])
        assert released.status_code == 204, "после окна ограничения верный вход не проходит"
        assert is_signed_in(owner)
