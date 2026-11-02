"""Приёмка T7.2 · файлы, PDF, видео, аудио на стороне сервера (FIL-01…FIL-04; ARCHITECTURE.md 8, 12).

Сценарии — docs/qa/reports/T7.2.md (зафиксированы до чтения handoff); публичный API —
из handoff T7.2. Только HTTP по PUBLIC_BASE_URL.
"""

from __future__ import annotations

import re
import socket
from collections.abc import Iterator
from urllib.parse import unquote

import httpx
import pytest

from admin_helpers import create_user
from board_helpers import create_board, unique_title
from media_helpers import HTML_PAYLOAD, SVG_WITH_SCRIPT, fetch, max_upload_bytes, refusal, uploaded
from share_helpers import join, link, reset
from stand import Client
from test_stack import _frame_denied
from user_helpers import user_login

OCTET = "application/octet-stream"
REFUSED = {401, 403, 404}
MISSING = "00000000-0000-4000-8000-000000000000"
PLAYABLE = [
    "application/pdf",
    "video/mp4",
    "video/x-m4v",
    "video/quicktime",
    "video/webm",
    "audio/mpeg",
    "audio/mp4",
    "audio/wav",
    "audio/webm",
]


def _file(client: Client, board_id: str, data: bytes, mime: str | None = OCTET, name: str = "doc.bin") -> httpx.Response:
    headers = {} if mime is None else {"Content-Type": mime}
    return client.http.post(
        f"/api/boards/{board_id}/media", params={"name": name, "kind": "file"}, content=data, headers=headers, timeout=120.0
    )


def _stored_file(client: Client, board_id: str, data: bytes = b"payload", name: str = "doc.bin") -> str:
    resp = _file(client, board_id, data, name=name)
    assert resp.status_code == 201, (resp.status_code, resp.text)
    return str(resp.json()["id"])


def _download(client: Client, media_id: str, name: str) -> httpx.Response:
    return client.http.get(f"/api/media/{media_id}", params={"download": name})


def _filename(resp: httpx.Response) -> str:
    """Имя из Content-Disposition так, как его прочтёт браузер: filename* важнее filename."""
    header = resp.headers["content-disposition"]
    assert header.lower().startswith("attachment"), header
    extended = re.search(r"filename\*=UTF-8''([^;]+)", header, re.I)
    if extended:
        return unquote(extended.group(1))
    plain = re.search(r'filename="([^"]*)"', header)
    assert plain, header
    return plain.group(1)


def _other_user(admin: Client, base_url: str) -> Client:
    account = create_user(admin)
    one = Client("other_user", base_url)
    resp = user_login(one, account["email"], account["_password"])
    assert resp.status_code == 204, (resp.status_code, resp.text)
    return one


def _guest(base_url: str, token: str) -> Client:
    one = Client("guest", base_url)
    resp = join(one, token, "QA Guest")
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return one


# --- FIL-01: загрузка и скачивание любого файла ---------------------------------


@pytest.mark.parametrize(
    "name", ["notes.txt", "report.docx", "archive.zip", "noextension", "script.exe", "page.html", "photo.png"]
)
def test_fil01_any_file_uploads_and_downloads_same_bytes(board_user: Client, board: dict[str, str], name: str) -> None:
    data = bytes(range(256)) * 8
    media_id = _stored_file(board_user, board["id"], data, name)
    resp = _download(board_user, media_id, name)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert resp.content == data
    assert _filename(resp) == name


def test_fil01_participant_uploads_file_owner_downloads(link_participant: Client, board_user: Client) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    media_id = _stored_file(link_participant, board_id, b"from guest")
    assert _download(board_user, media_id, "x.bin").content == b"from guest"
    assert _download(link_participant, media_id, "x.bin").content == b"from guest"


def test_fil01_owner_file_downloaded_by_participant(link_participant: Client, board_user: Client) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    media_id = _stored_file(board_user, board_id, b"from owner")
    assert _download(link_participant, media_id, "x.bin").content == b"from owner"


@pytest.mark.parametrize(
    "name",
    [
        "Отчёт за май.txt",
        'quo"te.txt',
        "semi;colon, comma.txt",
        "emoji-\U0001f600.txt",
        "per%20cent.txt",
    ],
)
def test_fil01_download_name_survives_special_characters(board_user: Client, board: dict[str, str], name: str) -> None:
    media_id = _stored_file(board_user, board["id"])
    resp = _download(board_user, media_id, name)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert _filename(resp) == name


