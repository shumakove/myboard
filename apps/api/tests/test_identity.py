"""Модуль identity: администратор и учётные записи (ADM-*), вход пользователя досок (ACC-*)."""

import hashlib
import uuid
from typing import Any

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.settings import Settings
from app.identity.rate_limit import MAX_FAILURES, LoginRateLimiter
from app.identity.sessions import ADMIN_COOKIE, USER_COOKIE, USER_COOKIE_MAX_AGE
from app.main import create_app

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin-password"
LOGIN_FAILED = {"detail": "Invalid email or password"}


def _login(client: TestClient, email: str = ADMIN_EMAIL, password: str = ADMIN_PASSWORD) -> Any:
    return client.post("/api/admin/login", json={"email": email, "password": password})


def _create_user(client: TestClient, **fields: str) -> Any:
    body = {"name": "Alice", "email": "alice@example.com", "password": "alice-pw"} | fields
    return client.post("/api/admin/users", json=body)


def _users(client: TestClient) -> list[dict[str, Any]]:
    response = client.get("/api/admin/users")
    assert response.status_code == 200
    users: list[dict[str, Any]] = response.json()
    return users


def _db_scalar(settings: Settings, sql: str, **params: Any) -> Any:
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql), params).scalar()
    finally:
        engine.dispose()


def _db_execute(settings: Settings, sql: str, **params: Any) -> None:
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text(sql), params)
    finally:
        engine.dispose()


def _password_matches(settings: Settings, email: str, password: str) -> bool:
    stored = _db_scalar(settings, "SELECT password_hash FROM users WHERE email = :e", e=email)
    try:
        return PasswordHasher().verify(stored, password)
    except Exception:
        return False


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    """Клиент с сессией администратора из ADMIN_EMAIL/ADMIN_PASSWORD."""
    assert _login(client).status_code == 204
    return client


# --- ADM-01: вход администратора ------------------------------------------------------


def test_adm01_first_admin_from_env_signs_in(client: TestClient) -> None:
    response = _login(client)

    assert response.status_code == 204
    assert client.get("/api/admin/session").json() == {
        "authenticated": True,
        "email": ADMIN_EMAIL,
    }


def test_adm01_admin_email_is_case_insensitive(client: TestClient) -> None:
    assert _login(client, email="  Admin@Example.COM ").status_code == 204


