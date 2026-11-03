"""Приёмка T7.3 · EMB-02 (чтение страницы сервером, SSRF), EMB-04 (Q-008: cookie, подделка запросов).

Сценарии — docs/qa/reports/T7.3.md. Запуск:
- обычный стек: PUBLIC_BASE_URL=http://<IP> и контейнер `myboard-qa-linksite` (link_site.py) в сети
  стека под именами `linksite` (в LINK_PREVIEW_ALLOWED_HOSTS) и `decoy` (не в списке), порт 18099;
- стенд с TLS: HTTPS_BASE_URL=https://<IP>:8443 (acceptance/tls/Caddyfile, стек с тем же адресом
  в PUBLIC_BASE_URL). Без переменной эти тесты пропускаются.
Без них стенд не собран: тесты пропускаются, а не падают.
"""

from __future__ import annotations

import os
import re
import ssl
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, urlsplit

import httpx
import pytest
from websockets.exceptions import ConnectionClosed, InvalidStatus
from websockets.sync.client import connect

from admin_helpers import admin_credentials, create_user
from board_helpers import create_board, unique_title
from media_helpers import png
from share_helpers import join, link, reset
from stand import Client, clients
from user_helpers import user_login

SITE_PORT = 18099
SITE = "http://linksite:8099"
DECOY = "http://decoy:8099"
HTTPS_BASE_URL = os.environ.get("HTTPS_BASE_URL", "").rstrip("/")
EMPTY = {"title": None, "image": None}


def _site_public(base_url: str) -> str:
    return f"http://{urlsplit(base_url).hostname}:{SITE_PORT}"


@pytest.fixture(scope="module")
def site_log(clean_stack: str):
    """Журнал сайта-образца; нет сайта — пропуск всего раздела EMB-02."""
    public = _site_public(clean_stack)
    try:
        httpx.get(f"{public}/log", timeout=3.0)
    except httpx.HTTPError:
        pytest.skip("Нет контейнера link_site.py (myboard-qa-linksite)")

    def read(marker: str) -> list[dict[str, Any]]:
        """Записи журнала с меткой, кроме пришедших на разрешённое имя с меткой только в параметре `to`."""
        entries = httpx.get(f"{public}/log", timeout=10.0).json()
        return [e for e in entries if marker in str(e.get("path")) and not str(e.get("path")).startswith(("/redir", "/img-at", "/refresh"))]

    return read


def preview(client: Client, board_id: str, url: str, timeout: float = 40.0) -> httpx.Response:
    return client.http.post(f"/api/boards/{board_id}/link-preview", json={"url": url}, timeout=timeout)


def marker() -> str:
    return "m" + uuid.uuid4().hex[:12]


def fields(resp: httpx.Response) -> dict[str, Any]:
    """Что сервер прочитал со страницы: поле `url` — эхо запроса."""
    assert resp.status_code == 200, (resp.status_code, resp.text)
    body = resp.json()
    return {"title": body["title"], "image": body["image"]}


# --- EMB-02: страница и изображение ---------------------------------------------------------


def test_emb02_page_title_and_image_become_board_file(board_user: Client, board: dict[str, str], site_log) -> None:
    m = marker()
    body = preview(board_user, board["id"], f"{SITE}/page?{m}").json()
    assert body["title"] == "QA page title"
    assert body["image"]["mime"] == "image/png"
    fetched = board_user.http.get(body["image"]["url"])
    assert fetched.status_code == 200
    assert fetched.headers["content-type"].startswith("image/png")
    seen = site_log(m)
    assert seen and seen[0]["agent"] and "cookie" in seen[0] and seen[0]["cookie"] is None
    assert seen[0]["referer"] is None


def test_emb02_participant_by_link_reads_page_too(link_participant: Client, site_log) -> None:
    body = preview(link_participant, link_participant.board["id"], f"{SITE}/page").json()  # type: ignore[attr-defined]
    assert body["title"] == "QA page title" and body["image"]


def test_emb02_open_graph_wins_and_relative_image_resolved(board_user: Client, board: dict[str, str], site_log) -> None:
    body = preview(board_user, board["id"], f"{SITE}/og").json()
    assert body["title"] == "OG title" and body["image"]


@pytest.mark.parametrize(
    ("path", "title"),
    [
        ("/notitle", None),
        ("/status?n=404", None),
        ("/status?n=500", None),
        ("/text", None),
        ("/json", None),
        ("/cp1251", "Страница"),
        ("/badcharset", "charset"),
    ],
)
def test_emb02_pages_without_data_leave_card_empty_not_error(board_user: Client, board: dict[str, str], site_log, path: str, title: str | None) -> None:
    assert fields(preview(board_user, board["id"], SITE + path)) == {"title": title, "image": None}


