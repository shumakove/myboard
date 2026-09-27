"""Приёмка T0.3 · каркас интерфейса: собранная статика и маршруты (ARCHITECTURE.md, 4, 10).

Статика скачивается через Caddy по PUBLIC_BASE_URL, как её получает браузер.
Идентификаторы проверок — из отчёта docs/qa/reports/T0.3.md (ARCH-WEB-*, ARCH-WEBNET-*).
"""

from __future__ import annotations

import re
import secrets
import uuid
from urllib.parse import urljoin, urlsplit

import httpx
import pytest

TOKEN = secrets.token_urlsafe(32)
BOARD_ID = str(uuid.uuid4())

# Маршруты раздела 4 ARCHITECTURE.md.
ROUTES = [
    "/login",
    "/",
    f"/boards/{BOARD_ID}",
    "/templates",
    f"/t/{TOKEN}",
    "/admin/login",
    "/admin/users",
    f"/b/{TOKEN}",
    f"/b/{TOKEN}/embed",
    f"/b/{TOKEN}?object={uuid.uuid4()}",
]

# Адреса, которые клиент не должен вписывать (CLAUDE.md, ARCHITECTURE.md 10).
FORBIDDEN_ADDRESS = re.compile(
    r"(?:wss?|https?)://(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])"
    r"|//localhost\b|\blocalhost:\d|127\.0\.0\.1|\[::1\]",
    re.IGNORECASE,
)
ASSET_REF = re.compile(r"""["'(](/?assets/[^"'()\s?#]+)""")


def _collect_static(base_url: str) -> dict[str, str]:
    """index.html и все ресурсы, достижимые из него (включая динамические чанки)."""
    seen: dict[str, str] = {}
    queue = [base_url + "/"]
    with httpx.Client(timeout=15.0) as http:
        while queue:
            url = queue.pop()
            if url in seen:
                continue
            response = http.get(url)
            assert response.status_code == 200, f"{url} → {response.status_code}"
            seen[url] = response.text
            for ref in ASSET_REF.findall(response.text):
                path = ref if ref.startswith("/") else "/" + ref
                queue.append(urljoin(base_url + "/", path))
    return seen


@pytest.fixture(scope="module")
def static_files(clean_stack: str) -> dict[str, str]:
    files = _collect_static(clean_stack)
    assert any(url.endswith(".js") for url in files), "в index.html нет JS-сборки"
    return files


def _context(text: str, start: int, end: int) -> str:
    return text[max(0, start - 60) : end + 60].replace("\n", " ")


def test_arch_webdev06_stack_serves_vite_build(static_files: dict[str, str]) -> None:
    index = next(text for url, text in static_files.items() if not url.endswith(".js"))
    assert 'id="root"' in index
    assert re.search(r'<script type="module"[^>]+src="/assets/[^"]+\.js"', index)


def test_arch_webnet01_static_has_no_localhost_addresses(
    static_files: dict[str, str],
) -> None:
    hits = [
        f"{url}: …{_context(text, m.start(), m.end())}…"
        for url, text in static_files.items()
        for m in FORBIDDEN_ADDRESS.finditer(text)
    ]
    assert hits == []


def test_arch_webnet01_static_has_no_localhost_word(static_files: dict[str, str]) -> None:
    # Строже блока «Тестирование»: слово localhost не встречается в сборке вовсе.
    hits = [
        f"{url}: …{_context(text, m.start(), m.end())}…"
        for url, text in static_files.items()
        for m in re.finditer("localhost", text, re.IGNORECASE)
    ]
    assert hits == []


def test_arch_webnet04_build_does_not_embed_public_address(
    static_files: dict[str, str], clean_stack: str
) -> None:
    # Адрес строится из адреса страницы, а не вписывается при сборке.
    host = urlsplit(clean_stack).netloc
    hits = [url for url, text in static_files.items() if host in text]
    assert hits == []


@pytest.mark.parametrize("path", ROUTES)
def test_arch_web01_route_serves_spa_document(clean_stack: str, path: str) -> None:
    response = httpx.get(clean_stack + path, timeout=10.0)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert 'id="root"' in response.text


@pytest.mark.parametrize("path", ["/api/openapi.json", "/api/health"])
def test_arch_web07_api_paths_not_caught_by_spa(clean_stack: str, path: str) -> None:
    response = httpx.get(clean_stack + path, timeout=10.0)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert 'id="root"' not in response.text