def test_adm01_session_cookie_flags_on_http(client: TestClient) -> None:
    cookie = _login(client).headers["set-cookie"]

    assert cookie.startswith(f"{ADMIN_COOKIE}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Path=/" in cookie
    assert "Secure" not in cookie


def test_adm01_session_cookie_is_secure_on_https(settings: Settings) -> None:
    https = settings.model_copy(update={"public_base_url": "https://board.example.com"})
    with TestClient(create_app(https), base_url="https://testserver") as client:
        assert "Secure" in _login(client).headers["set-cookie"]


def test_adm01_session_id_is_random_and_stored_hashed(
    client: TestClient, settings: Settings
) -> None:
    first = _login(client).cookies[ADMIN_COOKIE]
    second = _login(client).cookies[ADMIN_COOKIE]

    assert first != second
    assert len(first) >= 43  # 32 случайных байта
    stored = _db_scalar(
        settings, "SELECT count(*) FROM sessions WHERE id IN (:a, :b)", a=first, b=second
    )
    assert stored == 0


@pytest.mark.parametrize(
    ("email", "password"),
    [
        (ADMIN_EMAIL, "wrong-password"),
        ("nobody@example.com", ADMIN_PASSWORD),
        ("", ""),
        ("not-an-email", "x"),
    ],
)
def test_adm01_wrong_credentials_get_same_refusal(
    client: TestClient, email: str, password: str
) -> None:
    response = _login(client, email, password)

    assert response.status_code == 401
    assert response.json() == LOGIN_FAILED
    assert "set-cookie" not in response.headers


def test_adm01_board_user_cannot_sign_in_to_panel(admin: TestClient) -> None:
    _create_user(admin, email="bob@example.com", password="bob-pw")
    admin.cookies.clear()

    response = _login(admin, "bob@example.com", "bob-pw")

    assert response.status_code == 401
    assert response.json() == LOGIN_FAILED


def test_adm01_first_admin_created_only_for_empty_table(settings: Settings) -> None:
    with TestClient(create_app(settings)) as client:
        assert _login(client).status_code == 204
    changed = settings.model_copy(
        update={"admin_email": "other@example.com", "admin_password": "other-password"}
    )

    with TestClient(create_app(changed)) as client:
        assert _login(client).status_code == 204
        assert _login(client, "other@example.com", "other-password").status_code == 401
    assert _db_scalar(settings, "SELECT count(*) FROM admins") == 1


def test_adm01_admin_password_stored_as_argon2id(client: TestClient, settings: Settings) -> None:
    stored = _db_scalar(settings, "SELECT password_hash FROM admins")

    assert stored.startswith("$argon2id$")
    assert ADMIN_PASSWORD not in stored


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/admin/users"),
        ("POST", "/api/admin/users"),
        ("PATCH", f"/api/admin/users/{uuid.uuid4()}"),
    ],
)
@pytest.mark.parametrize("cookie", [None, "forged-session-id"])
def test_adm01_panel_api_requires_admin_session(
    client: TestClient, method: str, path: str, cookie: str | None
) -> None:
    if cookie:
        client.cookies.set(ADMIN_COOKIE, cookie)

    response = client.request(method, path, json={})

    assert response.status_code == 401


def test_adm01_board_user_session_does_not_open_panel(
    admin: TestClient, settings: Settings
) -> None:
    user_id = _create_user(admin).json()["id"]
    token = "user-session-token"
    digest = hashlib.sha256(token.encode()).hexdigest()
    _db_execute(
        settings,
        "INSERT INTO sessions (id, subject_type, subject_id) VALUES (:d, 'user', :u)",
        d=digest,
        u=user_id,
    )
    admin.cookies.set(ADMIN_COOKIE, token)

    assert admin.get("/api/admin/users").status_code == 401


def test_adm01_logout_revokes_session(admin: TestClient) -> None:
    token = admin.cookies[ADMIN_COOKIE]

    response = admin.post("/api/admin/logout")

    assert response.status_code == 204
    assert f'{ADMIN_COOKIE}=""' in response.headers["set-cookie"]
    admin.cookies.set(ADMIN_COOKIE, token)
    assert admin.get("/api/admin/users").status_code == 401
    assert admin.get("/api/admin/session").json() == {"authenticated": False, "email": None}


def test_adm01_session_endpoint_without_cookie(client: TestClient) -> None:
    response = client.get("/api/admin/session")

    assert response.status_code == 200
    assert response.json() == {"authenticated": False, "email": None}


# --- Ограничение частоты попыток входа --------------------------------------------------


def test_login_attempts_limited_per_address(client: TestClient) -> None:
    for _ in range(MAX_FAILURES):
        assert _login(client, password="wrong").status_code == 401

    response = _login(client)  # даже верный пароль, пока окно не прошло

    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0
    assert "set-cookie" not in response.headers


def test_rate_limiter_releases_address_after_window() -> None:
    now = [0.0]
    limiter = LoginRateLimiter(max_failures=3, window=60, clock=lambda: now[0])
    for _ in range(3):
        limiter.record_failure("10.0.0.1")

    assert limiter.retry_after("10.0.0.1") == 60
    assert limiter.retry_after("10.0.0.2") is None
    now[0] = 59.5
    assert limiter.retry_after("10.0.0.1") == 1
    now[0] = 60.0
    assert limiter.retry_after("10.0.0.1") is None


# --- ADM-02, ADM-03: список и создание ------------------------------------------------


def test_adm02_list_is_empty_without_users(admin: TestClient) -> None:
    assert _users(admin) == []


