"""Приёмка T1.3 · отзыв сессий при смене пароля (ADM-04, дополнение).

Сценарии — docs/qa/reports/T1.3.md. Только публичный HTTP: `PATCH /api/admin/users/{id}`,
`POST /api/login`, `GET /api/session`, `GET /api/admin/users`, `/api/openapi.json`.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from typing import Any

import pytest

from admin_helpers import create_user, find_user, patch_user
from stand import Client
from user_helpers import (
    SESSION_COOKIE,
    is_signed_in,
    raw_login,
    session,
    session_cookie_headers,
    user_login,
    with_cookie,
)

REFUSED = {400, 401, 403, 404, 405, 409, 422}


def _new_password() -> str:
    return "changed-" + uuid.uuid4().hex


class _Sessions:
    """Набор клиентов с отдельными сессиями; закрывает их в конце теста."""

    def __init__(self, base_url: str) -> None:
        self.base_url = base_url
        self.made: list[Client] = []

    def sign_in(self, email: str, password: str, name: str = "c") -> Client:
        one = Client(name, self.base_url)
        self.made.append(one)
        resp = user_login(one, email, password)
        assert resp.status_code == 204, (resp.status_code, resp.text)
        return one

    def close(self) -> None:
        for one in self.made:
            one.close()


@pytest.fixture
def sessions(clean_stack: str) -> Iterator[_Sessions]:
    made = _Sessions(clean_stack)
    try:
        yield made
    finally:
        made.close()


def _cookie(one: Client) -> str:
    value = one.http.cookies.get(SESSION_COOKIE)
    assert value, "нет cookie сессии"
    return value


def _login_status(base_url: str, email: str, password: str) -> int:
    probe = Client("probe", base_url)
    try:
        return user_login(probe, email, password).status_code
    finally:
        probe.close()


def _admin_alive(admin: Client) -> bool:
    return admin.http.get("/api/admin/users").status_code == 200


# ---------- ADM-04: смена пароля отзывает все сессии ----------


def test_adm04_password_change_revokes_all_sessions(admin: Client, sessions: _Sessions) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"], "one")
    two = sessions.sign_in(acc["email"], acc["_password"], "two")
    assert is_signed_in(one) and is_signed_in(two)

    resp = patch_user(admin, acc["id"], password=_new_password())
    assert resp.status_code == 200, (resp.status_code, resp.text)

    assert not is_signed_in(one)
    assert not is_signed_in(two)
    # Повторные обращения не «оживляют» сессию.
    assert not is_signed_in(one)


def test_adm04_new_password_signs_in_old_is_generic_refusal(
    admin: Client, sessions: _Sessions, clean_stack: str
) -> None:
    acc = create_user(admin)
    sessions.sign_in(acc["email"], acc["_password"])
    new = _new_password()
    assert patch_user(admin, acc["id"], password=new).status_code == 200

    fresh = sessions.sign_in(acc["email"], new, "fresh")
    me = session(fresh)
    assert me.get("authenticated") is True
    assert acc["email"].lower() in str(me).lower(), me

    probe = Client("old", clean_stack)
    try:
        old = user_login(probe, acc["email"], acc["_password"])
        assert old.status_code == 401, (old.status_code, old.text)
        assert "Invalid email or password" in old.text
        assert not session_cookie_headers(old) or not is_signed_in(probe)
    finally:
        probe.close()


def test_adm04_copied_cookie_revoked_after_password_change(
    admin: Client, sessions: _Sessions, clean_stack: str
) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"])
    copied = with_cookie(clean_stack, "copy", _cookie(one))
    try:
        assert is_signed_in(copied)
        assert patch_user(admin, acc["id"], password=_new_password()).status_code == 200
        assert not is_signed_in(copied)
    finally:
        copied.close()


def test_adm04_session_after_change_lives_until_next_change(admin: Client, sessions: _Sessions) -> None:
    acc = create_user(admin)
    first = _new_password()
    assert patch_user(admin, acc["id"], password=first).status_code == 200
    after = sessions.sign_in(acc["email"], first, "after")
    # Не отзывается задним числом: другие правки и время её не трогают.
    assert patch_user(admin, acc["id"], name="Still Here").status_code == 200
    assert is_signed_in(after)

    second = _new_password()
    assert patch_user(admin, acc["id"], password=second).status_code == 200
    assert not is_signed_in(after)
    assert is_signed_in(sessions.sign_in(acc["email"], second, "after2"))


def test_adm04_same_password_value_is_a_change(admin: Client, sessions: _Sessions) -> None:
    """Фиксация: пароль «изменён» на тот же — сессии отзываются, вход тем же паролем работает."""
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"])
    assert patch_user(admin, acc["id"], password=acc["_password"]).status_code == 200
    assert not is_signed_in(one)
    assert is_signed_in(sessions.sign_in(acc["email"], acc["_password"], "again"))


def test_adm04_name_and_password_in_one_request_revokes(admin: Client, sessions: _Sessions) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"])
    new = _new_password()
    assert patch_user(admin, acc["id"], name="Renamed", password=new).status_code == 200
    assert not is_signed_in(one)
    assert find_user(admin, acc["id"])["name"] == "Renamed"


# ---------- ADM-04: смена имени/почты сессии не отзывает ----------


@pytest.mark.parametrize("change", ["name", "email", "both"])
def test_adm04_name_or_email_change_keeps_sessions(admin: Client, sessions: _Sessions, change: str) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"], "one")
    two = sessions.sign_in(acc["email"], acc["_password"], "two")
    fields: dict[str, Any] = {}
    if change in ("name", "both"):
        fields["name"] = "New Name " + uuid.uuid4().hex[:4]
    if change in ("email", "both"):
        fields["email"] = f"qa-moved-{uuid.uuid4().hex[:8]}@example.com"
    assert patch_user(admin, acc["id"], **fields).status_code == 200

    for c in (one, two):
        me = session(c)
        assert me.get("authenticated") is True, me
        text = str(me)
        for value in fields.values():
            assert value in text, (value, me)
    # Пароль не менялся: вход с прежним паролем по актуальной почте работает.
    email = fields.get("email", acc["email"])
    assert is_signed_in(sessions.sign_in(email, acc["_password"], "three"))


# ---------- ADM-04: границы — другие пользователи и администратор ----------


def test_adm04_other_users_and_admin_sessions_untouched(admin: Client, sessions: _Sessions) -> None:
    a = create_user(admin)
    b = create_user(admin)
    a1 = sessions.sign_in(a["email"], a["_password"], "a1")
    b1 = sessions.sign_in(b["email"], b["_password"], "b1")
    b2 = sessions.sign_in(b["email"], b["_password"], "b2")

    assert patch_user(admin, a["id"], password=_new_password()).status_code == 200

    assert not is_signed_in(a1)
    assert is_signed_in(b1) and is_signed_in(b2)
    assert _admin_alive(admin)
    assert admin.http.get("/api/admin/session").status_code == 200


# ---------- ADM-04 / ADM-07 / ADM-05: отказ не меняет пароль и сессии ----------


def test_adm04_adm07_taken_email_with_password_changes_nothing(
    admin: Client, sessions: _Sessions, clean_stack: str
) -> None:
    a = create_user(admin)
    b = create_user(admin)
    a1 = sessions.sign_in(a["email"], a["_password"])
    new = _new_password()

    resp = patch_user(admin, a["id"], email=b["email"], password=new)
    assert resp.status_code == 409, (resp.status_code, resp.text)

    assert is_signed_in(a1)
    row = find_user(admin, a["id"])
    assert row["email"].lower() == a["email"].lower()
    assert find_user(admin, b["id"])["email"].lower() == b["email"].lower()
    assert _login_status(clean_stack, a["email"], new) == 401
    assert _login_status(clean_stack, a["email"], a["_password"]) == 204


def test_adm04_adm05_adm07_disable_with_taken_email_is_refused_cleanly(
    admin: Client, sessions: _Sessions, clean_stack: str
) -> None:
    a = create_user(admin)
    b = create_user(admin)
    a1 = sessions.sign_in(a["email"], a["_password"])

    resp = patch_user(admin, a["id"], disabled=True, email=b["email"])
    assert resp.status_code == 409, (resp.status_code, resp.text)
    assert find_user(admin, a["id"])["disabled"] is False
    assert is_signed_in(a1)

    new = _new_password()
    resp = patch_user(admin, a["id"], disabled=True, email=b["email"], password=new)
    assert resp.status_code == 409, (resp.status_code, resp.text)
    row = find_user(admin, a["id"])
    assert row["disabled"] is False and row["email"].lower() == a["email"].lower()
    assert is_signed_in(a1)
    assert _login_status(clean_stack, a["email"], new) == 401
    assert _login_status(clean_stack, a["email"], a["_password"]) == 204


@pytest.mark.parametrize(
    "fields",
    [
        {"password": ""},
        {"email": "not-an-email", "password": "valid-pass-123"},
        {"name": "", "password": "valid-pass-123"},
    ],
    ids=["empty-password", "bad-email", "empty-name"],
)
def test_adm04_invalid_update_keeps_password_and_sessions(
    admin: Client, sessions: _Sessions, clean_stack: str, fields: dict[str, Any]
) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"])
    resp = patch_user(admin, acc["id"], **fields)
    assert resp.status_code == 422, (resp.status_code, resp.text)
    assert is_signed_in(one)
    assert _login_status(clean_stack, acc["email"], acc["_password"]) == 204


def test_adm04_unknown_account_404_keeps_sessions(admin: Client, sessions: _Sessions) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"])
    resp = patch_user(admin, str(uuid.uuid4()), password=_new_password())
    assert resp.status_code == 404, (resp.status_code, resp.text)
    assert is_signed_in(one)


def test_adm04_non_admin_cannot_change_password_or_revoke(
    admin: Client, sessions: _Sessions, client: Client, clean_stack: str
) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"], "one")
    new = _new_password()
    # Посторонний без сессии и сам пользователь досок (его сессия — не сессия панели).
    for actor in (client, one):
        resp = patch_user(actor, acc["id"], password=new)
        assert resp.status_code in REFUSED - {404, 409, 422}, (resp.status_code, resp.text)
    assert is_signed_in(one)
    assert _login_status(clean_stack, acc["email"], new) == 401


# ---------- ADM-05 (регрессия): отключение по-прежнему отзывает ----------


def test_adm05_enable_does_not_revive_revoked_session(admin: Client, sessions: _Sessions) -> None:
    acc = create_user(admin)
    one = sessions.sign_in(acc["email"], acc["_password"])
    assert patch_user(admin, acc["id"], disabled=True).status_code == 200
    assert not is_signed_in(one)
    assert patch_user(admin, acc["id"], disabled=False).status_code == 200
    assert not is_signed_in(one)


# ---------- ARCH ----------


def test_arch_t13_01_new_session_cookie_flags_and_fresh_id(admin: Client, sessions: _Sessions) -> None:
    acc = create_user(admin)
    old = sessions.sign_in(acc["email"], acc["_password"])
    old_id = _cookie(old)
    new = _new_password()
    assert patch_user(admin, acc["id"], password=new).status_code == 200

    probe = Client("probe", sessions.base_url)
    sessions.made.append(probe)
    resp = user_login(probe, acc["email"], new)
    assert resp.status_code == 204
    headers = session_cookie_headers(resp)
    assert len(headers) == 1, headers
    attrs = [part.strip().lower() for part in headers[0].split(";")[1:]]
    assert "httponly" in attrs and "samesite=lax" in attrs and "secure" not in attrs, headers[0]
    assert _cookie(probe) != old_id


def test_arch_t13_02_patch_contract_published_without_5xx(admin: Client, client: Client) -> None:
    spec = client.http.get("/api/openapi.json")
    assert spec.status_code == 200
    paths = spec.json()["paths"]
    patch = next((ops["patch"] for p, ops in paths.items() if p.startswith("/api/admin/users/") and "patch" in ops), None)
    assert patch is not None, sorted(paths)
    assert not any(code.startswith("5") for code in patch.get("responses", {})), patch.get("responses")


def test_adm04_raw_login_after_revoke_gives_single_new_session(admin: Client, clean_stack: str) -> None:
    """Отозванная cookie в запросе входа не мешает новому входу и не восстанавливается."""
    acc = create_user(admin)
    one = Client("one", clean_stack)
    try:
        assert user_login(one, acc["email"], acc["_password"]).status_code == 204
        revoked = _cookie(one)
        new = _new_password()
        assert patch_user(admin, acc["id"], password=new).status_code == 200
        assert not is_signed_in(one)
        resp = raw_login(one, acc["email"], new)
        if resp.status_code == 429:
            resp = user_login(one, acc["email"], new)
        assert resp.status_code == 204
        assert is_signed_in(one)
        assert _cookie(one) != revoked
        stale = with_cookie(clean_stack, "stale", revoked)
        try:
            assert not is_signed_in(stale)
        finally:
            stale.close()
    finally:
        one.close()
