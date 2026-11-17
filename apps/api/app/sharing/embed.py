"""EMB-04: cookie встроенной доски `SameSite=None; Secure; Partitioned` (ARCHITECTURE.md, раздел 5).

Такую cookie браузер отправляет и с запросами чужих сайтов, поэтому она действует только на
запросах со страницы этого сайта: так проверяются HTTP-маршруты и `/api/ws`. Страница
`/b/{token}/embed` обращается к API со своего адреса, даже когда лежит во фрейме.

Все маршруты, принимающие сессию участника, берут cookie из `trusted_cookies`.
"""

from urllib.parse import urlsplit

from starlette.requests import HTTPConnection

from app.identity.http import settings_of
from app.sharing.service import EMBED_COOKIE_PREFIX

_DEFAULT_PORTS = {"http": 80, "https": 443}


def _origin(url: str) -> tuple[str, str, int | None] | None:
    """Источник адреса: схема, хост, порт (порт по умолчанию подставлен); негодный — `None`."""
    try:
        parts = urlsplit(url.strip())
        port = parts.port or _DEFAULT_PORTS.get(parts.scheme.lower())
    except ValueError:
        return None
    if not parts.hostname:
        return None
    return parts.scheme.lower(), parts.hostname, port


def from_own_site(connection: HTTPConnection) -> bool:
    """Запрос пришёл со страницы этого сайта? Без признаков этого — нет.

    `Sec-Fetch-Site` и `Origin` браузер ставит сам, скрипт страницы их не подделает.
    Браузер без `Sec-Fetch-Site` проверяется по `Origin`.
    """
    site = connection.headers.get("sec-fetch-site")
    if site is not None:
        return site == "same-origin"
    origin = connection.headers.get("origin")
    if origin is None:
        return False
    # BUG-034: источник — схема, хост и порт; `http://` той же записи хоста — чужой сайт.
    own = _origin(settings_of(connection).public_base_url)
    return own is not None and _origin(origin) == own


def trusted_cookies(connection: HTTPConnection) -> dict[str, str]:
    """Cookie запроса; cookie встроенной доски — только при HTTPS и со страницы этого сайта."""
    cookies = dict(connection.cookies)
    if settings_of(connection).secure_cookies and from_own_site(connection):
        return cookies
    return {
        name: value for name, value in cookies.items() if not name.startswith(EMBED_COOKIE_PREFIX)
    }