def test_emb02_long_title_is_cut(board_user: Client, board: dict[str, str], site_log) -> None:
    title = fields(preview(board_user, board["id"], f"{SITE}/longtitle"))["title"]
    assert title is not None and len(title) <= 300


def test_emb02_markup_in_title_is_returned_as_text_and_bad_image_ignored(board_user: Client, board: dict[str, str], site_log) -> None:
    got = fields(preview(board_user, board["id"], f"{SITE}/xss"))
    assert got["image"] is None
    assert "<script>" in got["title"]


@pytest.mark.parametrize(
    "url",
    ["file:///etc/passwd", "ftp://example.com/", "gopher://127.0.0.1/", "javascript:alert(1)", "data:text/html,x", "not a url", ""],
)
def test_emb02_sec_non_http_schemes_refused_before_any_request(board_user: Client, board: dict[str, str], url: str) -> None:
    assert preview(board_user, board["id"], url).status_code == 422


def test_emb02_url_too_long_refused(board_user: Client, board: dict[str, str]) -> None:
    assert preview(board_user, board["id"], "http://decoy/" + "a" * 3000).status_code == 422


def test_emb02_arch_route_in_openapi(client: Client) -> None:
    spec = client.http.get("/api/openapi.json").json()
    assert "/api/boards/{board_id}/link-preview" in spec["paths"]


# --- EMB-02: доступ к маршруту ----------------------------------------------------------------


def test_emb02_sec_no_access_is_one_refusal_and_no_request(
    client: Client, board_user: Client, board: dict[str, str], admin: Client, clean_stack: str, site_log
) -> None:
    m = marker()
    url = f"{SITE}/page?{m}"
    other_user = create_user(admin)
    other_board_owner = create_user(admin)
    with clients(clean_stack, "other", "guest", "revoked", "owner2") as (other, guest, revoked, owner2):
        assert user_login(other, other_user["email"], other_user["_password"]).status_code == 204
        assert user_login(owner2, other_board_owner["email"], other_board_owner["_password"]).status_code == 204
        board2 = create_board(owner2, unique_title())
        assert join(guest, link(owner2, board2["id"])["token"], "G").status_code == 200
        assert join(revoked, link(board_user, board["id"])["token"], "R").status_code == 200
        assert reset(board_user, board["id"]).status_code == 200
        refusals = {
            "аноним": preview(client, board["id"], url),
            "другой пользователь": preview(other, board["id"], url),
            "участник другой доски": preview(guest, board["id"], url),
            "отозванная cookie": preview(revoked, board["id"], url),
            "администратор": preview(admin, board["id"], url),
            "нет такой доски": preview(other, str(uuid.uuid4()), url),
        }
    answers = {(r.status_code, r.text) for r in refusals.values()}
    assert len(answers) == 1, {k: (r.status_code, r.text) for k, r in refusals.items()}
    assert next(iter(answers))[0] == 404
    assert site_log(m) == []


# --- EMB-02: SSRF ------------------------------------------------------------------------------

INTERNAL_URLS = [
    "http://127.0.0.1:8000/docs",
    "http://localhost:8000/docs",
    "http://LOCALHOST:8000/docs",
    "http://localhost.:8000/docs",
    "http://[::1]:8000/docs",
    "http://[::ffff:127.0.0.1]:8000/docs",
    "http://[::]:8000/docs",
    "http://[::127.0.0.1]:8000/docs",
    "http://[64:ff9b::7f00:1]:8000/docs",
    "http://[2002:7f00:1::]:8000/docs",
    "http://0.0.0.0:8000/docs",
    "http://0:8000/docs",
    "http://127.1:8000/docs",
    "http://2130706433:8000/docs",
    "http://0x7f000001:8000/docs",
    "http://0177.0.0.1:8000/docs",
    "http://①②⑦.⓪.⓪.①:8000/docs",
    "http://api:8000/docs",
    "http://api.:8000/docs",
    "http://API:8000/docs",
    "http://caddy/login",
    "http://web/",
    "http://postgres:5432/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://172.17.0.1/",
    "http://192.168.0.1/",
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://[fc00::1]/",
    "http://[fe80::1]/",
    "http://linksite:8099@127.0.0.1:8000/docs",
    "http://user:pass@api:8000/docs",
]


@pytest.mark.parametrize("url", INTERNAL_URLS)
def test_emb02_ssrf_internal_address_gives_nothing(board_user: Client, board: dict[str, str], url: str) -> None:
    resp = preview(board_user, board["id"], url)
    assert resp.status_code in (200, 422), (resp.status_code, resp.text)
    if resp.status_code == 200:
        assert fields(resp) == EMPTY, resp.text
    assert "FastAPI" not in resp.text