def test_adm03_created_user_appears_in_list(admin: TestClient, settings: Settings) -> None:
    response = _create_user(admin, name="Alice", email="Alice@Example.com", password="alice-pw")

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Alice"
    assert created["email"] == "alice@example.com"
    assert created["disabled"] is False
    assert "password" not in created
    assert "password_hash" not in created
    assert _users(admin) == [created]
    assert _password_matches(settings, "alice@example.com", "alice-pw")


def test_adm02_list_keeps_creation_order(admin: TestClient) -> None:
    for name in ("Ann", "Ben", "Cid"):
        _create_user(admin, name=name, email=f"{name.lower()}@example.com")

    assert [user["name"] for user in _users(admin)] == ["Ann", "Ben", "Cid"]


@pytest.mark.parametrize(
    "fields",
    [
        {"name": "   "},
        {"email": "not-an-email"},
        {"email": "two@@example.com"},
        {"password": ""},
    ],
)
def test_adm03_invalid_fields_rejected(admin: TestClient, fields: dict[str, str]) -> None:
    assert _create_user(admin, **fields).status_code == 422
    assert _users(admin) == []


# --- ADM-04: изменение ------------------------------------------------------------------


def test_adm04_update_name_email_password(admin: TestClient, settings: Settings) -> None:
    user_id = _create_user(admin).json()["id"]

    response = admin.patch(
        f"/api/admin/users/{user_id}",
        json={"name": "Alice Smith", "email": "smith@example.com", "password": "new-pw"},
    )

    assert response.status_code == 200
    assert [(u["name"], u["email"]) for u in _users(admin)] == [
        ("Alice Smith", "smith@example.com")
    ]
    assert _password_matches(settings, "smith@example.com", "new-pw")
    assert not _password_matches(settings, "smith@example.com", "alice-pw")


def test_adm04_partial_update_keeps_other_fields(admin: TestClient, settings: Settings) -> None:
    user_id = _create_user(admin).json()["id"]

    admin.patch(f"/api/admin/users/{user_id}", json={"name": "Renamed"})

    [user] = _users(admin)
    assert (user["name"], user["email"]) == ("Renamed", "alice@example.com")
    assert _password_matches(settings, "alice@example.com", "alice-pw")


def test_adm04_unknown_user_not_found(admin: TestClient) -> None:
    response = admin.patch(f"/api/admin/users/{uuid.uuid4()}", json={"name": "X"})

    assert response.status_code == 404


def test_adm04_unknown_field_rejected(admin: TestClient) -> None:
    user_id = _create_user(admin).json()["id"]

    assert admin.patch(f"/api/admin/users/{user_id}", json={"role": "admin"}).status_code == 422


# --- ADM-05, ADM-06: отключение и включение --------------------------------------------


def test_adm05_disable_marks_user_and_revokes_sessions(
    admin: TestClient, settings: Settings
) -> None:
    user_id = _create_user(admin).json()["id"]
    _db_execute(
        settings,
        "INSERT INTO sessions (id, subject_type, subject_id) VALUES ('s1', 'user', :u)",
        u=user_id,
    )

    response = admin.patch(f"/api/admin/users/{user_id}", json={"disabled": True})

    assert response.status_code == 200
    assert _users(admin)[0]["disabled"] is True
    assert (
        _db_scalar(settings, "SELECT count(*) FROM sessions WHERE subject_id = :u", u=user_id) == 0
    )


def test_adm06_enable_disabled_user(admin: TestClient) -> None:
    user_id = _create_user(admin).json()["id"]
    admin.patch(f"/api/admin/users/{user_id}", json={"disabled": True})

    response = admin.patch(f"/api/admin/users/{user_id}", json={"disabled": False})

    assert response.status_code == 200
    assert _users(admin)[0]["disabled"] is False


# --- ADM-07: уникальность почты ---------------------------------------------------------