def test_fil01_download_name_cannot_inject_header(board_user: Client, board: dict[str, str]) -> None:
    media_id = _stored_file(board_user, board["id"])
    resp = _download(board_user, media_id, "a\r\nX-Injected: yes\r\n\r\nbody.txt")
    assert resp.status_code in {200, 400, 422}, (resp.status_code, resp.text)
    assert "x-injected" not in resp.headers


def test_fil01_download_name_with_path_reads_only_this_file(board_user: Client, board: dict[str, str]) -> None:
    media_id = _stored_file(board_user, board["id"])
    resp = _download(board_user, media_id, "../../etc/passwd")
    assert resp.status_code in {200, 400, 422}, (resp.status_code, resp.text)
    if resp.status_code == 200:
        assert resp.content == b"payload"


def test_fil01_very_long_download_name_is_not_server_error(board_user: Client, board: dict[str, str]) -> None:
    media_id = _stored_file(board_user, board["id"])
    resp = _download(board_user, media_id, "я" * 2000 + ".txt")
    assert resp.status_code < 500, (resp.status_code, resp.text)


# --- FIL-01: лимит, пустой файл, объявленный тип --------------------------------


def test_fil01_file_over_limit_rejected(board_user: Client, board: dict[str, str]) -> None:
    resp = _file(board_user, board["id"], b"\x00" * (max_upload_bytes() + 1))
    assert resp.status_code == 413, (resp.status_code, resp.text[:200])


def test_fil01_file_exactly_limit_accepted(board_user: Client, board: dict[str, str]) -> None:
    limit = max_upload_bytes()
    resp = _file(board_user, board["id"], b"\x00" * limit)
    assert resp.status_code == 201, (resp.status_code, resp.text[:200])
    assert len(fetch(board_user, resp.json()["id"]).content) == limit


def test_fil01_empty_file_is_refused_or_downloads_empty(board_user: Client, board: dict[str, str]) -> None:
    resp = _file(board_user, board["id"], b"")
    assert resp.status_code < 500, resp.text
    if resp.status_code == 201:
        assert _download(board_user, resp.json()["id"], "empty.txt").content == b""


@pytest.mark.parametrize("mime", ["text/html", "image/svg+xml", "application/xhtml+xml", "application/x-msdownload", "text/plain"])
def test_fil01_other_declared_type_for_file_refused(board_user: Client, board: dict[str, str], mime: str) -> None:
    resp = _file(board_user, board["id"], HTML_PAYLOAD, mime=mime)
    assert resp.status_code == 415, (resp.status_code, resp.text)


def test_fil01_octet_stream_without_kind_refused(board_user: Client, board: dict[str, str]) -> None:
    resp = board_user.http.post(
        f"/api/boards/{board['id']}/media", params={"name": "x.bin"}, content=b"x", headers={"Content-Type": OCTET}
    )
    assert resp.status_code == 415, (resp.status_code, resp.text)


@pytest.mark.parametrize("payload", [HTML_PAYLOAD, SVG_WITH_SCRIPT])
def test_fil01_active_content_is_never_served_as_page(board_user: Client, board: dict[str, str], payload: bytes) -> None:
    media_id = _stored_file(board_user, board["id"], payload, "evil.html")
    resp = fetch(board_user, media_id)
    assert resp.status_code == 200
    assert resp.headers["content-type"].split(";")[0].strip() == OCTET
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert "sandbox" in resp.headers.get("content-security-policy", "")


# --- FIL-01: доступ к файлу -----------------------------------------------------


def test_fil01_upload_refused_for_strangers(admin: Client, board: dict[str, str], client: Client, clean_stack: str) -> None:
    other = _other_user(admin, clean_stack)
    for who, one in {"без сессии": client, "другой пользователь": other, "администратор": admin}.items():
        resp = _file(one, board["id"], b"x")
        assert resp.status_code in REFUSED, (who, resp.status_code, resp.text)