def _decoy_urls(m: str, public: str) -> list[str]:
    host_ip = urlsplit(public).hostname
    return [
        f"{DECOY}/page?{m}",
        f"http://DECOY:8099/page?{m}",
        f"http://decoy.:8099/page?{m}",
        f"http://x@decoy:8099/page?{m}",
        f"http://decoy:8099#@linksite:8099/page?{m}",
        f"http://{host_ip}:{SITE_PORT}/page?{m}",
        f"http://host.docker.internal:{SITE_PORT}/page?{m}",
    ]


def test_emb02_ssrf_decoy_never_receives_request(board_user: Client, board: dict[str, str], clean_stack: str, site_log) -> None:
    m = marker()
    for url in _decoy_urls(m, _site_public(clean_stack)):
        resp = preview(board_user, board["id"], url)
        assert resp.status_code in (200, 422), url
        if resp.status_code == 200:
            assert fields(resp) == EMPTY, url
    time.sleep(0.5)
    assert site_log(m) == []


REDIRECT_TARGETS = [
    "http://127.0.0.1:8000/docs",
    "http://[::1]:8000/docs",
    "http://[::ffff:127.0.0.1]:8000/docs",
    "http://2130706433:8000/docs",
    "http://api:8000/docs",
    "http://caddy/login",
    "http://169.254.169.254/latest/meta-data/",
    "file:///etc/passwd",
    "gopher://127.0.0.1:8000/",
    "ftp://127.0.0.1/",
    "//api:8000/docs",
]


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
@pytest.mark.parametrize("target", REDIRECT_TARGETS)
def test_emb02_ssrf_redirect_to_internal_gives_nothing(board_user: Client, board: dict[str, str], site_log, code: int, target: str) -> None:
    resp = preview(board_user, board["id"], f"{SITE}/redir?code={code}&to={quote(target, safe='')}")
    assert fields(resp) == EMPTY, (target, resp.text)


@pytest.mark.parametrize("code", [301, 302, 303, 307, 308])
def test_emb02_ssrf_redirect_to_decoy_never_arrives(board_user: Client, board: dict[str, str], site_log, code: int) -> None:
    m = marker()
    target = quote(f"{DECOY}/page?{m}", safe="")
    assert fields(preview(board_user, board["id"], f"{SITE}/redir?code={code}&to={target}")) == EMPTY
    assert site_log(m) == []


def test_emb02_ssrf_double_redirect_to_decoy_never_arrives(board_user: Client, board: dict[str, str], site_log) -> None:
    m = marker()
    inner = quote(f"{SITE}/redir?to={quote(f'{DECOY}/page?{m}', safe='')}", safe="")
    assert fields(preview(board_user, board["id"], f"{SITE}/redir?to={inner}")) == EMPTY
    assert site_log(m) == []


def test_emb02_ssrf_meta_refresh_is_not_followed(board_user: Client, board: dict[str, str], site_log) -> None:
    m = marker()
    target = quote(f"{DECOY}/page?{m}", safe="")
    preview(board_user, board["id"], f"{SITE}/refresh?to={target}")
    assert site_log(m) == []


def test_emb02_redirect_within_allowed_host_limit(board_user: Client, board: dict[str, str], site_log) -> None:
    assert fields(preview(board_user, board["id"], f"{SITE}/chain?n=1"))["title"] == "Chain end"
    assert fields(preview(board_user, board["id"], f"{SITE}/chain?n=3"))["title"] == "Chain end"
    assert fields(preview(board_user, board["id"], f"{SITE}/chain?n=4")) == EMPTY
    assert fields(preview(board_user, board["id"], f"{SITE}/loop")) == EMPTY


@pytest.mark.parametrize("target", [DECOY + "/img.png", "http://127.0.0.1:8000/docs", "http://api:8000/docs", "file:///etc/passwd", "data:image/png;base64,AAAA"])
def test_emb02_ssrf_image_address_checked_like_page(board_user: Client, board: dict[str, str], site_log, target: str) -> None:
    m = marker()
    full = f"{target}?{m}" if target.startswith("http") else target
    got = fields(preview(board_user, board["id"], f"{SITE}/img-at?to={quote(full, safe='')}"))
    assert got == {"title": "Image elsewhere", "image": None}
    assert site_log(m) == []


# --- EMB-02: размер, время, отказоустойчивость ------------------------------------------------


def test_emb02_size_page_beyond_limit_is_not_read(board_user: Client, board: dict[str, str], site_log) -> None:
    assert fields(preview(board_user, board["id"], f"{SITE}/near-limit"))["title"] == "inside limit"
    assert fields(preview(board_user, board["id"], f"{SITE}/huge-head")) == EMPTY


