"""Модуль library: список досок пользователя (ACC-04, BRD-01…BRD-06, ADM-05)."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from app.core.settings import Settings
from app.library.service import RECENT_LIMIT

ADMIN_EMAIL = "admin@example.com"
ADMIN_PASSWORD = "admin-password"
ALICE = {"name": "Alice", "email": "alice@example.com", "password": "alice-pw"}
BOB = {"name": "Bob", "email": "bob@example.com", "password": "bob-pw"}


def _db_execute(settings: Settings, sql: str, **params: Any) -> None:
    engine = create_engine(settings.database_url)
    try:
        with engine.begin() as connection:
            connection.execute(text(sql), params)
    finally:
        engine.dispose()


def _sign_in(client: TestClient, account: dict[str, str]) -> TestClient:
    response = client.post(
        "/api/login", json={"email": account["email"], "password": account["password"]}
    )
    assert response.status_code == 204, response.text
    return client


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


@pytest.fixture
def alice(admin: TestClient) -> Iterator[TestClient]:
    """Отдельный браузер Alice (свои cookie) против того же приложения."""
    with TestClient(admin.app) as browser:
        yield _sign_in(browser, ALICE)


@pytest.fixture
def bob(admin: TestClient) -> Iterator[TestClient]:
    with TestClient(admin.app) as browser:
        yield _sign_in(browser, BOB)


def _create(client: TestClient, title: str | None = None) -> dict[str, Any]:
    body = {} if title is None else {"title": title}
    response = client.post("/api/boards", json=body)
    assert response.status_code == 201, response.text
    board: dict[str, Any] = response.json()
    return board


def _titles(client: TestClient, path: str = "/api/boards", **params: str) -> list[str]:
    response = client.get(path, params=params)
    assert response.status_code == 200, response.text
    return [board["title"] for board in response.json()]


def _user_id(admin: TestClient, email: str) -> str:
    users: list[dict[str, str]] = admin.get("/api/admin/users").json()
    return next(user["id"] for user in users if user["email"] == email)


# --- Доступ ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/boards"),
        ("GET", "/api/boards/recent"),
        ("POST", "/api/boards"),
        ("GET", "/api/boards/00000000-0000-4000-8000-000000000000"),
        ("PATCH", "/api/boards/00000000-0000-4000-8000-000000000000"),
        ("DELETE", "/api/boards/00000000-0000-4000-8000-000000000000"),
    ],
)
def test_boards_require_user_session(admin: TestClient, method: str, path: str) -> None:
    # У клиента есть только сессия администратора: список досок она не открывает.
    body = {"title": "x"} if method in {"POST", "PATCH"} else None
    response = admin.request(method, path, json=body)

    assert response.status_code == 401


# --- ACC-04: список досок этого пользователя -------------------------------------------


def test_acc04_new_user_sees_empty_list(alice: TestClient) -> None:
    assert alice.get("/api/boards").json() == []
    assert alice.get("/api/boards/recent").json() == []


def test_acc04_list_contains_only_own_boards(alice: TestClient, bob: TestClient) -> None:
    _create(alice, "Alice plan")
    _create(bob, "Bob plan")

    assert _titles(alice) == ["Alice plan"]
    assert _titles(bob) == ["Bob plan"]
    assert _titles(alice, "/api/boards/recent") == ["Alice plan"]


# --- BRD-01: создание -----------------------------------------------------------------


def test_brd01_created_board_opens_by_id_and_is_listed(alice: TestClient) -> None:
    board = _create(alice, "  Project Alpha  ")

    assert board["title"] == "Project Alpha"
    assert set(board) == {"id", "title", "created_at", "updated_at"}
    assert alice.get(f"/api/boards/{board['id']}").json() == board
    assert alice.get("/api/boards").json() == [board]


def test_brd01_board_without_title_gets_default(alice: TestClient) -> None:
    assert _create(alice)["title"] == "Untitled board"


@pytest.mark.parametrize("title", ["", "   ", "x" * 201])
def test_brd01_invalid_title_is_rejected(alice: TestClient, title: str) -> None:
    assert alice.post("/api/boards", json={"title": title}).status_code == 422
    assert alice.get("/api/boards").json() == []


# --- BRD-02: переименование -----------------------------------------------------------


def test_brd02_rename_is_reflected_in_list(alice: TestClient) -> None:
    board = _create(alice, "Draft")

    response = alice.patch(f"/api/boards/{board['id']}", json={"title": "Final"})

    assert response.status_code == 200
    assert response.json()["title"] == "Final"
    assert _titles(alice) == ["Final"]
    assert alice.get(f"/api/boards/{board['id']}").json()["title"] == "Final"


@pytest.mark.parametrize("body", [{"title": " "}, {}, {"title": "x" * 201}])
def test_brd02_invalid_rename_keeps_title(alice: TestClient, body: dict[str, str]) -> None:
    board = _create(alice, "Draft")

    assert alice.patch(f"/api/boards/{board['id']}", json=body).status_code == 422
    assert _titles(alice) == ["Draft"]


# --- BRD-03: удаление -----------------------------------------------------------------


def test_brd03_deleted_board_leaves_lists_and_cannot_be_opened(alice: TestClient) -> None:
    kept = _create(alice, "Kept")
    gone = _create(alice, "Gone")

    assert alice.delete(f"/api/boards/{gone['id']}").status_code == 204

    assert _titles(alice) == ["Kept"]
    assert _titles(alice, "/api/boards/recent") == ["Kept"]
    assert _titles(alice, q="Gone") == []
    for method in ("GET", "PATCH", "DELETE"):
        body = {"title": "Back"} if method == "PATCH" else None
        response = alice.request(method, f"/api/boards/{gone['id']}", json=body)
        assert response.status_code == 404
    assert alice.get(f"/api/boards/{kept['id']}").status_code == 200


def test_brd03_delete_marks_row_instead_of_removing(alice: TestClient, settings: Settings) -> None:
    board = _create(alice, "Gone")
    alice.delete(f"/api/boards/{board['id']}")

    engine = create_engine(settings.database_url)
    with engine.connect() as connection:
        deleted_at: datetime | None = connection.execute(
            text("SELECT deleted_at FROM boards WHERE id = :id"), {"id": board["id"]}
        ).scalar_one()
    engine.dispose()
    assert deleted_at is not None


# --- BRD-04: недавние и полный список -------------------------------------------------


def test_brd04_recent_is_ordered_by_last_change(alice: TestClient) -> None:
    first = _create(alice, "First")
    _create(alice, "Second")
    _create(alice, "Third")
    assert _titles(alice, "/api/boards/recent") == ["Third", "Second", "First"]

    # Переименование — изменение доски: она поднимается наверх.
    alice.patch(f"/api/boards/{first['id']}", json={"title": "First renamed"})

    assert _titles(alice, "/api/boards/recent") == ["First renamed", "Third", "Second"]


def test_brd04_recent_is_limited_but_full_list_is_not(alice: TestClient) -> None:
    for number in range(RECENT_LIMIT + 2):
        _create(alice, f"Board {number}")

    recent = _titles(alice, "/api/boards/recent")

    assert len(recent) == RECENT_LIMIT
    assert recent[0] == f"Board {RECENT_LIMIT + 1}"
    assert len(_titles(alice)) == RECENT_LIMIT + 2


# --- BRD-05: сортировка и фильтр ------------------------------------------------------


def test_brd05_sort_by_last_change_creation_and_title(alice: TestClient) -> None:
    beta = _create(alice, "beta")
    _create(alice, "Alpha")
    _create(alice, "gamma")
    alice.patch(f"/api/boards/{beta['id']}", json={"title": "Beta"})

    assert _titles(alice) == ["Beta", "gamma", "Alpha"]
    assert _titles(alice, sort="updated") == ["Beta", "gamma", "Alpha"]
    assert _titles(alice, sort="created") == ["gamma", "Alpha", "Beta"]
    # Название — по алфавиту без учёта регистра.
    assert _titles(alice, sort="title") == ["Alpha", "Beta", "gamma"]


def test_brd05_unknown_sort_is_rejected(alice: TestClient) -> None:
    assert alice.get("/api/boards", params={"sort": "owner"}).status_code == 422


def test_brd05_filter_by_last_change(alice: TestClient, settings: Settings) -> None:
    old = _create(alice, "Old")
    _create(alice, "Fresh")
    month_ago = datetime.now(UTC) - timedelta(days=30)
    _db_execute(
        settings, "UPDATE boards SET updated_at = :t WHERE id = :id", t=month_ago, id=old["id"]
    )

    week_ago = (datetime.now(UTC) - timedelta(days=7)).isoformat()

    assert _titles(alice, modified_since=week_ago) == ["Fresh"]
    assert _titles(alice) == ["Fresh", "Old"]
    # Фильтр и сортировка сочетаются с поиском.
    assert _titles(alice, modified_since=week_ago, q="old") == []


# --- BRD-06: поиск по названию --------------------------------------------------------


def test_brd06_search_by_part_of_title_ignores_case(alice: TestClient) -> None:
    for title in ("Roadmap 2026", "Team retro", "ROAD trip"):
        _create(alice, title)

    assert sorted(_titles(alice, q="road")) == ["ROAD trip", "Roadmap 2026"]
    assert _titles(alice, q=" retro ") == ["Team retro"]
    assert _titles(alice, q="missing") == []
    assert len(_titles(alice, q="")) == 3


def test_brd06_wildcards_in_query_are_literal(alice: TestClient) -> None:
    _create(alice, "100% done")
    _create(alice, "snake_case")
    _create(alice, "plain")

    assert _titles(alice, q="%") == ["100% done"]
    assert _titles(alice, q="_") == ["snake_case"]


# --- Изоляция: чужие доски не видны и не открываются ----------------------------------


def test_other_users_board_is_indistinguishable_from_missing(
    alice: TestClient, bob: TestClient
) -> None:
    board = _create(alice, "Secret")
    missing = "00000000-0000-4000-8000-000000000000"

    for board_id in (board["id"], missing):
        assert bob.get(f"/api/boards/{board_id}").json() == {"detail": "Board not found"}
        assert bob.patch(f"/api/boards/{board_id}", json={"title": "Mine"}).status_code == 404
        assert bob.delete(f"/api/boards/{board_id}").status_code == 404

    assert _titles(bob, q="Secret") == []
    assert _titles(alice) == ["Secret"]


# --- ADM-05: отключённый пользователь теряет доступ, доски сохраняются -----------------


def test_adm05_disabled_user_boards_survive(admin: TestClient, alice: TestClient) -> None:
    board = _create(alice, "Keep me")
    user_id = _user_id(admin, ALICE["email"])

    admin.patch(f"/api/admin/users/{user_id}", json={"disabled": True})

    # Сессия отключённой учётки больше не открывает список (ACC-05 уводит вкладку на вход).
    assert alice.get("/api/boards").status_code == 401
    assert alice.get(f"/api/boards/{board['id']}").status_code == 401

    admin.patch(f"/api/admin/users/{user_id}", json={"disabled": False})
    _sign_in(alice, ALICE)

    assert alice.get("/api/boards").json() == [board]


def test_password_change_revokes_access_to_boards(admin: TestClient, alice: TestClient) -> None:
    _create(alice, "Plan")

    admin.patch(f"/api/admin/users/{_user_id(admin, ALICE['email'])}", json={"password": "new"})

    assert alice.get("/api/boards").status_code == 401
