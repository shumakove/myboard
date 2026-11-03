"""Модуль sharing: ссылка на доску и вход по ней (SHR-01, SHR-02, SHR-03, SHR-05, SHR-06)."""

import re
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

import app.main  # noqa: F401  # регистрирует модели всех модулей в Base.metadata
from app.core.db import Base
from app.core.settings import Settings
from app.main import create_app

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
    assert response.json() == {"id": board["id"], "title": "Roadmap", "participant": None}


def test_shr02_join_sets_board_session_cookie(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    token = _link(alice, board["id"])["token"]

    response = _join(guest, token, "  Kate  ")

    assert response.status_code == 200
    assert response.json() == {
        "id": board["id"],
        "title": "Roadmap",
        "participant": {"id": response.json()["participant"]["id"], "name": "Kate"},
    }
    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{_board_cookie(board['id'])}=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie
    # Сессионная cookie: живёт до закрытия браузера.
    assert "Max-Age" not in cookie
    assert "expires" not in cookie.lower()
    assert guest.get(f"/api/share/{token}").json()["participant"]["name"] == "Kate"


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

    assert guest.get(f"/api/share/{token}").json()["participant"]["name"] == "Katherine"
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
    assert guest.get(f"/api/share/{new}").json()["participant"]["name"] == "Kate"


def test_shr06_reset_keeps_owner_session_and_other_boards(
    alice: TestClient, guest: TestClient, board: dict[str, Any]
) -> None:
    other = alice.post("/api/boards", json={"title": "Other"}).json()
    other_token = _link(alice, other["id"])["token"]
    _join(guest, other_token, "Kate")

    _reset(alice, board["id"])

    assert alice.get("/api/boards").status_code == 200
    assert guest.get(f"/api/share/{other_token}").json()["participant"]["name"] == "Kate"


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


def test_bug026_namesakes_get_different_stable_ids(
    admin: TestClient, alice: TestClient, board: dict[str, Any]
) -> None:
    """CMT-02, CMT-04: участники с одним именем различимы; id не раскрывает cookie."""
    token = _link(alice, board["id"])["token"]
    with _browser(admin) as first, _browser(admin) as second:
        joined = _join(first, token, "Sam").json()["participant"]
        other = _join(second, token, "Sam").json()["participant"]

        assert joined["name"] == other["name"] == "Sam"
        assert joined["id"] != other["id"]
        assert first.get(f"/api/share/{token}").json()["participant"]["id"] == joined["id"]
        assert joined["id"] not in first.cookies.values()


# EMB-04: cookie встроенной доски при HTTPS (Q-008, ARCHITECTURE.md, раздел 5).

SAME_SITE: dict[str, str] = {"sec-fetch-site": "same-origin"}
HTTPS_BASE = "https://board.example.com"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64


@dataclass
class HttpsSite:
    """Приложение с HTTPS-адресом, доска Alice и её ссылка; у клиента нет cookie участника."""

    client: TestClient
    alice: dict[str, str]
    board_id: str
    token: str

    def get_shared(self, cookie: str, headers: dict[str, str]) -> Any:
        return self.client.get(f"/api/share/{self.token}", headers={"cookie": cookie, **headers})


@pytest.fixture
def site(settings: Settings) -> Iterator[HttpsSite]:
    https = settings.model_copy(update={"public_base_url": HTTPS_BASE})
    with TestClient(create_app(https), base_url="https://testserver") as client:
        assert (
            client.post(
                "/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
            ).status_code
            == 204
        )
        assert client.post("/api/admin/users", json=ALICE).status_code == 201
        login = {"email": ALICE["email"], "password": ALICE["password"]}
        assert client.post("/api/login", json=login).status_code == 204
        board = client.post("/api/boards", json={"title": "Roadmap"}).json()
        token = client.get(f"/api/boards/{board['id']}/share").json()["token"]
        alice = {"cookie": "; ".join(f"{k}={v}" for k, v in client.cookies.items())}
        client.cookies.clear()
        yield HttpsSite(client, alice, board["id"], token)


def _embed_join(site: HttpsSite) -> tuple[str, str]:
    """Вход со встроенной страницы: заголовок Set-Cookie и пара `имя=значение` для запросов."""
    response = site.client.post(
        f"/api/share/{site.token}/join",
        json={"name": "Kate", "embed": True},
        headers=SAME_SITE,
    )
    assert response.status_code == 200, response.text
    site.client.cookies.clear()
    header = response.headers["set-cookie"]
    return header, header.split(";")[0]


def test_emb04_embed_join_on_https_sets_partitioned_cookie(site: HttpsSite) -> None:
    header, pair = _embed_join(site)
    assert pair.startswith("myboard_embed_")
    attributes = {part.strip().lower() for part in header.split(";")[1:]}
    assert attributes == {"httponly", "path=/", "samesite=none", "secure", "partitioned"}


def test_emb04_common_join_on_https_stays_lax(site: HttpsSite) -> None:
    response = site.client.post(f"/api/share/{site.token}/join", json={"name": "Kate"})
    site.client.cookies.clear()
    header = response.headers["set-cookie"].lower()
    assert header.startswith("myboard_board_")
    assert "samesite=lax" in header
    assert "samesite=none" not in header
    assert "partitioned" not in header


def test_emb04_embed_flag_on_http_gives_common_lax_cookie(
    alice: TestClient, board: dict[str, Any], guest: TestClient
) -> None:
    """На `http://` браузер не примет `SameSite=None`: поведение прежнее."""
    token = _link(alice, board["id"])["token"]
    response = guest.post(
        f"/api/share/{token}/join", json={"name": "Kate", "embed": True}, headers=SAME_SITE
    )
    assert response.status_code == 200
    header = response.headers["set-cookie"].lower()
    assert header.startswith("myboard_board_")
    assert "samesite=lax" in header
    assert "secure" not in header
    assert "partitioned" not in header


def test_emb04_embed_cookie_on_http_is_ignored(
    alice: TestClient, board: dict[str, Any], guest: TestClient
) -> None:
    token = _link(alice, board["id"])["token"]
    joined = guest.post(f"/api/share/{token}/join", json={"name": "Kate"})
    value = joined.cookies[f"myboard_board_{board['id'].replace('-', '')}"]
    guest.cookies.clear()
    forged = f"myboard_embed_{board['id'].replace('-', '')}={value}"
    response = guest.get(f"/api/share/{token}", headers={"cookie": forged, **SAME_SITE})
    assert response.json()["participant"] is None


@pytest.mark.parametrize(
    ("headers", "accepted"),
    [
        (SAME_SITE, True),
        ({"sec-fetch-site": "cross-site"}, False),
        ({"sec-fetch-site": "same-site"}, False),
        ({"sec-fetch-site": "none"}, False),
        # Заголовок браузера важнее: чужой сайт не подставит свой Origin вместо него.
        ({"sec-fetch-site": "cross-site", "origin": HTTPS_BASE}, False),
        ({"origin": HTTPS_BASE}, True),
        ({"origin": "https://evil.example"}, False),
        ({}, False),
    ],
)
def test_emb04_embed_cookie_counts_only_from_own_site(
    site: HttpsSite, headers: dict[str, str], accepted: bool
) -> None:
    _, pair = _embed_join(site)
    participant = site.get_shared(pair, headers).json()["participant"]
    assert (participant is not None) is accepted


def test_emb04_forged_cross_site_join_is_refused(site: HttpsSite) -> None:
    response = site.client.post(
        f"/api/share/{site.token}/join",
        json={"name": "Mallory", "embed": True},
        headers={"sec-fetch-site": "cross-site"},
    )
    assert response.status_code == 404
    assert "set-cookie" not in response.headers


def test_emb04_forged_cross_site_upload_is_refused(site: HttpsSite) -> None:
    _, pair = _embed_join(site)
    url = f"/api/boards/{site.board_id}/media"
    headers = {"content-type": "image/png", "cookie": pair}

    forged = site.client.post(
        url,
        params={"name": "a.png"},
        content=PNG,
        headers={**headers, "origin": "https://evil.example"},
    )
    assert forged.status_code == 404

    own = site.client.post(
        url, params={"name": "a.png"}, content=PNG, headers={**headers, **SAME_SITE}
    )
    assert own.status_code == 201, own.text

    media = own.json()["url"]
    assert site.client.get(media, headers={"cookie": pair, **SAME_SITE}).status_code == 200
    cross = {"cookie": pair, "sec-fetch-site": "cross-site"}
    assert site.client.get(media, headers=cross).status_code == 404


def test_emb04_embed_cookie_opens_channel_only_from_own_site(site: HttpsSite) -> None:
    _, pair = _embed_join(site)
    url = f"/api/ws?token={site.token}"
    host = {"host": "board.example.com", "origin": HTTPS_BASE, "cookie": pair}

    with site.client.websocket_connect(url, headers={**host, **SAME_SITE}):
        pass
    for refused in ({**host, "sec-fetch-site": "cross-site"}, {"cookie": pair}):
        with (
            pytest.raises(WebSocketDisconnect),
            site.client.websocket_connect(url, headers=refused),
        ):
            pass


def test_emb04_embed_cookie_is_bound_to_its_board_and_gives_no_account(site: HttpsSite) -> None:
    other = site.client.post("/api/boards", json={"title": "Other"}, headers=site.alice).json()
    other_token = site.client.get(f"/api/boards/{other['id']}/share", headers=site.alice).json()[
        "token"
    ]
    site.client.cookies.clear()

    _, pair = _embed_join(site)
    value = pair.split("=", 1)[1]
    other_cookie = f"myboard_embed_{other['id'].replace('-', '')}={value}"
    headers = {"cookie": other_cookie, **SAME_SITE}
    assert (
        site.client.get(f"/api/share/{other_token}", headers=headers).json()["participant"] is None
    )
    assert site.client.get("/api/boards", headers={"cookie": pair, **SAME_SITE}).status_code == 401


def test_emb04_reset_revokes_embed_session(site: HttpsSite) -> None:
    """SHR-06: сессия встроенной доски отзывается вместе со ссылкой."""
    _, pair = _embed_join(site)
    assert site.get_shared(pair, SAME_SITE).json()["participant"] is not None

    reset = site.client.post(f"/api/boards/{site.board_id}/share/reset", headers=site.alice)
    site.client.cookies.clear()
    token = reset.json()["token"]

    assert site.get_shared(pair, SAME_SITE).status_code == 404
    response = site.client.get(f"/api/share/{token}", headers={"cookie": pair, **SAME_SITE})
    assert response.json()["participant"] is None


def test_emb04_owner_session_stays_lax_on_https(settings: Settings) -> None:
    https = settings.model_copy(update={"public_base_url": HTTPS_BASE})
    with TestClient(create_app(https), base_url="https://testserver") as client:
        client.post("/api/admin/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        client.post("/api/admin/users", json=ALICE)
        response = client.post(
            "/api/login", json={"email": ALICE["email"], "password": ALICE["password"]}
        )
    header = response.headers["set-cookie"].lower()
    assert "samesite=lax" in header
    assert "partitioned" not in header