def test_emb02_size_endless_body_is_cut(board_user: Client, board: dict[str, str], site_log) -> None:
    start = time.monotonic()
    got = fields(preview(board_user, board["id"], f"{SITE}/endless"))
    assert time.monotonic() - start < 15
    assert got["title"] == "endless"
    time.sleep(1)
    assert site_log("/endless:finished") == []


def test_emb02_size_gzip_bomb_does_not_break_the_route(board_user: Client, board: dict[str, str], site_log) -> None:
    start = time.monotonic()
    got = fields(preview(board_user, board["id"], f"{SITE}/bomb"))
    assert time.monotonic() - start < 15
    assert got["title"] == "bomb"


@pytest.mark.parametrize("path", ["/slow", "/hang"])
def test_emb02_time_slow_page_is_bounded_and_others_are_served(board_user: Client, board: dict[str, str], site_log, path: str) -> None:
    results: dict[str, Any] = {}

    def slow() -> None:
        start = time.monotonic()
        with httpx.Client(base_url=board_user.base_url, cookies=dict(board_user.http.cookies), timeout=40.0) as c:
            results["status"] = c.post(f"/api/boards/{board['id']}/link-preview", json={"url": SITE + path}).status_code
        results["took"] = time.monotonic() - start

    thread = threading.Thread(target=slow)
    thread.start()
    worst = 0.0
    while thread.is_alive():
        start = time.monotonic()
        assert board_user.http.get("/api/health").status_code == 200
        worst = max(worst, time.monotonic() - start)
        time.sleep(0.2)
    thread.join()
    assert results["status"] == 200
    assert results["took"] < 15, results
    assert worst < 2.0, f"сервер не отвечал {worst:.1f} с"


def test_emb02_size_big_image_not_stored(board_user: Client, board: dict[str, str], site_log) -> None:
    assert fields(preview(board_user, board["id"], f"{SITE}/big-img")) == {"title": "Big image", "image": None}


@pytest.mark.parametrize("path", ["/svg-page", "/html-img"])
def test_emb02_sec_image_of_other_type_not_stored(board_user: Client, board: dict[str, str], site_log, path: str) -> None:
    assert fields(preview(board_user, board["id"], SITE + path))["image"] is None


def test_emb02_sec_html_declared_as_png_cannot_run_in_board_origin(board_user: Client, board: dict[str, str], site_log) -> None:
    image = fields(preview(board_user, board["id"], f"{SITE}/html-as-png"))["image"]
    if image is None:
        return
    fetched = board_user.http.get(image["url"])
    assert fetched.headers["content-type"].startswith("image/")
    assert fetched.headers.get("x-content-type-options", "").lower() == "nosniff", dict(fetched.headers)
    assert "frame-ancestors" in fetched.headers.get("content-security-policy", "") or fetched.headers.get("x-frame-options")


@pytest.mark.parametrize("path", ["/control-img", "/long-img", "/badport-img", "/badhost-img"])
def test_emb02_broken_image_address_is_not_a_server_error(board_user: Client, board: dict[str, str], site_log, path: str) -> None:
    resp = preview(board_user, board["id"], SITE + path)
    assert resp.status_code == 200, (resp.status_code, resp.text[:200])
    assert resp.json()["image"] is None
    assert resp.json()["title"]


@pytest.mark.parametrize(
    "location",
    ["http://linksite:8099/a\x01b", "http://linksite:99999/", "http://[::1/", "http://exa mple/", "http://" + "a" * 300 + "/", "\\\\decoy:8099/page"],
)
def test_emb02_broken_redirect_is_not_a_server_error(board_user: Client, board: dict[str, str], site_log, location: str) -> None:
    resp = preview(board_user, board["id"], f"{SITE}/redir?to={quote(location, safe='')}")
    assert resp.status_code == 200, (resp.status_code, resp.text[:200])
    assert fields(resp) == EMPTY


def test_emb02_indistinguishable_failures(board_user: Client, board: dict[str, str], site_log) -> None:
    """Внутренний адрес, закрытый порт, нет имени, 404, 500, не HTML: один ответ."""
    urls = {
        "внутренний": f"{DECOY}/page",
        "внутренний сервис": "http://api:8000/docs",
        "закрытый порт": "http://linksite:1/",
        "нет имени": "http://no-such-host.invalid/",
        "404": f"{SITE}/status?n=404",
        "500": f"{SITE}/status?n=500",
        "не HTML": f"{SITE}/json",
        "без данных": f"{SITE}/notitle",
    }
    ignored = {"date", "content-length", "server", "via"}
    seen = {}
    times = {}
    for name, url in urls.items():
        start = time.monotonic()
        resp = preview(board_user, board["id"], url)
        times[name] = round(time.monotonic() - start, 2)
        seen[name] = (resp.status_code, resp.json()["title"], resp.json()["image"], sorted(set(resp.headers) - ignored))
    print("наблюдение: время отказа, с:", times)
    assert len(set(map(str, seen.values()))) == 1, seen


