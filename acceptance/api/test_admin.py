"""Приёмка T1.1 · Администратор и учётные записи (ADM-01…07) через HTTP.

Сценарии — docs/qa/reports/T1.1.md (зафиксированы до чтения handoff).
Маршруты — из handoff T1.1. Код из `apps/` не импортируется.

Вход пользователя досок появится в T1.2, поэтому части ADM-04 («новый пароль
работает, старый — нет») и ADM-05/ADM-06 («не входит / снова входит») проверяются
здесь в наблюдаемом сейчас объёме, а через вход — в test_account.py после T1.2.

Лимит неудачных входов общий для всех клиентов стенда (Docker Desktop видит один
адрес), поэтому неудачных входов в модуле немного, а тест лимита стоит последним
и дожидается освобождения окна.
"""

from __future__ import annotations

import re
import shutil
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import pytest

from admin_helpers import (
    ADMIN_COOKIE,
    create_user,
    find_user,
    list_users,
    login,
    new_user_payload,
    patch_user,
    unique_email,
    users_with_email,
)
from stand import Client, clients

needs_docker = pytest.mark.skipif(shutil.which("docker") is None, reason="нужен Docker CLI")

ANON_REFUSED = {401, 403}


def _set_cookie_headers(resp: httpx.Response) -> list[str]:
    return resp.headers.get_list("set-cookie")


def _admin_cookie_header(resp: httpx.Response) -> str:
    found = [h for h in _set_cookie_headers(resp) if h.startswith(ADMIN_COOKIE + "=")]
    assert found, f"нет cookie {ADMIN_COOKIE}: {_set_cookie_headers(resp)}"
    return found[0]


def _gives_session(resp: httpx.Response) -> bool:
    for header in _set_cookie_headers(resp):
        name, _, rest = header.partition("=")
        value = rest.split(";", 1)[0]
        if name == ADMIN_COOKIE and value:
            return True
    return False


# --- ADM-01: вход администратора --------------------------------------------


def test_adm01_admin_signs_in_and_sees_accounts(client: Client, admin_creds: tuple[str, str]) -> None:
    resp = login(client, *admin_creds)
    assert resp.status_code in {200, 204}, (resp.status_code, resp.text)
    assert _gives_session(resp)
    users = client.http.get("/api/admin/users")
    assert users.status_code == 200, users.text
    assert isinstance(users.json(), list)


def test_adm01_session_endpoint_reports_state(client: Client, admin_creds: tuple[str, str]) -> None:
    anon = client.http.get("/api/admin/session")
    assert anon.status_code == 200
    assert anon.json().get("authenticated") is False
    assert login(client, *admin_creds).status_code == 204
    me = client.http.get("/api/admin/session").json()
    assert me.get("authenticated") is True
    assert str(me.get("email", "")).lower() == admin_creds[0].lower()


def test_adm01_wrong_password_and_unknown_email_refused_alike(
    two_clients: tuple[Client, Client], admin_creds: tuple[str, str]
) -> None:
    a, b = two_clients
    wrong_pw = login(a, admin_creds[0], admin_creds[1] + "-wrong")
    unknown = login(b, unique_email("nobody"), admin_creds[1])
    assert wrong_pw.status_code == 401, (wrong_pw.status_code, wrong_pw.text)
    assert unknown.status_code == wrong_pw.status_code
    assert unknown.json() == wrong_pw.json()
    assert not _gives_session(wrong_pw) and not _gives_session(unknown)
    assert a.http.get("/api/admin/users").status_code in ANON_REFUSED


@pytest.mark.parametrize("cookie", [None, "forged-" + uuid.uuid4().hex, ""])
def test_adm01_panel_api_refuses_without_admin_session(
    client: Client, admin: Client, cookie: str | None
) -> None:
    victim = create_user(admin)
    if cookie is not None:
        client.http.cookies.set(ADMIN_COOKIE, cookie)
    listing = client.http.get("/api/admin/users")
    assert listing.status_code in ANON_REFUSED, listing.status_code
    assert victim["email"] not in listing.text
    created = client.http.post("/api/admin/users", json=new_user_payload())
    assert created.status_code in ANON_REFUSED, created.status_code
    changed = patch_user(client, victim["id"], name="hacked")
    assert changed.status_code in ANON_REFUSED, changed.status_code
    assert find_user(admin, victim["id"])["name"] == victim["name"]


