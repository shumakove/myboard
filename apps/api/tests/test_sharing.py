"""Модуль sharing: ссылка на доску и вход по ней (SHR-01, SHR-02, SHR-03, SHR-05, SHR-06)."""

import re
from collections.abc import Iterator
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

import app.main  # noqa: F401  # регистрирует модели всех модулей в Base.metadata
from app.core.db import Base
from app.core.settings import Settings

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin-password"
ALICE = {"name": "Alice", "email": "alice@example.com", "password": "alice-pw"}
BOB = {"name": "Bob", "email": "bob@example.com", "password": "bob-pw"}
BASE_URL = "http://192.168.1.20:8080"
# token_urlsafe(32): 43 символа алфавита base64url без «=».
TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_-]{43}$")


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    """Клиент с сессией администратора; создаёт учётки Alice и Bob."""
    response = client.post(
        "/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    assert response.status_code == 204
    for account in (ALICE, BOB):
        assert client.post("/api/admin/users", json=account).status_code == 201
    return client


def _browser(admin: TestClient, account: dict[str, str] | None = None) -> TestClient:
    """Отдельный браузер (свои cookie) против того же приложения; без учётки — гость."""
    browser = TestClient(admin.app)
    if account is not None:
        response = browser.post(
            "/api/login", json={"email": account["email"], "password": account["password"]}
        )
        assert response.status_code == 204, response.text
    return browser


@pytest.fixture
def alice(admin: TestClient) -> Iterator[TestClient]:
    with _browser(admin, ALICE) as browser:
        yield browser


@pytest.fixture
def bob(admin: TestClient) -> Iterator[TestClient]:
    with _browser(admin, BOB) as browser:
        yield browser


@pytest.fixture
def guest(admin: TestClient) -> Iterator[TestClient]:
    with _browser(admin) as browser:
        yield browser


@pytest.fixture
def board(alice: TestClient) -> dict[str, Any]:
    response = alice.post("/api/boards", json={"title": "Roadmap"})
    assert response.status_code == 201, response.text
    created: dict[str, Any] = response.json()
    return created


def _link(owner: TestClient, board_id: str) -> dict[str, str]:
    response = owner.get(f"/api/boards/{board_id}/share")
    assert response.status_code == 200, response.text
    link: dict[str, str] = response.json()
    return link


def _reset(owner: TestClient, board_id: str) -> dict[str, str]:
    response = owner.post(f"/api/boards/{board_id}/share/reset")
    assert response.status_code == 200, response.text
    link: dict[str, str] = response.json()
    return link


def _join(browser: TestClient, token: str, name: str = "Guest") -> Any:
    return browser.post(f"/api/share/{token}/join", json={"name": name})


def _board_cookie(board_id: str) -> str:
    return f"myboard_board_{board_id.replace('-', '')}"


def _scalar(settings: Settings, sql: str, **params: Any) -> Any:
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql), params).scalar()
    finally:
        engine.dispose()


# --- SHR-01: владелец получает ссылку ------------------------------------------------


def test_shr01_owner_gets_link_built_from_public_base_url(
    alice: TestClient, board: dict[str, Any]
) -> None:
    link = _link(alice, board["id"])

    assert TOKEN_PATTERN.match(link["token"])
    assert link["url"] == f"{BASE_URL}/b/{link['token']}"
    # Токен не связан с id доски.
    assert board["id"].replace("-", "") not in link["token"]


def test_shr01_link_is_stable_until_reset(alice: TestClient, board: dict[str, Any]) -> None:
    assert _link(alice, board["id"]) == _link(alice, board["id"])


def test_shr01_each_board_has_own_random_token(alice: TestClient, board: dict[str, Any]) -> None:
    other = alice.post("/api/boards", json={"title": "Other"}).json()

    assert _link(alice, board["id"])["token"] != _link(alice, other["id"])["token"]