# --- EMB-02: события и нагрузка на единственный процесс ---------------------------------------


@pytest.mark.parametrize("kind", ["lt", "comment", "tag", "attr", "pi", "decl", "close", "ent", "title", "meta", "cdata"])
def test_emb02_dos_hostile_markup_does_not_stop_the_server(board_user: Client, board: dict[str, str], site_log, kind: str) -> None:
    results: dict[str, Any] = {}

    def run() -> None:
        start = time.monotonic()
        with httpx.Client(base_url=board_user.base_url, cookies=dict(board_user.http.cookies), timeout=120.0) as c:
            results["status"] = c.post(f"/api/boards/{board['id']}/link-preview", json={"url": f"{SITE}/parser?kind={kind}"}).status_code
        results["took"] = time.monotonic() - start

    thread = threading.Thread(target=run)
    thread.start()
    worst = 0.0
    while thread.is_alive():
        start = time.monotonic()
        board_user.http.get("/api/health", timeout=120.0)
        worst = max(worst, time.monotonic() - start)
        time.sleep(0.05)
    thread.join()
    print(f"наблюдение: разметка {kind}: запрос {results['took']:.2f} с, /api/health до {worst:.2f} с")
    assert results["status"] == 200
    assert worst < 2.0, f"разметка {kind}: сервер не отвечал {worst:.1f} с"


def test_emb02_dos_parallel_hostile_pages_do_not_stop_the_server(board_user: Client, board: dict[str, str], site_log) -> None:
    """Один процесс держит всех (ARCHITECTURE.md, раздел 1): разбор чужой страницы не должен останавливать его."""
    cookies = dict(board_user.http.cookies)

    def run() -> None:
        with httpx.Client(base_url=board_user.base_url, cookies=cookies, timeout=120.0) as c:
            c.post(f"/api/boards/{board['id']}/link-preview", json={"url": f"{SITE}/parser?kind=lt"})

    threads = [threading.Thread(target=run) for _ in range(10)]
    for thread in threads:
        thread.start()
    worst = 0.0
    while any(t.is_alive() for t in threads):
        start = time.monotonic()
        board_user.http.get("/api/health", timeout=120.0)
        worst = max(worst, time.monotonic() - start)
        time.sleep(0.05)
    print(f"наблюдение: 10 параллельных страниц, /api/health до {worst:.2f} с")
    assert worst < 2.0, f"сервер не отвечал {worst:.1f} с"


# --- ARCH-FRAME: обходы --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "path",
    [
        "/b/x/embed/extra",
        "/b/x/y/embed",
        "/login?x=/embed",
        "/login/embed",
        "/b/embed",
        "/b//embed",
        "/B/x/embed",
        "/b/x/EMBED",
        "/api/b/x/embed",
        "/b/x/embed/..%2f..%2flogin",
        "/boards/x/embed",
        "/admin/b/x/embed",
    ],
)
def test_arch_frame_embed_lookalikes_deny_framing(client: Client, path: str) -> None:
    from test_stack import _frame_denied

    url = httpx.URL(client.base_url + "/").copy_with(raw_path=path.encode())
    resp = client.http.get(url)
    assert _frame_denied(resp), (path, dict(resp.headers))


def test_arch_frame_embed_answer_same_for_any_token(client: Client, board_user: Client, board: dict[str, str]) -> None:
    token = link(board_user, board["id"])["token"]
    real = client.http.get(f"/b/{token}/embed")
    bad = client.http.get("/b/" + "x" * 43 + "/embed")
    assert real.status_code == bad.status_code == 200
    assert real.text == bad.text
    drop = {"date", "etag", "last-modified"}
    assert {k: v for k, v in real.headers.items() if k not in drop} == {k: v for k, v in bad.headers.items() if k not in drop}


def test_emb04_shr05_refused_and_revoked_token_are_one_answer(client: Client, board_user: Client, board: dict[str, str]) -> None:
    old = link(board_user, board["id"])["token"]
    assert reset(board_user, board["id"]).status_code == 200
    bad = "y" * 43
    for method, path, body in [("GET", "/api/share/{}", None), ("POST", "/api/share/{}/join", {"name": "N", "embed": True})]:
        answers = {
            (r.status_code, r.text)
            for r in (
                client.http.request(method, path.format(old), json=body),
                client.http.request(method, path.format(bad), json=body),
            )
        }
        assert len(answers) == 1, answers
        assert next(iter(answers))[0] == 404


