"""Модуль media: загрузка, выдача, копирование файлов доски (IMG-*, FIL-*, CVS-20; раздел 8).

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
    # Во фрейме файл не показывается (раздел 12 архитектуры).
    assert "frame-ancestors 'none'" in policy


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


# --- CVS-20: вставка на другую доску (BUG-028) -------------------------------------------


def _second_board(owner: TestClient) -> str:
    response = owner.post("/api/boards", json={"title": "Target"})
    assert response.status_code == 201, response.text
    board_id: str = response.json()["id"]
    return board_id


def _copy(browser: TestClient, board_id: str, *media_ids: str) -> Any:
    return browser.post(f"/api/boards/{board_id}/media/copies", json={"media": list(media_ids)})


def _copied(browser: TestClient, board_id: str, media_id: str) -> str:
    response = _copy(browser, board_id, media_id)
    assert response.status_code == 200, response.text
    copy: str = response.json()["copies"][media_id]
    return copy


def _join(browser: TestClient, owner: TestClient, board_id: str) -> None:
    token = _token(owner, board_id)
    response = browser.post(f"/api/share/{token}/join", json={"name": "Guest"})
    assert response.status_code == 200, response.text


def test_cvs20_copy_is_a_file_of_the_target_board(
    alice: TestClient, board: str, settings: Settings
) -> None:
    media = _uploaded(alice, board, name="photo.png")
    target = _second_board(alice)

    copy = _copied(alice, target, media["id"])

    assert copy != media["id"]
    assert (Path(settings.media_root) / target / copy).read_bytes() == PNG
    response = alice.get(f"/api/media/{copy}")
    assert response.content == PNG
    assert response.headers["content-type"] == "image/png"
    assert "photo.png" in response.headers["content-disposition"]


def test_cvs20_participant_of_target_board_sees_copy_but_not_source(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    """BUG-028, вариант А: участник доски B видит вставленное на неё изображение."""
    media = _uploaded(alice, board)
    target = _second_board(alice)
    copy = _copied(alice, target, media["id"])

    with _guest(admin, alice, target) as guest:
        assert guest.get(f"/api/media/{copy}").content == PNG
        # Исходный файл остаётся файлом доски A.
        assert guest.get(media["url"]).status_code == 404


def test_cvs20_copy_survives_deletion_of_source_board(alice: TestClient, board: str) -> None:
    """BUG-028, вариант Б: копия не зависит от судьбы исходной доски."""
    media = _uploaded(alice, board)
    target = _second_board(alice)
    copy = _copied(alice, target, media["id"])

    assert alice.delete(f"/api/boards/{board}").status_code == 204

    assert alice.get(media["url"]).status_code == 404
    assert alice.get(f"/api/media/{copy}").content == PNG


def test_cvs20_owner_pastes_image_after_deleting_source_board(
    alice: TestClient, board: str
) -> None:
    """Скопировал, удалил исходную доску и только потом вставил: файл всё ещё его."""
    media = _uploaded(alice, board)
    target = _second_board(alice)
    assert alice.delete(f"/api/boards/{board}").status_code == 204

    copy = _copied(alice, target, media["id"])

    assert alice.get(f"/api/media/{copy}").content == PNG
    assert alice.get(media["url"]).status_code == 404


def test_cvs20_file_of_same_board_is_not_copied(
    alice: TestClient, board: str, settings: Settings
) -> None:
    media = _uploaded(alice, board)

    assert _copied(alice, board, media["id"]) == media["id"]
    assert len(_stored_files(settings)) == 1


def test_cvs20_repeated_id_gives_one_copy(
    alice: TestClient, board: str, settings: Settings
) -> None:
    media = _uploaded(alice, board)
    target = _second_board(alice)

    response = _copy(alice, target, media["id"], media["id"])

    assert len(response.json()["copies"]) == 1
    assert len(_stored_files(settings)) == 2


def test_cvs20_foreign_file_is_not_copied_and_looks_like_unknown(
    alice: TestClient, bob: TestClient, board: str, settings: Settings
) -> None:
    """Чужой файл не утекает на свою доску, и его не отличить от несуществующего."""
    media = _uploaded(alice, board)
    own_board = _second_board(bob)
    unknown = "00000000-0000-0000-0000-000000000000"

    foreign = _copy(bob, own_board, media["id"])

    assert foreign.status_code == 200
    assert foreign.json() == {"copies": {}}
    assert _copy(bob, own_board, unknown).json() == foreign.json()
    assert len(_stored_files(settings)) == 1


def test_cvs20_participant_of_deleted_source_board_cannot_copy(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    """Исключение для корзины — только владельцу: участник с удалением теряет доступ."""
    media = _uploaded(alice, board)
    target = _second_board(alice)
    with _guest(admin, alice, board) as guest:
        _join(guest, alice, target)
        assert alice.delete(f"/api/boards/{board}").status_code == 204

        assert _copy(guest, target, media["id"]).json() == {"copies": {}}


def test_cvs20_old_cookie_after_reset_cannot_copy(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    """SHR-06: отозванная ссылка не даёт вынести файл на другую доску."""
    media = _uploaded(alice, board)
    target = _second_board(alice)
    with _guest(admin, alice, board) as guest:
        _join(guest, alice, target)
        assert alice.post(f"/api/boards/{board}/share/reset").status_code == 200

        assert _copy(guest, target, media["id"]).json() == {"copies": {}}


def test_cvs20_participant_with_both_sessions_copies(
    admin: TestClient, alice: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)
    target = _second_board(alice)
    with _guest(admin, alice, board) as guest:
        _join(guest, alice, target)

        copy = _copied(guest, target, media["id"])

        assert guest.get(f"/api/media/{copy}").content == PNG


def test_cvs20_copy_needs_session_of_target_board(
    alice: TestClient, bob: TestClient, stranger: TestClient, board: str
) -> None:
    media = _uploaded(alice, board)

    assert _copy(stranger, board, media["id"]).status_code == 404
    assert _copy(bob, board, media["id"]).status_code == 404


def test_cvs20_source_file_missing_on_disk_is_skipped(
    alice: TestClient, board: str, settings: Settings
) -> None:
    media = _uploaded(alice, board)
    target = _second_board(alice)
    (Path(settings.media_root) / board / media["id"]).unlink()

    assert _copy(alice, target, media["id"]).json() == {"copies": {}}
    assert _stored_files(settings) == []


# --- FIL-01…FIL-04: файлы, PDF, видео и аудио ---------------------------------------


def _upload_file(browser: TestClient, board_id: str, content: bytes = b"data") -> dict[str, Any]:
    response = browser.post(
        f"/api/boards/{board_id}/media",
        params={"name": "draft.bin", "kind": "file"},
        content=content,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 201, response.text
    body: dict[str, Any] = response.json()
    return body


@pytest.mark.parametrize(
    "mime",
    [
        "application/pdf",
        "video/mp4",
        "video/x-m4v",
        "video/quicktime",
        "video/webm",
        "audio/mpeg",
        "audio/mp4",
        "audio/x-m4a",
        "audio/wav",
        "audio/x-wav",
        "audio/webm",
    ],
)
def test_fil02_fil03_fil04_formats_uploaded_and_served(
    alice: TestClient, board: str, mime: str
) -> None:
    response = alice.post(
        f"/api/boards/{board}/media",
        params={"name": "clip"},
        content=b"media-bytes",
        headers={"Content-Type": mime},
    )
    assert response.status_code == 201, response.text
    served = alice.get(response.json()["url"])
    assert served.status_code == 200
    assert served.headers["content-type"].split(";")[0] == mime
    assert served.content == b"media-bytes"


def test_fil03_range_request_returns_part_of_the_file(alice: TestClient, board: str) -> None:
    """Перемотка: браузер запрашивает файл с произвольного места."""
    media = alice.post(
        f"/api/boards/{board}/media",
        content=b"0123456789",
        headers={"Content-Type": "video/mp4"},
    ).json()
    response = alice.get(media["url"], headers={"Range": "bytes=4-7"})
    assert response.status_code == 206
    assert response.content == b"4567"
    assert response.headers["content-range"] == "bytes 4-7/10"
    assert alice.get(media["url"]).headers["accept-ranges"] == "bytes"


def test_fil01_any_file_uploaded_as_opaque_data(alice: TestClient, board: str) -> None:
    """Ярлык принимает файл любого типа: HTML браузер как страницу не показывает."""
    response = alice.post(
        f"/api/boards/{board}/media",
        params={"name": "page.html", "kind": "file"},
        content=b"<script>alert(1)</script>",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert (body["name"], body["mime"]) == ("page.html", "application/octet-stream")
    served = alice.get(body["url"])
    assert served.headers["content-type"] == "application/octet-stream"
    assert served.headers["x-content-type-options"] == "nosniff"


def test_fil01_active_type_rejected_even_as_file(alice: TestClient, board: str) -> None:
    response = alice.post(
        f"/api/boards/{board}/media",
        params={"kind": "file"},
        content=b"<html></html>",
        headers={"Content-Type": "text/html"},
    )
    assert response.status_code == 415


def test_fil01_generic_type_needs_file_kind(alice: TestClient, board: str) -> None:
    """Без `kind=file` непрозрачные данные не загружаются: изображением они не станут."""
    response = alice.post(
        f"/api/boards/{board}/media",
        content=b"data",
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 415


def test_fil01_file_over_the_limit_rejected(alice: TestClient, board: str) -> None:
    response = alice.post(
        f"/api/boards/{board}/media",
        params={"kind": "file"},
        content=b"x" * 1025,
        headers={"Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 413


def test_fil01_download_under_the_name_on_the_board(alice: TestClient, board: str) -> None:
    media = _upload_file(alice, board)
    response = alice.get(media["url"], params={"download": "../Отчёт итог.bin"})
    assert response.status_code == 200
    assert response.content == b"data"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "%D0%9E%D1%82%D1%87%D1%91%D1%82%20%D0%B8%D1%82%D0%BE%D0%B3.bin" in disposition
    assert alice.get(media["url"]).headers["content-disposition"].startswith("inline;")


def test_fil01_download_needs_board_session(alice: TestClient, bob: TestClient, board: str) -> None:
    media = _upload_file(alice, board)
    assert bob.get(media["url"], params={"download": "x.bin"}).status_code == 404


def test_fil01_participant_uploads_and_downloads_file(
    alice: TestClient, admin: TestClient, board: str
) -> None:
    with _guest(admin, alice, board) as guest:
        media = _upload_file(guest, board)
        assert guest.get(media["url"], params={"download": "x.bin"}).status_code == 200