def test_shr01_link_of_foreign_board_is_not_found(bob: TestClient, board: dict[str, Any]) -> None:
    assert bob.get(f"/api/boards/{board['id']}/share").status_code == 404
    assert bob.post(f"/api/boards/{board['id']}/share/reset").status_code == 404


def test_shr01_link_requires_user_session(
    admin: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    for browser in (admin, guest):
        assert browser.get(f"/api/boards/{board['id']}/share").status_code == 401
        assert browser.post(f"/api/boards/{board['id']}/share/reset").status_code == 401


def test_shr01_deleted_board_has_no_link(alice: TestClient, board: dict[str, Any]) -> None:
    token = _link(alice, board["id"])["token"]
    assert alice.delete(f"/api/boards/{board['id']}").status_code == 204

    assert alice.get(f"/api/boards/{board['id']}/share").status_code == 404
    assert _refusal(alice, token) == _unknown_refusal(alice)


# --- SHR-02, SHR-03: вход по ссылке с именем, без учётной записи -------------------------


def test_shr03_link_asks_for_name_before_entry(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    token = _link(alice, board["id"])["token"]

    response = guest.get(f"/api/share/{token}")

    assert response.status_code == 200
    assert response.json() == {"title": "Roadmap", "participant": None}


def test_shr02_join_sets_board_session_cookie(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    token = _link(alice, board["id"])["token"]

    response = _join(guest, token, "  Kate  ")

    assert response.status_code == 200
    assert response.json() == {"title": "Roadmap", "participant": {"name": "Kate"}}
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{_board_cookie(board['id'])}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie
    # Сессионная cookie: живёт до закрытия браузера.
    assert "Max-Age" not in cookie
    assert "expires" not in cookie.lower()
    assert guest.get(f"/api/share/{token}").json()["participant"] == {"name": "Kate"}


@pytest.mark.parametrize("name", ["", "   ", "x" * 201])
def test_shr03_name_is_required(
    alice: TestClient, guest: TestClient, board: dict[str, Any], name: str
) -> None:
    token = _link(alice, board["id"])["token"]

    assert _join(guest, token, name).status_code == 422
    assert "set-cookie" not in guest.get(f"/api/share/{token}").headers


def test_shr03_rejoin_replaces_name(
    alice: TestClient, guest: TestClient, board: dict[str, Any], settings: Settings
) -> None:
    token = _link(alice, board["id"])["token"]
    _join(guest, token, "Kate")
    _join(guest, token, "Katherine")

    assert guest.get(f"/api/share/{token}").json()["participant"] == {"name": "Katherine"}
    assert _scalar(settings, "SELECT count(*) FROM sessions WHERE subject_type = 'guest'") == 1


def test_shr02_guest_account_does_not_appear_in_admin_panel(
    admin: TestClient, alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    before = admin.get("/api/admin/users").json()
    token = _link(alice, board["id"])["token"]

    assert _join(guest, token, "Kate").status_code == 200

    assert admin.get("/api/admin/users").json() == before


def test_shr02_guest_session_does_not_open_library(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    other = alice.post("/api/boards", json={"title": "Private"}).json()
    token = _link(alice, board["id"])["token"]
    _join(guest, token)

    assert guest.get("/api/session").json()["authenticated"] is False
    assert guest.get("/api/boards").status_code == 401
    assert guest.get(f"/api/boards/{board['id']}").status_code == 401
    assert guest.get(f"/api/boards/{other['id']}").status_code == 401
    assert guest.get(f"/api/boards/{board['id']}/share").status_code == 401


def test_shr02_board_session_is_valid_only_on_its_board(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    other = alice.post("/api/boards", json={"title": "Other"}).json()
    token = _link(alice, board["id"])["token"]
    other_token = _link(alice, other["id"])["token"]
    session = _join(guest, token).cookies[_board_cookie(board["id"])]

    # Даже подложенная под имя cookie другой доски сессия там не действует.
    guest.cookies.set(_board_cookie(other["id"]), session)

    assert guest.get(f"/api/share/{other_token}").json()["participant"] is None


# --- SHR-05: недействующая ссылка -----------------------------------------------------


def _refusal(browser: TestClient, token: str) -> tuple[int, Any, int, Any]:
    opened = browser.get(f"/api/share/{token}")
    joined = _join(browser, token)
    return opened.status_code, opened.json(), joined.status_code, joined.json()


def _unknown_refusal(browser: TestClient) -> tuple[int, Any, int, Any]:
    return _refusal(browser, "A" * 43)


def test_shr05_unknown_token_is_refused(guest: TestClient) -> None:
    status_code, body, join_status, _ = _unknown_refusal(guest)

    assert status_code == 404
    assert join_status == 404
    assert body == {"detail": "Link is not available"}
    assert "set-cookie" not in _join(guest, "A" * 43).headers


@pytest.mark.parametrize("token", ["x", "A" * 65, "A" * 500])
def test_shr05_malformed_token_gets_same_refusal(guest: TestClient, token: str) -> None:
    assert _refusal(guest, token) == _unknown_refusal(guest)


def test_shr05_revoked_token_gets_same_refusal_as_unknown(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    old = _link(alice, board["id"])["token"]
    _reset(alice, board["id"])

    assert _refusal(guest, old) == _unknown_refusal(guest)


def test_shr05_board_id_alone_does_not_open_board(guest: TestClient, board: dict[str, Any]) -> None:
    assert guest.get(f"/api/boards/{board['id']}").status_code == 401
    assert _refusal(guest, board["id"]) == _unknown_refusal(guest)


# --- SHR-06: сброс ссылки -------------------------------------------------------------


def test_shr06_reset_issues_new_link_and_revokes_old(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    old = _link(alice, board["id"])

    new = _reset(alice, board["id"])

    assert new["token"] != old["token"]
    assert TOKEN_PATTERN.match(new["token"])
    assert new["url"] == f"{BASE_URL}/b/{new['token']}"
    assert _link(alice, board["id"]) == new
    assert guest.get(f"/api/share/{old['token']}").status_code == 404
    assert guest.get(f"/api/share/{new['token']}").status_code == 200


def test_shr06_reset_revokes_sessions_issued_by_old_link(
    alice: TestClient, guest: TestClient, board: dict[str, Any], settings: Settings
) -> None:
    old = _link(alice, board["id"])["token"]
    assert _join(guest, old, "Kate").status_code == 200

    new = _reset(alice, board["id"])["token"]

    # Старая cookie в браузере осталась, но по новой ссылке имя снова запрашивается.
    assert _board_cookie(board["id"]) in guest.cookies
    assert guest.get(f"/api/share/{new}").json()["participant"] is None
    assert _scalar(settings, "SELECT count(*) FROM sessions WHERE subject_type = 'guest'") == 0
    assert _join(guest, new, "Kate").status_code == 200
    assert guest.get(f"/api/share/{new}").json()["participant"] == {"name": "Kate"}


def test_shr06_reset_keeps_owner_session_and_other_boards(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    other = alice.post("/api/boards", json={"title": "Other"}).json()
    other_token = _link(alice, other["id"])["token"]
    _join(guest, other_token, "Kate")

    _reset(alice, board["id"])

    assert alice.get("/api/boards").status_code == 200
    assert guest.get(f"/api/share/{other_token}").json()["participant"] == {"name": "Kate"}


def test_shr06_old_token_is_not_stored(
    alice: TestClient, board: dict[str, Any], settings: Settings
) -> None:
    old = _link(alice, board["id"])["token"]
    _reset(alice, board["id"])

    found = _scalar(settings, "SELECT count(*) FROM boards WHERE share_token = :old", old=old)

    assert found == 0


# --- Схема базы -----------------------------------------------------------------------


def test_migrations_match_models(client: TestClient, settings: Settings) -> None:
    # Клиент уже применил все миграции при старте.
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    finally:
        engine.dispose()

    assert diff == []