@pytest.mark.parametrize("email", ["alice@example.com", " ALICE@example.com "])
def test_adm07_duplicate_email_rejected_on_create(admin: TestClient, email: str) -> None:
    _create_user(admin)

    response = _create_user(admin, name="Other", email=email)

    assert response.status_code == 409
    assert response.json() == {"detail": "Email is already in use"}
    assert len(_users(admin)) == 1


def test_adm07_duplicate_email_rejected_on_update(admin: TestClient) -> None:
    _create_user(admin)
    bob = _create_user(admin, name="Bob", email="bob@example.com").json()

    response = admin.patch(
        f"/api/admin/users/{bob['id']}", json={"name": "Bobby", "email": "Alice@example.com"}
    )

    assert response.status_code == 409
    assert [(u["name"], u["email"]) for u in _users(admin)] == [
        ("Alice", "alice@example.com"),
        ("Bob", "bob@example.com"),
    ]


def test_adm07_keeping_own_email_is_allowed(admin: TestClient) -> None:
    user_id = _create_user(admin).json()["id"]

    response = admin.patch(f"/api/admin/users/{user_id}", json={"email": "ALICE@example.com"})

    assert response.status_code == 200


def test_adm07_uniqueness_enforced_by_database(admin: TestClient, settings: Settings) -> None:
    _create_user(admin)

    with pytest.raises(Exception, match="uq_users_email"):
        _db_execute(
            settings,
            "INSERT INTO users (id, email, name, password_hash)"
            " VALUES (:i, 'alice@example.com', 'x', 'x')",
            i=str(uuid.uuid4()),
        )


# --- ACC-01…ACC-03: вход пользователя досок ----------------------------------------------

USER_EMAIL = "alice@example.com"
USER_PASSWORD = "alice-pw"
SIGNED_OUT = {"authenticated": False, "name": None, "email": None}


def _user_login(client: TestClient, email: str = USER_EMAIL, password: str = USER_PASSWORD) -> Any:
    return client.post("/api/login", json={"email": email, "password": password})


def _account_session(client: TestClient) -> Any:
    response = client.get("/api/session")
    assert response.status_code == 200
    return response.json()


@pytest.fixture
def board_user(admin: TestClient) -> str:
    """Пользователь досок alice@example.com, созданный администратором; клиент без cookie."""
    user_id: str = _create_user(admin, email=USER_EMAIL, password=USER_PASSWORD).json()["id"]
    return user_id


def _as_admin(client: TestClient) -> TestClient:
    client.cookies.clear()
    assert _login(client).status_code == 204
    return client


def test_acc01_user_signs_in_with_credentials_from_admin(
    client: TestClient, board_user: str
) -> None:
    client.cookies.clear()

    response = _user_login(client, "  Alice@Example.COM ", USER_PASSWORD)

    assert response.status_code == 204
    assert _account_session(client) == {
        "authenticated": True,
        "name": "Alice",
        "email": USER_EMAIL,
    }