def test_fil01_participant_of_other_board_cannot_upload_or_download(board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    other_board = create_board(board_user, unique_title("Другая"))
    guest = _guest(clean_stack, link(board_user, other_board["id"])["token"])
    assert _file(guest, board["id"], b"x").status_code in REFUSED
    media_id = _stored_file(board_user, board["id"])
    assert _download(guest, media_id, "x.bin").status_code in REFUSED


def test_fil01_download_refused_for_strangers_same_as_missing(
    admin: Client, board_user: Client, board: dict[str, str], client: Client, clean_stack: str
) -> None:
    media_id = _stored_file(board_user, board["id"])
    other = _other_user(admin, clean_stack)
    for who, one in {"без сессии": client, "другой пользователь": other, "администратор": admin}.items():
        foreign = _download(one, media_id, "x.bin")
        assert foreign.status_code in REFUSED, (who, foreign.status_code)
        assert "content-disposition" not in foreign.headers, who
        assert refusal(foreign) == refusal(_download(one, MISSING, "x.bin")), who


def test_fil01_reset_link_revokes_old_cookie_for_download(link_participant: Client, board_user: Client, clean_stack: str) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    media_id = _stored_file(board_user, board_id)
    assert _download(link_participant, media_id, "x.bin").status_code == 200
    assert reset(board_user, board_id).status_code in (200, 204)
    assert _download(link_participant, media_id, "x.bin").status_code in REFUSED
    assert fetch(link_participant, media_id).status_code in REFUSED
    assert _download(_guest(clean_stack, link(board_user, board_id)["token"]), media_id, "x.bin").status_code == 200


# --- FIL-02…04: типы и выдача ----------------------------------------------------


@pytest.mark.parametrize("mime", PLAYABLE)
def test_fil02_fil03_fil04_playable_type_accepted_and_returned(board_user: Client, board: dict[str, str], mime: str) -> None:
    body = uploaded(board_user, board["id"], b"\x00\x01data", mime, "clip")
    resp = fetch(board_user, body["id"])
    assert resp.status_code == 200
    assert resp.headers["content-type"].split(";")[0].strip() == mime
    assert resp.headers.get("x-content-type-options") == "nosniff"
    assert _frame_denied(resp), dict(resp.headers)


def test_fil03_range_supports_seek(board_user: Client, board: dict[str, str]) -> None:
    data = bytes(range(256)) * 4
    media_id = uploaded(board_user, board["id"], data, "video/mp4", "clip.mp4")["id"]
    assert fetch(board_user, media_id).headers.get("accept-ranges") == "bytes"

    middle = board_user.http.get(f"/api/media/{media_id}", headers={"Range": "bytes=100-199"})
    assert middle.status_code == 206
    assert middle.content == data[100:200]
    assert middle.headers["content-range"] == f"bytes 100-199/{len(data)}"

    tail = board_user.http.get(f"/api/media/{media_id}", headers={"Range": "bytes=-10"})
    assert tail.status_code == 206
    assert tail.content == data[-10:]

    open_end = board_user.http.get(f"/api/media/{media_id}", headers={"Range": f"bytes={len(data) - 5}-"})
    assert open_end.status_code == 206
    assert open_end.content == data[-5:]


def test_fil03_range_past_end_answers_416(board_user: Client, board: dict[str, str]) -> None:
    media_id = uploaded(board_user, board["id"], b"0123456789", "video/mp4", "clip.mp4")["id"]
    resp = board_user.http.get(f"/api/media/{media_id}", headers={"Range": "bytes=100-200"})
    assert resp.status_code == 416, (resp.status_code, resp.text)


def test_fil03_range_is_refused_for_strangers_same_as_missing(board_user: Client, board: dict[str, str], client: Client) -> None:
    media_id = uploaded(board_user, board["id"], b"0123456789", "video/mp4", "clip.mp4")["id"]
    headers = {"Range": "bytes=0-1"}
    foreign = client.http.get(f"/api/media/{media_id}", headers=headers)
    missing = client.http.get(f"/api/media/{MISSING}", headers=headers)
    assert foreign.status_code in REFUSED
    assert refusal(foreign) == refusal(missing)


def test_fil03_participant_seeks_owner_video(link_participant: Client, board_user: Client) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    data = bytes(range(256))
    media_id = uploaded(board_user, board_id, data, "video/webm", "clip.webm")["id"]
    resp = link_participant.http.get(f"/api/media/{media_id}", headers={"Range": "bytes=10-19"})
    assert resp.status_code == 206
    assert resp.content == data[10:20]


@pytest.mark.parametrize("mime", ["video/x-msvideo", "audio/x-ms-wma", "video/x-matroska"])
def test_fil03_fil04_other_formats_are_not_playable_types(board_user: Client, board: dict[str, str], mime: str) -> None:
    resp = board_user.http.post(
        f"/api/boards/{board['id']}/media", params={"name": "clip"}, content=b"x", headers={"Content-Type": mime}
    )
    assert resp.status_code == 415, (resp.status_code, resp.text)


# ---------- Перепроверка BUG-029: отказ по размеру виден клиенту ----------


def _stream(total: int, chunk: int = 1024 * 1024) -> Iterator[bytes]:
    sent = 0
    while sent < total:
        part = min(chunk, total - sent)
        yield b"\x00" * part
        sent += part


def test_fil01_bug029_chunked_over_limit_is_413_and_nothing_stored(board_user: Client, board: dict[str, str]) -> None:
    """Без Content-Length сервер считает байты сам."""
    resp = board_user.http.post(
        f"/api/boards/{board['id']}/media",
        params={"name": "chunked.bin", "kind": "file"},
        content=_stream(max_upload_bytes() + 1),
        headers={"Content-Type": OCTET},
        timeout=180.0,
    )
    assert resp.status_code == 413, (resp.status_code, resp.text[:200])
    assert "id" not in resp.json()


def test_fil01_bug029_chunked_exact_limit_is_accepted(board_user: Client, board: dict[str, str]) -> None:
    limit = max_upload_bytes()
    resp = board_user.http.post(
        f"/api/boards/{board['id']}/media",
        params={"name": "chunked.bin", "kind": "file"},
        content=_stream(limit),
        headers={"Content-Type": OCTET},
        timeout=180.0,
    )
    assert resp.status_code == 201, (resp.status_code, resp.text[:200])
    assert len(fetch(board_user, resp.json()["id"]).content) == limit


def test_fil01_bug029_far_over_limit_is_413(board_user: Client, board: dict[str, str]) -> None:
    resp = _file(board_user, board["id"], b"\x00" * (3 * max_upload_bytes()))
    assert resp.status_code == 413, (resp.status_code, resp.text[:200])


def test_fil01_bug029_over_limit_from_strangers_is_a_refusal_not_a_size_answer(
    admin: Client, board: dict[str, str], client: Client, clean_stack: str
) -> None:
    """Отказ в доступе идёт раньше размера: посторонний не узнаёт о доске и не занимает сервер."""
    other = _other_user(admin, clean_stack)
    body = b"\x00" * (max_upload_bytes() + 1)
    for who, one in {"без сессии": client, "другой пользователь": other, "администратор": admin}.items():
        resp = _file(one, board["id"], body)
        assert resp.status_code in REFUSED, (who, resp.status_code, resp.text[:200])
        assert refusal(resp) == refusal(_file(one, MISSING, b"x")), who


def test_fil01_bug029_declared_huge_length_does_not_hang(board_user: Client, board: dict[str, str]) -> None:
    """Объявлено 5 ГиБ, отправлено 1 МиБ: сервер не ждёт остальное. httpx такой запрос не отправит."""
    url = httpx.URL(str(board_user.http.base_url))
    cookies = "; ".join(f"{name}={value}" for name, value in board_user.http.cookies.items())
    head = (
        f"POST /api/boards/{board['id']}/media?name=huge.bin&kind=file HTTP/1.1\r\n"
        f"Host: {url.netloc.decode()}\r\nCookie: {cookies}\r\nContent-Type: {OCTET}\r\n"
        f"Content-Length: {5 * 1024**3}\r\nConnection: close\r\n\r\n"
    )
    with socket.create_connection((url.host, url.port or 80), timeout=30.0) as raw:
        raw.sendall(head.encode() + b"\x00" * (1024 * 1024))
        try:
            answer = raw.recv(256)
        except TimeoutError:
            pytest.fail("сервер ждёт объявленные 5 ГиБ дольше 30 с")
    assert answer.startswith(b"HTTP/1.1 413"), answer[:80]
    assert board_user.http.get("/api/session").status_code == 200
