"""Модуль media: загрузка и выдача файлов доски (IMG-01, IMG-07; ARCHITECTURE.md, раздел 8).

В тестах `MAX_UPLOAD_BYTES` = 1024 (conftest).
"""

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.core.settings import Settings

ADMIN = {"email": "admin@example.com", "password": "admin-password"}
ALICE = {"name": "Alice", "email": "alice@example.com", "password": "alice-pw"}
BOB = {"name": "Bob", "email": "bob@example.com", "password": "bob-pw"}

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect/></svg>'


@pytest.fixture
def admin(client: TestClient) -> TestClient:
    assert client.post("/api/admin/login", json=ADMIN).status_code == 204
    for account in (ALICE, BOB):
        assert client.post("/api/admin/users", json=account).status_code == 201
    return client


def _browser(admin: TestClient, account: dict[str, str] | None = None) -> TestClient:
    """Отдельный браузер (свои cookie); без учётки — посторонний или участник по ссылке."""
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
def stranger(admin: TestClient) -> Iterator[TestClient]:
    with _browser(admin) as browser:
        yield browser


@pytest.fixture
def board(alice: TestClient) -> str:
    response = alice.post("/api/boards", json={"title": "Moodboard"})
    assert response.status_code == 201, response.text
    board_id: str = response.json()["id"]
    return board_id


def _token(owner: TestClient, board_id: str) -> str:
    response = owner.get(f"/api/boards/{board_id}/share")
    assert response.status_code == 200, response.text
    token: str = response.json()["token"]
    return token


def _guest(admin: TestClient, owner: TestClient, board_id: str) -> TestClient:
    """Участник по ссылке доски: вошёл с именем, cookie этой доски у него есть."""
    guest = _browser(admin)
    token = _token(owner, board_id)
    response = guest.post(f"/api/share/{token}/join", json={"name": "Guest"})
    assert response.status_code == 200, response.text
    return guest


def _upload(
    browser: TestClient,
    board_id: str,
    content: bytes | Iterator[bytes] = PNG,
    mime: str = "image/png",
    name: str = "photo.png",
) -> Any:
    return browser.post(
        f"/api/boards/{board_id}/media",
        params={"name": name},
        content=content,
        headers={"Content-Type": mime},
    )


def _uploaded(browser: TestClient, board_id: str, **kwargs: Any) -> dict[str, Any]:
    response = _upload(browser, board_id, **kwargs)
    assert response.status_code == 201, response.text
    media: dict[str, Any] = response.json()
    return media


def _stored_files(settings: Settings) -> list[Path]:
    root = Path(settings.media_root)
    return [path for path in root.rglob("*") if path.is_file()] if root.exists() else []


# --- IMG-01: загрузка на доску ---------------------------------------------------------


def test_img01_owner_uploads_image_into_board_directory(
    alice: TestClient, board: str, settings: Settings
) -> None:
    media = _uploaded(alice, board)

    assert media["mime"] == "image/png"
    assert media["size"] == len(PNG)
    assert media["name"] == "photo.png"
    assert media["url"] == f"/api/media/{media['id']}"
    stored = Path(settings.media_root) / board / media["id"]
    assert stored.read_bytes() == PNG
    assert _stored_files(settings) == [stored]


def test_img01_owner_gets_uploaded_file_back(alice: TestClient, board: str) -> None:
    media = _uploaded(alice, board)

    response = alice.get(media["url"])

    assert response.status_code == 200
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert response.headers["x-content-type-options"] == "nosniff"
    # Право могут отозвать: копию браузер берёт только после проверки на сервере.
    assert "no-cache" in response.headers["cache-control"]