def test_acc01_user_cookie_flags_and_random_value(
    client: TestClient, board_user: str, settings: Settings
) -> None:
    client.cookies.clear()
    first = _user_login(client)
    second = _user_login(client)
    cookie = first.headers["set-cookie"]

    assert cookie.startswith(f"{USER_COOKIE}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie
    tokens = [first.cookies[USER_COOKIE], second.cookies[USER_COOKIE]]
    assert tokens[0] != tokens[1]
    assert len(tokens[0]) >= 43
    stored = _db_scalar(
        settings, "SELECT count(*) FROM sessions WHERE id IN (:a, :b)", a=tokens[0], b=tokens[1]
    )
    assert stored == 0


def test_acc01_user_cookie_is_secure_on_https(settings: Settings) -> None:
    https = settings.model_copy(update={"public_base_url": "https://board.example.com"})
    with TestClient(create_app(https), base_url="https://testserver") as client:
        _login(client)
        _create_user(client, email=USER_EMAIL, password=USER_PASSWORD)
        client.cookies.clear()
        assert "Secure" in _user_login(client).headers["set-cookie"]


@pytest.mark.parametrize(
    ("email", "password"),
    [
        (USER_EMAIL, "wrong-password"),
        ("nobody@example.com", USER_PASSWORD),
        (ADMIN_EMAIL, ADMIN_PASSWORD),  # администратор — не пользователь досок
        ("", ""),
    ],
)
def test_acc02_wrong_credentials_get_same_refusal(
    client: TestClient, board_user: str, email: str, password: str
) -> None:
    client.cookies.clear()

    response = _user_login(client, email, password)

    assert response.status_code == 401
    assert response.json() == LOGIN_FAILED
    assert "set-cookie" not in response.headers
    assert _account_session(client) == SIGNED_OUT


def test_acc02_disabled_user_gets_same_refusal(client: TestClient, board_user: str) -> None:
    client.patch(f"/api/admin/users/{board_user}", json={"disabled": True})
    client.cookies.clear()

    response = _user_login(client)

    assert response.status_code == 401
    assert response.json() == LOGIN_FAILED
    assert "set-cookie" not in response.headers


def test_adm05_adm06_disable_blocks_and_enable_restores_sign_in(
    client: TestClient, board_user: str
) -> None:
    client.cookies.clear()
    assert _user_login(client).status_code == 204
    user_token = client.cookies[USER_COOKIE]

    _as_admin(client).patch(f"/api/admin/users/{board_user}", json={"disabled": True})
    client.cookies.clear()
    client.cookies.set(USER_COOKIE, user_token)
    assert _account_session(client) == SIGNED_OUT  # выданная сессия больше не действует
    assert _user_login(client).status_code == 401

    _as_admin(client).patch(f"/api/admin/users/{board_user}", json={"disabled": False})
    client.cookies.clear()
    assert _user_login(client).status_code == 204  # прежний пароль снова работает


def test_adm04_new_password_and_email_work_old_do_not(client: TestClient, board_user: str) -> None:
    client.patch(
        f"/api/admin/users/{board_user}",
        json={"email": "alice.new@example.com", "password": "new-pw"},
    )
    client.cookies.clear()

    assert _user_login(client, USER_EMAIL, USER_PASSWORD).status_code == 401
    assert _user_login(client, USER_EMAIL, "new-pw").status_code == 401
    assert _user_login(client, "alice.new@example.com", USER_PASSWORD).status_code == 401
    assert _user_login(client, "alice.new@example.com", "new-pw").status_code == 204


def _user_tokens(client: TestClient, count: int, email: str = USER_EMAIL) -> list[str]:
    """Несколько независимых сессий пользователя (как в разных браузерах)."""
    tokens = []
    for _ in range(count):
        client.cookies.clear()
        assert _user_login(client, email).status_code == 204
        tokens.append(client.cookies[USER_COOKIE])
    return tokens


def _signed_in(client: TestClient, token: str) -> bool:
    client.cookies.clear()
    client.cookies.set(USER_COOKIE, token)
    authenticated: bool = _account_session(client)["authenticated"]
    return authenticated


def test_adm04_password_change_revokes_all_sessions_of_account(
    client: TestClient, board_user: str
) -> None:
    tokens = _user_tokens(client, 2)
    _create_user(_as_admin(client), email="bob@example.com")  # пароль тот же, что у Alice
    other_token = _user_tokens(client, 1, "bob@example.com")[0]

    response = _as_admin(client).patch(
        f"/api/admin/users/{board_user}", json={"password": "new-pw"}
    )

    assert response.status_code == 200
    assert client.get("/api/admin/users").status_code == 200  # сессия администратора жива
    assert not any(_signed_in(client, token) for token in tokens)
    assert _signed_in(client, other_token)  # чужие сессии не затронуты
    client.cookies.clear()
    assert _user_login(client, USER_EMAIL, "new-pw").status_code == 204
    assert _account_session(client)["authenticated"] is True


@pytest.mark.parametrize(
    "change",
    [{"name": "Alice Smith"}, {"email": "alice.new@example.com"}, {"name": "A", "email": "a@x.io"}],
)
def test_adm04_name_or_email_change_keeps_sessions(
    client: TestClient, board_user: str, change: dict[str, str]
) -> None:
    token = _user_tokens(client, 1)[0]

    response = _as_admin(client).patch(f"/api/admin/users/{board_user}", json=change)

    assert response.status_code == 200
    assert _signed_in(client, token)


def test_adm04_rejected_update_keeps_password_and_sessions(
    client: TestClient, board_user: str
) -> None:
    token = _user_tokens(client, 1)[0]
    _create_user(_as_admin(client), email="bob@example.com")

    response = client.patch(
        f"/api/admin/users/{board_user}",
        json={"email": "bob@example.com", "password": "new-pw"},
    )

    assert response.status_code == 409
    assert _signed_in(client, token)
    client.cookies.clear()
    assert _user_login(client, USER_EMAIL, USER_PASSWORD).status_code == 204


def test_acc02_login_attempts_limited_per_address(client: TestClient, board_user: str) -> None:
    client.cookies.clear()
    for _ in range(MAX_FAILURES):
        assert _user_login(client, password="wrong").status_code == 401

    response = _user_login(client)  # даже верный пароль, пока окно не прошло

    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0
    assert "set-cookie" not in response.headers


def test_acc02_user_and_admin_limits_are_separate(client: TestClient, board_user: str) -> None:
    client.cookies.clear()
    for _ in range(MAX_FAILURES):
        _user_login(client, password="wrong")

    assert _login(client).status_code == 204


def test_acc03_session_persists_between_visits(client: TestClient, board_user: str) -> None:
    client.cookies.clear()
    cookie = _user_login(client).headers["set-cookie"]
    token = client.cookies[USER_COOKIE]

    # Cookie с Max-Age переживает закрытие браузера; сессия в базе бессрочна.
    assert f"Max-Age={USER_COOKIE_MAX_AGE}" in cookie
    client.cookies.clear()
    client.cookies.set(USER_COOKIE, token)  # «новый визит» с сохранённой cookie
    session = client.get("/api/session")
    assert session.json()["authenticated"] is True
    assert f"Max-Age={USER_COOKIE_MAX_AGE}" in session.headers["set-cookie"]  # продление


def test_acc03_logout_ends_session(client: TestClient, board_user: str) -> None:
    client.cookies.clear()
    _user_login(client)
    token = client.cookies[USER_COOKIE]

    response = client.post("/api/logout")

    assert response.status_code == 204
    assert f'{USER_COOKIE}=""' in response.headers["set-cookie"]
    client.cookies.set(USER_COOKIE, token)  # скопированная cookie тоже не действует
    assert _account_session(client) == SIGNED_OUT


def test_acc03_session_without_cookie_or_forged(client: TestClient) -> None:
    assert _account_session(client) == SIGNED_OUT
    client.cookies.set(USER_COOKIE, "forged-session-id")
    response = client.get("/api/session")
    assert response.json() == SIGNED_OUT
    assert "set-cookie" not in response.headers


def test_acc01_user_session_does_not_open_panel(client: TestClient, board_user: str) -> None:
    client.cookies.clear()
    _user_login(client)

    assert client.get("/api/admin/users").status_code == 401
    assert client.get("/api/admin/session").json() == {"authenticated": False, "email": None}


def test_acc01_admin_session_is_not_user_session(admin: TestClient) -> None:
    admin.cookies.set(USER_COOKIE, admin.cookies[ADMIN_COOKIE])

    assert _account_session(admin) == SIGNED_OUT


def test_acc01_login_contract_in_openapi(client: TestClient) -> None:
    paths = client.get("/api/openapi.json").json()["paths"]

    assert {"/api/login", "/api/logout", "/api/session"} <= paths.keys()