def test_adm01_board_user_cannot_sign_in_to_panel(
    client: Client, admin: Client, admin_creds: tuple[str, str]
) -> None:
    user = create_user(admin)
    resp = login(client, user["email"], user["_password"])
    assert resp.status_code == 401, (resp.status_code, resp.text)
    assert not _gives_session(resp)
    assert client.http.get("/api/admin/users").status_code in ANON_REFUSED
    # Тот же скупой отказ, что и для неверного пароля администратора.
    with clients(client.base_url, "other") as (other,):
        wrong = login(other, admin_creds[0], admin_creds[1] + "-x")
    assert resp.json() == wrong.json()


@pytest.mark.parametrize(
    "payload",
    [
        {"email": "", "password": ""},
        {},
        {"email": "admin@example.com"},
    ],
)
def test_adm01_empty_login_fields_are_4xx(client: Client, payload: dict[str, Any]) -> None:
    resp = client.http.post("/api/admin/login", json=payload)
    assert 400 <= resp.status_code < 500 and resp.status_code != 429, resp.status_code
    assert not _gives_session(resp)


def test_adm01_admin_email_case_and_spaces(client: Client, admin_creds: tuple[str, str]) -> None:
    email, password = admin_creds
    resp = login(client, "  " + email.upper() + " ", password)
    # Поведение фиксируется: вход или тот же скупой отказ — но не 5xx.
    assert resp.status_code in {204, 401}, (resp.status_code, resp.text)


def test_adm01_logout_revokes_old_cookie(client: Client, admin_creds: tuple[str, str]) -> None:
    assert login(client, *admin_creds).status_code == 204
    stolen = client.http.cookies.get(ADMIN_COOKIE)
    assert stolen
    out = client.http.post("/api/admin/logout")
    assert out.status_code in {200, 204}, out.status_code
    assert client.http.get("/api/admin/users").status_code in ANON_REFUSED
    with clients(client.base_url, "replay") as (replay,):
        replay.http.cookies.set(ADMIN_COOKIE, stolen)
        assert replay.http.get("/api/admin/users").status_code in ANON_REFUSED


def test_adm01_two_admin_sessions_are_independent(
    two_clients: tuple[Client, Client], admin_creds: tuple[str, str]
) -> None:
    a, b = two_clients
    assert login(a, *admin_creds).status_code == 204
    assert login(b, *admin_creds).status_code == 204
    assert a.http.post("/api/admin/logout").status_code in {200, 204}
    assert b.http.get("/api/admin/users").status_code == 200


# --- ADM-02: список учётных записей -----------------------------------------


def test_adm02_list_shows_created_accounts(admin: Client) -> None:
    made = [create_user(admin) for _ in range(3)]
    listed = {u["id"]: u for u in list_users(admin)}
    for user in made:
        row = listed.get(user["id"])
        assert row is not None, f"учётка {user['email']} не в списке"
        assert row["name"] == user["name"]
        assert row["email"] == user["email"]
        assert row["disabled"] is False


def test_adm02_list_has_no_passwords_and_no_admin(
    admin: Client, admin_creds: tuple[str, str]
) -> None:
    user = create_user(admin)
    resp = admin.http.get("/api/admin/users")
    text = resp.text
    assert user["_password"] not in text
    assert "$argon2" not in text
    for row in resp.json():
        for key in row:
            assert "pass" not in key.lower() and "hash" not in key.lower(), key
    assert not users_with_email(admin, admin_creds[0]), "администратор в списке пользователей досок"


# --- ADM-03: создание -------------------------------------------------------