def test_img01_participant_uploads_and_sees_files_of_the_board(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    owners = _uploaded(alice, board)
    with _guest(admin, alice, board) as guest:
        own = _uploaded(guest, board, name="pasted.png")

        assert guest.get(owners["url"]).content == PNG
        assert guest.get(own["url"]).status_code == 200
    # Файл участника видит и владелец.
    assert alice.get(own["url"]).content == PNG


@pytest.mark.parametrize("mime", ["image/png", "image/jpeg", "image/gif", "image/webp"])
def test_img01_raster_types_are_accepted(alice: TestClient, board: str, mime: str) -> None:
    media = _uploaded(alice, board, mime=mime)

    assert media["mime"] == mime
    assert alice.get(media["url"]).headers["content-type"] == mime


@pytest.mark.parametrize("mime", ["text/html", "application/javascript", "", "image/bmp-x"])
def test_img01_undeclared_or_foreign_type_is_rejected(
    alice: TestClient, board: str, settings: Settings, mime: str
) -> None:
    response = _upload(alice, board, mime=mime)

    assert response.status_code == 415
    assert _stored_files(settings) == []


def test_img01_type_parameters_are_ignored(alice: TestClient, board: str) -> None:
    media = _uploaded(alice, board, mime="IMAGE/PNG; charset=binary")

    assert media["mime"] == "image/png"


def test_img01_name_keeps_only_file_name(alice: TestClient, board: str) -> None:
    assert _uploaded(alice, board, name="../../etc/passwd")["name"] == "passwd"
    assert _uploaded(alice, board, name="C:\\Users\\me\\cat.png")["name"] == "cat.png"
    assert _uploaded(alice, board, name="")["name"] == "file"


# --- MAX_UPLOAD_BYTES ------------------------------------------------------------------


def test_file_at_limit_is_accepted(alice: TestClient, board: str, settings: Settings) -> None:
    media = _uploaded(alice, board, content=b"x" * settings.max_upload_bytes)

    assert media["size"] == settings.max_upload_bytes


def test_file_over_limit_is_rejected_and_not_stored(
    alice: TestClient, board: str, settings: Settings
) -> None:
    response = _upload(alice, board, content=b"x" * (settings.max_upload_bytes + 1))

    assert response.status_code == 413
    assert _stored_files(settings) == []


def test_streamed_file_over_limit_is_rejected_without_length(
    alice: TestClient, board: str, settings: Settings
) -> None:
    """Без `Content-Length` (поток частями) лимит проверяется по прочитанному."""
    chunks = iter([b"x" * 600, b"x" * 600])

    response = _upload(alice, board, content=chunks)

    assert response.status_code == 413
    assert _stored_files(settings) == []


# --- IMG-07: SVG ------------------------------------------------------------------------


def test_img07_svg_is_uploaded_and_served_as_inert_image(alice: TestClient, board: str) -> None:
    media = _uploaded(alice, board, content=SVG, mime="image/svg+xml", name="logo.svg")

    response = alice.get(media["url"])

    assert response.status_code == 200
    assert response.content == SVG
    assert response.headers["content-type"].startswith("image/svg+xml")
    # Открытый напрямую SVG не исполняет скрипты в происхождении доски.
    policy = response.headers["content-security-policy"]
    assert "sandbox" in policy
    assert "default-src 'none'" in policy


# --- Доступ: только сессия этой доски ---------------------------------------------------


def test_file_without_session_is_not_found(
    alice: TestClient, stranger: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)

    assert stranger.get(media["url"]).status_code == 404


def test_file_with_session_of_another_board_is_not_found(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)
    other = alice.post("/api/boards", json={"title": "Other"}).json()["id"]
    with _guest(admin, alice, other) as guest:
        assert guest.get(media["url"]).status_code == 404
        # Участник другой доски сюда и не загружает.
        assert _upload(guest, board).status_code == 404


def test_file_of_foreign_board_is_not_found_for_other_user(
    alice: TestClient, bob: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)

    assert bob.get(media["url"]).status_code == 404
    assert _upload(bob, board).status_code == 404


def test_unknown_file_and_foreign_file_get_same_refusal(
    alice: TestClient, stranger: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)
    unknown = stranger.get("/api/media/00000000-0000-0000-0000-000000000000")
    foreign = stranger.get(media["url"])

    assert unknown.status_code == foreign.status_code == 404
    assert unknown.json() == foreign.json()


def test_upload_without_session_is_not_found(
    stranger: TestClient, board: str, settings: Settings
) -> None:
    assert _upload(stranger, board).status_code == 404
    assert _stored_files(settings) == []


def test_reset_link_revokes_files_for_old_cookie(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    """SHR-06: после сброса ссылки старая cookie участника файл не получает."""
    media = _uploaded(alice, board)
    with _guest(admin, alice, board) as guest:
        assert guest.get(media["url"]).status_code == 200
        assert alice.post(f"/api/boards/{board}/share/reset").status_code == 200

        assert guest.get(media["url"]).status_code == 404
        assert _upload(guest, board).status_code == 404
    # Владелец доступа не теряет.
    assert alice.get(media["url"]).status_code == 200


def test_deleted_board_files_are_not_served(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)
    with _guest(admin, alice, board) as guest:
        assert alice.delete(f"/api/boards/{board}").status_code == 204

        assert alice.get(media["url"]).status_code == 404
        assert guest.get(media["url"]).status_code == 404
        assert _upload(alice, board).status_code == 404
