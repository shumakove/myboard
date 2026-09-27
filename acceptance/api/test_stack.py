"""Приёмка T0.1 · стек Docker Compose (ARCHITECTURE.md, разделы 4, 10, 11, 12).

Проверки только через HTTP и WebSocket по PUBLIC_BASE_URL. Идентификаторы
проверок — из отчёта docs/qa/reports/T0.1.md (ARCH-NET-*, ARCH-PROXY-*, ARCH-FRAME-*).
"""

from __future__ import annotations

import re
import secrets

import httpx
import pytest
from websockets.exceptions import InvalidStatus
from websockets.sync.client import connect

from stand import Client, ws_url

# Токен ссылки: 32 случайных байта в URL-безопасной кодировке (ARCHITECTURE.md, 5).
TOKEN = secrets.token_urlsafe(32)

# Страницы, которые запрещают показ во фрейме (все маршруты раздела 4, кроме embed).
FRAME_DENIED_PAGES = [
    "/",
    "/login",
    "/boards/1",
    "/templates",
    f"/t/{TOKEN}",
    "/admin/login",
    "/admin/users",
    f"/b/{TOKEN}",
    f"/b/{TOKEN}?object=abc",
]

# Похожие на embed, но не embed.
EMBED_LOOKALIKES = [
    f"/b/{TOKEN}/embed/x",
    "/b/embed",
    "/b//embed",
    "/boards/1/embed",
    f"/b/{TOKEN}/embedded",
    f"/x/b/{TOKEN}/embed",
    f"/B/{TOKEN}/embed",
    f"/api/b/{TOKEN}/embed",
]

EMBED_PAGES = [f"/b/{TOKEN}/embed", f"/b/{TOKEN}/embed?x=1"]


def _frame_denied(response: httpx.Response) -> bool:
    """Ответ запрещает показ в чужом фрейме (X-Frame-Options или CSP frame-ancestors)."""
    xfo = response.headers.get("x-frame-options", "").strip().upper()
    if xfo in {"DENY", "SAMEORIGIN"}:
        return True
    for csp in response.headers.get_list("content-security-policy"):
        match = re.search(r"frame-ancestors([^;]*)", csp, re.IGNORECASE)
        if match and match.group(1).split() and set(match.group(1).split()) <= {"'none'", "'self'"}:
            return True
    return False


def _frame_restricted_at_all(response: httpx.Response) -> bool:
    """Есть хоть какое-то ограничение фрейма: X-Frame-Options или frame-ancestors."""
    if "x-frame-options" in response.headers:
        return True
    return any("frame-ancestors" in csp.lower() for csp in response.headers.get_list("content-security-policy"))


def _is_spa_html(response: httpx.Response) -> bool:
    return "text/html" in response.headers.get("content-type", "") and "<html" in response.text.lower()


# --- ARCH-NET: стек отвечает по адресу машины в LAN ---------------------------


def test_arch_net01_root_serves_interface_by_lan_address(client: Client) -> None:
    response = client.http.get("/")
    assert response.status_code == 200
    assert _is_spa_html(response), response.headers.get("content-type")


@pytest.mark.parametrize("path", ["/login", "/boards/1", f"/b/{TOKEN}", f"/b/{TOKEN}/embed", "/admin/users"])
def test_arch_net04_spa_routes_fall_back_to_interface(client: Client, path: str) -> None:
    response = client.http.get(path)
    assert response.status_code == 200, path
    assert _is_spa_html(response), path


def _static_texts(client: Client) -> dict[str, str]:
    """HTML главной и все скрипты того же происхождения, на которые она ссылается."""
    index = client.http.get("/")
    texts = {"/": index.text}
    for src in re.findall(r"""<script[^>]+src=["']([^"']+)["']""", index.text):
        if src.startswith("/") and not src.startswith("//"):
            texts[src] = client.http.get(src).text
    return texts


def test_arch_net05_static_has_no_localhost_addresses(client: Client) -> None:
    for name, text in _static_texts(client).items():
        # Адрес, а не слово: //localhost, localhost:порт, 127.0.0.1, 0.0.0.0.
        found = re.findall(r"//localhost|localhost:\d|127\.0\.0\.1|0\.0\.0\.0|\[::1\]", text)
        assert not found, f"{name}: {found}"


# --- ARCH-PROXY: /api и /api/ws доходят до API ---------------------------------


def test_arch_proxy01_api_path_reaches_api_not_static(client: Client) -> None:
    response = client.http.get("/api/health")
    assert not _is_spa_html(response)
    assert response.status_code < 500


def test_arch_proxy02_unknown_api_path_is_api_response(client: Client) -> None:
    response = client.http.get(f"/api/qa-missing-{secrets.token_hex(4)}")
    assert response.status_code == 404
    assert not _is_spa_html(response)
    assert "application/json" in response.headers.get("content-type", "")


def _ws_handshake_status(url: str, origin: str) -> int:
    try:
        with connect(url, additional_headers={"Origin": origin}, open_timeout=10):
            return 101
    except InvalidStatus as exc:
        return exc.response.status_code


def test_arch_proxy03_websocket_reaches_api(clean_stack: str) -> None:
    """Рукопожатие /api/ws обрабатывает API: 101 или отказ API (не статика и не 5xx прокси)."""
    status = _ws_handshake_status(ws_url(clean_stack), clean_stack)
    assert status == 101 or status in {401, 403}, status


def test_arch_proxy04_websocket_outside_api_is_not_upgraded(clean_stack: str) -> None:
    """Граничный: апгрейд вне /api не уходит в API (статика не открывает сокет)."""
    status = _ws_handshake_status(ws_url(clean_stack, "/ws"), clean_stack)
    assert status != 101


# --- ARCH-FRAME: запрет фрейма везде, кроме /b/{token}/embed --------------------


@pytest.mark.parametrize("path", FRAME_DENIED_PAGES)
def test_arch_frame01_02_03_pages_deny_framing(client: Client, path: str) -> None:
    response = client.http.get(path)
    assert _frame_denied(response), f"{path}: {dict(response.headers)}"


@pytest.mark.parametrize("path", EMBED_PAGES)
def test_arch_frame04_embed_allows_framing(client: Client, path: str) -> None:
    response = client.http.get(path)
    assert response.status_code == 200
    assert not _frame_restricted_at_all(response), f"{path}: {dict(response.headers)}"


@pytest.mark.parametrize("path", EMBED_LOOKALIKES)
def test_arch_frame05_embed_lookalikes_deny_framing(client: Client, path: str) -> None:
    response = client.http.get(path)
    assert _frame_denied(response), f"{path}: {dict(response.headers)}"


@pytest.mark.parametrize("path", ["/api/health", "/api/qa-missing"])
def test_arch_frame06_api_responses_deny_framing(client: Client, path: str) -> None:
    response = client.http.get(path)
    assert _frame_denied(response), f"{path}: {dict(response.headers)}"


def test_arch_frame06_static_assets_deny_framing(client: Client) -> None:
    for name in _static_texts(client):
        if name == "/":
            continue
        assert _frame_denied(client.http.get(name)), name


@pytest.mark.parametrize("path", ["/?x=1", "/login/", "/admin/login?next=/admin/users"])
def test_arch_frame08_query_and_trailing_slash_deny_framing(client: Client, path: str) -> None:
    assert _frame_denied(client.http.get(path)), path


@pytest.mark.parametrize("path", ["/", "/login", f"/b/{TOKEN}"])
def test_arch_frame08_head_denies_framing(client: Client, path: str) -> None:
    assert _frame_denied(client.http.head(path)), path