def test_adm03_create_user_with_name_email_password(admin: Client) -> None:
    payload = new_user_payload()
    resp = admin.http.post("/api/admin/users", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["name"] == payload["name"] and body["email"] == payload["email"]
    assert payload["password"] not in resp.text
    assert find_user(admin, body["id"]) is not None


@pytest.mark.parametrize(
    "broken",
    [
        {"name": None},
        {"email": None},
        {"password": None},
        {"name": ""},
        {"password": ""},
        {"email": ""},
        {"email": "not-an-email"},
        {"email": "a@"},
    ],
    ids=["no-name", "no-email", "no-password", "empty-name", "empty-password", "empty-email",
         "bad-email", "half-email"],
)
def test_adm03_invalid_fields_rejected(admin: Client, broken: dict[str, Any]) -> None:
    payload = new_user_payload()
    for key, value in broken.items():
        if value is None:
            payload.pop(key)
        else:
            payload[key] = value
    resp = admin.http.post("/api/admin/users", json=payload)
    assert resp.status_code in {400, 422}, (resp.status_code, resp.text)
    if payload.get("email") and "@" in payload["email"] and "." in payload["email"]:
        assert not users_with_email(admin, payload["email"])


def test_adm03_anonymous_cannot_create(client: Client, admin: Client) -> None:
    payload = new_user_payload()
    resp = client.http.post("/api/admin/users", json=payload)
    assert resp.status_code in ANON_REFUSED
    assert not users_with_email(admin, payload["email"])


def test_adm03_unicode_long_name_and_spaced_password(admin: Client) -> None:
    name = "Анна-Мария Ёлкина " + "я" * 80
    user = create_user(admin, name=name, password="  пароль с пробелами  ")
    row = find_user(admin, user["id"])
    assert row is not None and row["name"] == name


# --- ADM-04: изменение ------------------------------------------------------


def test_adm04_change_name_visible_in_list(admin: Client) -> None:
    user = create_user(admin)
    resp = patch_user(admin, user["id"], name="Renamed Пользователь")
    assert resp.status_code == 200, resp.text
    row = find_user(admin, user["id"])
    assert row["name"] == "Renamed Пользователь"
    assert row["email"] == user["email"], "смена имени изменила почту"


def test_adm04_change_email_visible_in_list(admin: Client) -> None:
    user = create_user(admin)
    new_email = unique_email("moved")
    resp = patch_user(admin, user["id"], email=new_email)
    assert resp.status_code == 200, resp.text
    row = find_user(admin, user["id"])
    assert row["email"] == new_email and row["name"] == user["name"]
    assert not users_with_email(admin, user["email"])


def test_adm04_change_password_accepted_and_not_echoed(admin: Client) -> None:
    user = create_user(admin)
    new_password = "new-" + uuid.uuid4().hex
    resp = patch_user(admin, user["id"], password=new_password)
    assert resp.status_code == 200, resp.text
    assert new_password not in resp.text
    row = find_user(admin, user["id"])
    assert row["name"] == user["name"] and row["email"] == user["email"]
    # «Новый пароль работает, старый — нет» — через вход пользователя досок (T1.2).


def test_adm04_change_all_fields_at_once(admin: Client) -> None:
    user = create_user(admin)
    new_email = unique_email("all")
    resp = patch_user(admin, user["id"], name="All New", email=new_email, password="x-" + uuid.uuid4().hex)
    assert resp.status_code == 200, resp.text
    row = find_user(admin, user["id"])
    assert (row["name"], row["email"]) == ("All New", new_email)


def test_adm04_unknown_user_is_404(admin: Client) -> None:
    resp = patch_user(admin, str(uuid.uuid4()), name="Ghost")
    assert resp.status_code == 404, resp.status_code


@pytest.mark.parametrize("fields", [{"email": "broken"}, {"name": ""}, {"password": ""}])
def test_adm04_invalid_change_rejected_and_data_kept(admin: Client, fields: dict[str, Any]) -> None:
    user = create_user(admin)
    resp = patch_user(admin, user["id"], **fields)
    assert resp.status_code in {400, 422}, (resp.status_code, resp.text)
    row = find_user(admin, user["id"])
    assert (row["name"], row["email"]) == (user["name"], user["email"])


def test_adm04_anonymous_cannot_change(client: Client, admin: Client) -> None:
    user = create_user(admin)
    resp = patch_user(client, user["id"], name="Nope", email=unique_email())
    assert resp.status_code in ANON_REFUSED
    row = find_user(admin, user["id"])
    assert (row["name"], row["email"]) == (user["name"], user["email"])


# --- ADM-05: отключение -----------------------------------------------------


def test_adm05_disable_marks_account_and_keeps_it(admin: Client) -> None:
    user = create_user(admin)
    resp = patch_user(admin, user["id"], disabled=True)
    assert resp.status_code == 200, resp.text
    row = find_user(admin, user["id"])
    assert row is not None, "отключение удалило учётку"
    assert row["disabled"] is True
    assert (row["name"], row["email"]) == (user["name"], user["email"])


def test_adm05_disable_twice_is_not_error(admin: Client) -> None:
    user = create_user(admin)
    assert patch_user(admin, user["id"], disabled=True).status_code == 200
    again = patch_user(admin, user["id"], disabled=True)
    assert again.status_code == 200, again.status_code
    assert find_user(admin, user["id"])["disabled"] is True


def test_adm05_anonymous_cannot_disable(client: Client, admin: Client) -> None:
    user = create_user(admin)
    assert patch_user(client, user["id"], disabled=True).status_code in ANON_REFUSED
    assert find_user(admin, user["id"])["disabled"] is False


# --- ADM-06: включение ------------------------------------------------------


def test_adm06_enable_disabled_account(admin: Client) -> None:
    user = create_user(admin)
    assert patch_user(admin, user["id"], disabled=True).status_code == 200
    resp = patch_user(admin, user["id"], disabled=False)
    assert resp.status_code == 200, resp.text
    row = find_user(admin, user["id"])
    assert row["disabled"] is False
    assert (row["name"], row["email"]) == (user["name"], user["email"])


def test_adm06_enable_active_is_not_error(admin: Client) -> None:
    user = create_user(admin)
    resp = patch_user(admin, user["id"], disabled=False)
    assert resp.status_code == 200, resp.status_code
    assert find_user(admin, user["id"])["disabled"] is False


def test_adm06_anonymous_cannot_enable(client: Client, admin: Client) -> None:
    user = create_user(admin)
    assert patch_user(admin, user["id"], disabled=True).status_code == 200
    assert patch_user(client, user["id"], disabled=False).status_code in ANON_REFUSED
    assert find_user(admin, user["id"])["disabled"] is True


# --- ADM-07: уникальность почты ---------------------------------------------


def test_adm07_duplicate_email_rejected(admin: Client) -> None:
    user = create_user(admin)
    resp = admin.http.post("/api/admin/users", json=new_user_payload(email=user["email"]))
    assert resp.status_code in {400, 409, 422}, (resp.status_code, resp.text)
    assert len(users_with_email(admin, user["email"])) == 1


@pytest.mark.parametrize("variant", ["upper", "spaces"])
def test_adm07_same_email_other_case_or_spaces_rejected(admin: Client, variant: str) -> None:
    user = create_user(admin)
    email = user["email"].upper() if variant == "upper" else "  " + user["email"] + "  "
    resp = admin.http.post("/api/admin/users", json=new_user_payload(email=email))
    assert resp.status_code in {400, 409, 422}, (resp.status_code, resp.text)
    assert len(users_with_email(admin, user["email"])) == 1


def test_adm07_change_email_to_someone_elses_rejected(admin: Client) -> None:
    first, second = create_user(admin), create_user(admin)
    resp = patch_user(admin, second["id"], email=first["email"].upper())
    assert resp.status_code in {400, 409, 422}, (resp.status_code, resp.text)
    assert find_user(admin, first["id"])["email"] == first["email"]
    assert find_user(admin, second["id"])["email"] == second["email"]


def test_adm07_keeping_own_email_is_allowed(admin: Client) -> None:
    user = create_user(admin)
    resp = patch_user(admin, user["id"], email=user["email"], name="Same Email")
    assert resp.status_code == 200, resp.text
    assert find_user(admin, user["id"])["name"] == "Same Email"


def test_adm07_released_email_can_be_reused(admin: Client) -> None:
    user = create_user(admin)
    old = user["email"]
    assert patch_user(admin, user["id"], email=unique_email("moved")).status_code == 200
    again = create_user(admin, email=old)
    assert again["email"] == old


def test_adm07_parallel_duplicates_create_exactly_one(admin: Client, admin_creds: tuple[str, str]) -> None:
    email = unique_email("race")
    workers = 6
    with clients(admin.base_url, *[f"a{i}" for i in range(workers)]) as admins:
        for one in admins:
            assert login(one, *admin_creds).status_code == 204

        def create(one: Client) -> int:
            return one.http.post("/api/admin/users", json=new_user_payload(email=email)).status_code

        with ThreadPoolExecutor(max_workers=workers) as pool:
            codes = list(pool.map(create, admins))
    assert codes.count(201) == 1, codes
    assert all(code in {400, 409, 422} for code in codes if code != 201), codes
    assert len(users_with_email(admin, email)) == 1


# --- Архитектура: cookie, сессия, фреймы, OpenAPI ---------------------------


def test_arch_adm01_cookie_flags_on_http(client: Client, admin_creds: tuple[str, str]) -> None:
    resp = login(client, *admin_creds)
    header = _admin_cookie_header(resp)
    attrs = [part.strip().lower() for part in header.split(";")[1:]]
    assert "httponly" in attrs, header
    assert "samesite=lax" in attrs, header
    if client.base_url.startswith("http://"):
        assert "secure" not in attrs, header


def test_arch_adm02_session_ids_random(
    two_clients: tuple[Client, Client], admin_creds: tuple[str, str]
) -> None:
    values = []
    for one in two_clients:
        assert login(one, *admin_creds).status_code == 204
        values.append(one.http.cookies.get(ADMIN_COOKIE) or "")
    assert values[0] != values[1]
    for value in values:
        assert len(value) >= 22, value  # не меньше 16 байт в base64url
        assert admin_creds[0].split("@")[0].lower() not in value.lower()


@pytest.mark.parametrize("path", ["/admin/login", "/admin/users", "/admin"])
def test_arch_adm04_admin_pages_forbid_framing(client: Client, path: str) -> None:
    resp = client.http.get(path, follow_redirects=True)
    assert resp.status_code == 200, resp.status_code
    assert "text/html" in resp.headers.get("content-type", "")
    xfo = resp.headers.get("x-frame-options", "").upper()
    csp = resp.headers.get("content-security-policy", "")
    assert xfo in {"DENY", "SAMEORIGIN"} or "frame-ancestors 'none'" in csp, resp.headers


def test_arch_adm07_admin_contracts_in_openapi(client: Client) -> None:
    paths = client.http.get("/api/openapi.json").json()["paths"]
    for path in ("/api/admin/login", "/api/admin/users"):
        assert path in paths, sorted(paths)
    assert any(re.fullmatch(r"/api/admin/users/\{[^}]+\}", p) for p in paths), sorted(paths)


# --- ADM-01: первый администратор только при пустой базе ---------------------


@needs_docker
def test_adm01_restart_with_other_env_does_not_add_or_change_admin(
    client: Client, admin_creds: tuple[str, str]
) -> None:
    from test_api_skeleton import Detached, _container_env, _service_container

    env = _container_env(_service_container("api"))
    keep = ("PUBLIC_BASE_URL", "SECRET_KEY", "DATABASE_URL", "MEDIA_ROOT", "MAX_UPLOAD_BYTES")
    other_email, other_password = unique_email("admin2"), "other-" + uuid.uuid4().hex
    proc = Detached(
        {**{k: env[k] for k in keep}, "ADMIN_EMAIL": other_email, "ADMIN_PASSWORD": other_password}
    )
    try:
        proc.wait_healthy()
    finally:
        proc.remove()
    # Процесс с другими ADMIN_* стартовал на той же непустой базе.
    assert login(client, other_email, other_password).status_code == 401
    with clients(client.base_url, "old") as (old,):
        assert login(old, *admin_creds).status_code == 204
    with clients(client.base_url, "mix") as (mix,):
        assert login(mix, admin_creds[0], other_password).status_code == 401


# --- Ограничение частоты входа (ARCHITECTURE: identity) — последним ----------


def test_arch_adm03_login_attempts_limited_then_released(
    two_clients: tuple[Client, Client], admin_creds: tuple[str, str]
) -> None:
    attacker, owner = two_clients
    limited: httpx.Response | None = None
    for _ in range(30):
        resp = login(attacker, admin_creds[0], "wrong-" + uuid.uuid4().hex)
        if resp.status_code == 429:
            limited = resp
            break
        assert resp.status_code == 401, resp.status_code
    assert limited is not None, "30 неудачных входов подряд не ограничены"
    blocked = login(attacker, *admin_creds)
    assert blocked.status_code == 429 and not _gives_session(blocked)
    retry_after = int(limited.headers.get("retry-after", "60"))
    assert 0 < retry_after <= 3600
    time.sleep(retry_after + 1)
    released = login(owner, *admin_creds)
    assert released.status_code == 204, "после окна ограничения верный вход не проходит"
