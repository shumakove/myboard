"""EMB-02: название и изображение страницы для карточки ссылки.

Браузер не прочитает чужую страницу (CORS), поэтому её читает сервер. Адрес задаёт любой
участник доски, поэтому запрос не должен дотянуться до внутренней сети (SSRF): имя хоста
разрешается один раз, проверяются все адреса, соединение идёт на проверенный адрес
(подмена DNS между проверкой и запросом не сработает), каждый переход по редиректу
проверяется заново. Исключения — только хосты из `LINK_PREVIEW_ALLOWED_HOSTS`.
"""

import contextlib
import ipaddress
import socket
from collections.abc import Collection
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import anyio
import httpx2

PAGE_MAX_BYTES = 1024 * 1024
IMAGE_MAX_BYTES = 5 * 1024 * 1024
TITLE_MAX_LENGTH = 300
REQUEST_TIMEOUT_SECONDS = 10
_CONNECT_TIMEOUT_SECONDS = 5
MAX_REDIRECTS = 3
_REDIRECTS = {301, 302, 303, 307, 308}
_USER_AGENT = "myboard-link-preview"
# SVG не берётся: у карточки нужна обычная картинка страницы.
IMAGE_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp"})

_TITLE_TAGS = ("og:title", "twitter:title")
_IMAGE_TAGS = ("og:image", "og:image:url", "og:image:secure_url", "twitter:image")


class _UnavailableError(Exception):
    """Страницу нельзя прочитать; причина наружу не сообщается."""


@dataclass(frozen=True)
class FetchedImage:
    mime: str
    body: bytes


@dataclass(frozen=True)
class LinkPreview:
    title: str | None
    image: FetchedImage | None


@dataclass(frozen=True)
class _Fetched:
    url: str
    mime: str
    encoding: str
    body: bytes
    cut: bool


class _PageMeta(HTMLParser):
    """Метки Open Graph и Twitter и `<title>` из начала страницы."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.tags: dict[str, str] = {}
        self.title = ""
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            key = (values.get("property") or values.get("name") or "").strip().lower()
            content = values.get("content", "").strip()
            if key and content:
                self.tags.setdefault(key, content)

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data


def parse_page(html: str, base_url: str) -> tuple[str | None, str | None]:
    """Название и абсолютный http(s)-адрес изображения страницы; чего нет — `None`."""
    page = _PageMeta()
    page.feed(html)
    raw_title = next((page.tags[key] for key in _TITLE_TAGS if key in page.tags), page.title)
    title = " ".join(raw_title.split())[:TITLE_MAX_LENGTH] or None
    image = next((page.tags[key] for key in _IMAGE_TAGS if key in page.tags), None)
    if image is None:
        return title, None
    absolute = urljoin(base_url, image)
    return title, absolute if urlsplit(absolute).scheme in ("http", "https") else None


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


async def _checked_addresses(host: str, port: int, allowed: Collection[str]) -> list[str]:
    """Адреса для соединения, IPv4 первыми; хост внутренней сети не из списка — отказ."""
    try:
        found = await anyio.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as error:
        raise _UnavailableError from error
    addresses = list(dict.fromkeys(str(info[4][0]) for info in found))
    if not addresses:
        raise _UnavailableError
    # Хотя бы один внутренний адрес — отказ: имя не должно вести во внутреннюю сеть.
    if host.lower() not in allowed and not all(_is_public(address) for address in addresses):
        raise _UnavailableError
    # В контейнере часто нет IPv6, хотя у сайта есть такой адрес.
    return sorted(addresses, key=lambda address: ":" in address)


async def _read_limited(response: httpx2.Response, limit: int) -> tuple[bytes, bool]:
    """Тело не длиннее `limit`; второе значение — тело обрезано."""
    body = bytearray()
    async for chunk in response.aiter_bytes():
        body += chunk
        if len(body) > limit:
            return bytes(body[:limit]), True
    return bytes(body), False


def _pinned_request(client: httpx2.AsyncClient, url: str, address: str) -> httpx2.Request:
    """Запрос на проверенный адрес с исходным именем в `Host` и в TLS (SNI, сертификат)."""
    parts = urlsplit(url)
    return client.build_request(
        "GET",
        httpx2.URL(url).copy_with(host=address),
        headers={"Host": parts.netloc.rsplit("@", 1)[-1], "User-Agent": _USER_AGENT},
        extensions={"sni_hostname": parts.hostname or ""},
    )


async def _connect(client: httpx2.AsyncClient, url: str, addresses: list[str]) -> httpx2.Response:
    """Первый адрес, с которым удалось соединиться."""
    for address in addresses[:-1]:
        with contextlib.suppress(httpx2.ConnectError, httpx2.ConnectTimeout):
            return await client.send(_pinned_request(client, url, address), stream=True)
    return await client.send(_pinned_request(client, url, addresses[-1]), stream=True)


async def _fetch(
    client: httpx2.AsyncClient, url: str, allowed: Collection[str], limit: int
) -> _Fetched:
    """Ответ 200 после редиректов; каждый адрес цепочки проверяется заново."""
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(url)
        if parts.scheme not in ("http", "https") or not parts.hostname:
            raise _UnavailableError
        port = parts.port or (443 if parts.scheme == "https" else 80)
        addresses = await _checked_addresses(parts.hostname, port, allowed)
        response = await _connect(client, url, addresses)
        try:
            if response.status_code in _REDIRECTS and "location" in response.headers:
                url = urljoin(url, response.headers["location"])
                continue
            if response.status_code != 200:
                raise _UnavailableError
            body, cut = await _read_limited(response, limit)
            mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            return _Fetched(url, mime, response.encoding or "utf-8", body, cut)
        finally:
            await response.aclose()
    raise _UnavailableError


async def _fetch_within_time(
    client: httpx2.AsyncClient, url: str, allowed: Collection[str], limit: int
) -> _Fetched | None:
    try:
        with anyio.fail_after(REQUEST_TIMEOUT_SECONDS):
            return await _fetch(client, url, allowed, limit)
    except (_UnavailableError, httpx2.HTTPError, TimeoutError, ValueError):
        return None


async def read_preview(url: str, allowed: Collection[str], image_limit: int) -> LinkPreview:
    """Название и изображение страницы. Страница недоступна или закрыта — всё `None`."""
    timeout = httpx2.Timeout(REQUEST_TIMEOUT_SECONDS, connect=_CONNECT_TIMEOUT_SECONDS)
    # Только свой адрес и ничего из окружения: прокси и cookie запросу не нужны.
    async with httpx2.AsyncClient(timeout=timeout, trust_env=False) as client:
        page = await _fetch_within_time(client, url, allowed, PAGE_MAX_BYTES)
        if page is None or page.mime not in ("text/html", "application/xhtml+xml"):
            return LinkPreview(None, None)
        title, image_url = parse_page(page.body.decode(page.encoding, errors="replace"), page.url)
        if image_url is None:
            return LinkPreview(title, None)
        limit = min(image_limit, IMAGE_MAX_BYTES)
        image = await _fetch_within_time(client, image_url, allowed, limit)
    usable = image is not None and image.mime in IMAGE_TYPES and image.body and not image.cut
    return LinkPreview(title, FetchedImage(image.mime, image.body) if image and usable else None)