# --- EMB-04 на http:// ----------------------------------------------------------------------------


def test_emb04_q008_http_join_gets_plain_lax_cookie(client: Client, board_user: Client, board: dict[str, str]) -> None:
    if client.base_url.startswith("https://"):
        pytest.skip("только http://")
    token = link(board_user, board["id"])["token"]
    resp = client.http.post(f"/api/share/{token}/join", json={"name": "Frame", "embed": True})
    assert resp.status_code == 200
    cookies = resp.headers.get_list("set-cookie")
    assert len(cookies) == 1, cookies
    low = cookies[0].lower()
    assert low.startswith("myboard_board_")
    assert "httponly" in low and "samesite=lax" in low
    assert "secure" not in low and "partitioned" not in low and "samesite=none" not in low


def test_emb04_q008_http_forged_embed_cookie_is_not_accepted(client: Client, board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    if client.base_url.startswith("https://"):
        pytest.skip("только http://")
    token = link(board_user, board["id"])["token"]
    with clients(clean_stack, "guest") as (guest,):
        assert join(guest, token, "G").status_code == 200
        session = next(c for c in guest.http.cookies.jar if c.name.startswith("myboard_board_"))
        name = session.name.replace("myboard_board_", "myboard_embed_")
    resp = httpx.get(
        f"{clean_stack}/api/share/{token}",
        headers={"Cookie": f"{name}={session.value}", "Sec-Fetch-Site": "same-origin"},
        timeout=10.0,
    )
    assert resp.json()["participant"] is None


# --- EMB-04 при HTTPS: cookie и подделка запросов (стенд с TLS) --------------------------------


@dataclass
class Tls:
    base: str
    host: str
    board_id: str
    token: str
    owner: httpx.Client
    cookie: str
    media: str


def _tls_client() -> httpx.Client:
    return httpx.Client(base_url=HTTPS_BASE_URL, verify=False, timeout=15.0, follow_redirects=False)


@pytest.fixture(scope="module")
def tls() -> Iterator[Tls]:
    if not HTTPS_BASE_URL:
        pytest.skip("HTTPS_BASE_URL не задан: стенд с TLS не поднят")
    email, password = admin_credentials()
    with _tls_client() as admin_c, _tls_client() as owner, _tls_client() as guest:
        assert admin_c.post("/api/admin/login", json={"email": email, "password": password}).status_code == 204
        u = {"name": "TLS " + marker(), "email": f"{marker()}@example.com", "password": "pw-" + marker()}
        assert admin_c.post("/api/admin/users", json=u).status_code == 201
        assert owner.post("/api/login", json={"email": u["email"], "password": u["password"]}).status_code == 204
        board = owner.post("/api/boards", json={"title": "tls"}).json()
        token = owner.get(f"/api/boards/{board['id']}/share").json()["token"]
        media = owner.post(f"/api/boards/{board['id']}/media", content=png(), headers={"Content-Type": "image/png", "X-File-Name": "a.png"}, params={"name": "a.png"})
        assert media.status_code in (200, 201), media.text
        joined = guest.post(f"/api/share/{token}/join", json={"name": "Frame", "embed": True}, headers={"Sec-Fetch-Site": "same-origin"})
        assert joined.status_code == 200, joined.text
        cookie = joined.headers.get_list("set-cookie")[0].split(";", 1)[0]
        yield Tls(HTTPS_BASE_URL, urlsplit(HTTPS_BASE_URL).netloc, board["id"], token, owner, cookie, media.json()["id"])


def test_emb04_q008_https_embed_cookie_flags(tls: Tls) -> None:
    with _tls_client() as c:
        resp = c.post(f"/api/share/{tls.token}/join", json={"name": "F", "embed": True}, headers={"Sec-Fetch-Site": "same-origin"})
    cookies = resp.headers.get_list("set-cookie")
    assert len(cookies) == 1, cookies
    parts = [p.strip().lower() for p in cookies[0].split(";")]
    assert parts[0].startswith("myboard_embed_")
    for flag in ("httponly", "secure", "samesite=none", "partitioned", "path=/"):
        assert flag in parts, cookies
    assert not any(p.startswith(("domain=", "max-age=", "expires=")) for p in parts), cookies


def test_emb04_q008_https_ordinary_sessions_stay_lax(tls: Tls) -> None:
    email, password = admin_credentials()
    with _tls_client() as guest, _tls_client() as admin_c:
        joined = guest.post(f"/api/share/{tls.token}/join", json={"name": "P"}, headers={"Sec-Fetch-Site": "same-origin"})
        admin_login = admin_c.post("/api/admin/login", json={"email": email, "password": password})
    for resp in (joined, admin_login):
        cookies = resp.headers.get_list("set-cookie")
        assert cookies
        for value in cookies:
            low = value.lower()
            assert "samesite=lax" in low and "secure" in low and "httponly" in low, value
            assert "partitioned" not in low and "samesite=none" not in low, value


TRUSTED = [
    pytest.param({"Sec-Fetch-Site": "same-origin"}, id="same-origin"),
]
ORIGIN_OWN = "ORIGIN_OWN"
CROSS = [
    pytest.param({}, id="без признаков"),
    pytest.param({"Sec-Fetch-Site": "cross-site"}, id="cross-site"),
    pytest.param({"Sec-Fetch-Site": "same-site"}, id="same-site"),
    pytest.param({"Sec-Fetch-Site": "none"}, id="none"),
    pytest.param({"Sec-Fetch-Site": "SAME-ORIGIN"}, id="регистр"),
    pytest.param({"Sec-Fetch-Site": "cross-site", "Origin": ORIGIN_OWN}, id="cross-site и свой Origin"),
    pytest.param({"Origin": "https://evil.example"}, id="чужой Origin"),
    pytest.param({"Origin": "null"}, id="Origin null"),
    pytest.param({"Origin": "SCHEME_HTTP"}, id="Origin http той же записи"),
    pytest.param({"Origin": "OTHER_PORT"}, id="Origin другой порт"),
    pytest.param({"Origin": "SUFFIX"}, id="Origin с хвостом"),
    pytest.param({"Referer": ORIGIN_OWN + "/"}, id="только Referer"),
    pytest.param({"X-Forwarded-Host": "OWN_HOST", "X-Forwarded-Proto": "https", "Origin": "https://evil.example"}, id="X-Forwarded и чужой Origin"),
]


def _headers(tls: Tls, headers: dict[str, str]) -> dict[str, str]:
    host = urlsplit(tls.base).hostname
    subst = {
        ORIGIN_OWN: tls.base,
        "SCHEME_HTTP": tls.base.replace("https://", "http://"),
        "OTHER_PORT": f"https://{host}:9443",
        "SUFFIX": f"{tls.base}.evil.example",
        "OWN_HOST": tls.host,
    }
    out = {}
    for key, value in headers.items():
        for token, real in subst.items():
            value = value.replace(token, real)
        out[key] = value
    out["Cookie"] = tls.cookie
    return out


@pytest.mark.parametrize("headers", TRUSTED + [pytest.param({"Origin": ORIGIN_OWN}, id="свой Origin без Sec-Fetch")])
def test_emb04_q008_https_own_page_is_accepted(tls: Tls, headers: dict[str, str]) -> None:
    with _tls_client() as c:
        h = _headers(tls, headers)
        assert c.get(f"/api/share/{tls.token}", headers=h).json()["participant"] is not None
        assert c.get(f"/api/media/{tls.media}", headers=h).status_code == 200
        assert c.post(f"/api/boards/{tls.board_id}/link-preview", json={"url": "http://no-such.invalid/"}, headers=h).status_code == 200
    assert _ws_status(tls, h) == 101


@pytest.mark.parametrize("headers", CROSS)
def test_emb04_q008_https_foreign_request_gets_no_session(tls: Tls, headers: dict[str, str]) -> None:
    with _tls_client() as c:
        h = _headers(tls, headers)
        assert c.get(f"/api/share/{tls.token}", headers=h).json()["participant"] is None
        assert c.get(f"/api/media/{tls.media}", headers=h).status_code == 404
        assert c.post(f"/api/boards/{tls.board_id}/media", content=png(), headers={**h, "Content-Type": "image/png"}, params={"name": "x.png"}).status_code == 404
        assert c.post(f"/api/boards/{tls.board_id}/link-preview", json={"url": "http://no-such.invalid/"}, headers=h).status_code == 404
        assert c.post(f"/api/boards/{tls.board_id}/media/copies", json={"ids": []}, headers=h).status_code in (404, 422)


@pytest.mark.parametrize("headers", CROSS)
def test_emb04_q008_https_foreign_websocket_is_closed(tls: Tls, headers: dict[str, str]) -> None:
    h = _headers(tls, headers)
    assert _ws_status(tls, h) == 403


@pytest.mark.parametrize("headers", CROSS)
def test_emb04_q008_https_forged_join_is_refused_like_bad_link(tls: Tls, headers: dict[str, str]) -> None:
    with _tls_client() as c:
        h = _headers(tls, headers)
        h.pop("Cookie")
        forged = c.post(f"/api/share/{tls.token}/join", json={"name": "Forged", "embed": True}, headers=h)
        bad = c.post("/api/share/" + "z" * 43 + "/join", json={"name": "Forged", "embed": True})
    assert forged.status_code == 404, forged.text
    assert (forged.status_code, forged.text) == (bad.status_code, bad.text)
    assert "set-cookie" not in forged.headers


def _ws_status(tls: Tls, headers: dict[str, str], token: str | None = None) -> int:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    url = f"wss://{tls.host}/api/ws?token={token or tls.token}"
    origin = headers.get("Origin")
    extra = {k: v for k, v in headers.items() if k != "Origin"}
    try:
        with connect(url, additional_headers=extra, origin=origin, ssl=ctx, open_timeout=10):  # type: ignore[arg-type]
            return 101
    except InvalidStatus as exc:
        return exc.response.status_code


def test_emb04_q008_https_cookie_opens_only_its_board_and_no_owner_actions(tls: Tls) -> None:
    same = {"Cookie": tls.cookie, "Sec-Fetch-Site": "same-origin"}
    with _tls_client() as c:
        assert c.get("/api/session", headers=same).status_code in (200, 401)
        session = c.get("/api/session", headers=same)
        assert session.status_code == 401 or session.json().get("authenticated") is not True
        assert c.get("/api/boards", headers=same).status_code == 401
        assert c.get(f"/api/boards/{tls.board_id}", headers=same).status_code in (401, 404)
        assert c.get(f"/api/boards/{tls.board_id}/share", headers=same).status_code in (401, 404)
        assert c.post(f"/api/boards/{tls.board_id}/share/reset", headers=same).status_code in (401, 404)
        assert c.delete(f"/api/boards/{tls.board_id}", headers=same).status_code in (401, 404)
        other = tls.owner.post("/api/boards", json={"title": "tls2"}).json()
        token2 = tls.owner.get(f"/api/boards/{other['id']}/share").json()["token"]
        assert c.get(f"/api/share/{token2}", headers=same).json()["participant"] is None
        media2 = tls.owner.post(f"/api/boards/{other['id']}/media", content=png(), headers={"Content-Type": "image/png"}, params={"name": "b.png"}).json()
        assert c.get(f"/api/media/{media2['id']}", headers=same).status_code == 404
    assert _ws_status(tls, same, token2) == 403


def test_emb04_shr06_https_reset_revokes_embed_cookie_and_closes_channel() -> None:
    if not HTTPS_BASE_URL:
        pytest.skip("HTTPS_BASE_URL не задан")
    email, password = admin_credentials()
    with _tls_client() as admin_c, _tls_client() as owner, _tls_client() as guest:
        admin_c.post("/api/admin/login", json={"email": email, "password": password})
        u = {"name": "TLS " + marker(), "email": f"{marker()}@example.com", "password": "pw-" + marker()}
        admin_c.post("/api/admin/users", json=u)
        owner.post("/api/login", json={"email": u["email"], "password": u["password"]})
        board = owner.post("/api/boards", json={"title": "tls"}).json()
        token = owner.get(f"/api/boards/{board['id']}/share").json()["token"]
        media = owner.post(f"/api/boards/{board['id']}/media", content=png(), headers={"Content-Type": "image/png"}, params={"name": "a.png"}).json()
        joined = guest.post(f"/api/share/{token}/join", json={"name": "F", "embed": True}, headers={"Sec-Fetch-Site": "same-origin"})
        cookie = joined.headers.get_list("set-cookie")[0].split(";", 1)[0]
        same = {"Cookie": cookie, "Sec-Fetch-Site": "same-origin"}
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        host = urlsplit(HTTPS_BASE_URL).netloc
        with connect(f"wss://{host}/api/ws?token={token}", additional_headers=same, ssl=ctx) as ws:
            assert owner.post(f"/api/boards/{board['id']}/share/reset").status_code == 200
            closed = False
            deadline = time.monotonic() + 10
            try:
                while time.monotonic() < deadline:
                    ws.recv(timeout=2)
            except ConnectionClosed:
                closed = True
            except TimeoutError:
                pass
            assert closed, "канал не закрыт после сброса"
        with _tls_client() as c:
            assert c.get(f"/api/media/{media['id']}", headers=same).status_code == 404
            new = owner.get(f"/api/boards/{board['id']}/share").json()["token"]
            assert c.get(f"/api/share/{new}", headers=same).json()["participant"] is None


def test_arch_frame_https_same_rule(tls: Tls) -> None:
    from test_stack import _frame_denied

    with _tls_client() as c:
        for path in ("/", "/login", f"/b/{tls.token}", "/api/health", "/admin/login"):
            assert _frame_denied(c.get(path)), path
        allowed = c.get(f"/b/{tls.token}/embed")
        assert allowed.status_code == 200
        assert not allowed.headers.get("x-frame-options")
        assert not re.search("frame-ancestors", allowed.headers.get("content-security-policy", ""))
