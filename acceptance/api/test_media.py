"""Приёмка T7.1 · модуль media (IMG-01, IMG-07 на стороне сервера; ARCHITECTURE.md 8, 12).

Сценарии — docs/qa/reports/T7.1.md (зафиксированы до чтения handoff); публичный API —
из handoff T7.1. Только HTTP по PUBLIC_BASE_URL.
"""

from __future__ import annotations

import re
import subprocess
import uuid

import pytest

from admin_helpers import create_user
from board_helpers import create_board, delete_board, unique_title
from media_helpers import (
    HTML_PAYLOAD,
    SVG_WITH_SCRIPT,
    fetch,
    max_upload_bytes,
    padded_png,
    png,
    refusal,
    upload,
    uploaded,
)
from share_helpers import join, link, reset
from stand import Client, clients
from test_stack import _frame_denied
from user_helpers import user_login

REFUSED = {401, 403, 404}


def _other_user(admin: Client, base_url: str) -> Client:
    account = create_user(admin)
    one = Client("other_user", base_url)
    resp = user_login(one, account["email"], account["_password"])
    assert resp.status_code == 204, (resp.status_code, resp.text)
    return one


def _guest(base_url: str, token: str, name: str = "QA Guest") -> Client:
    one = Client("guest", base_url)
    resp = join(one, token, name)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return one


def _media_dir_listing(board_id: str) -> list[str]:
    """Файлы MEDIA_ROOT/{board_id} в контейнере api (подготовка/наблюдение, как age_board в T2.1)."""
    uuid.UUID(board_id)
    out = subprocess.run(
        ["docker", "exec", "myboard-qa-api-1", "sh", "-c", f'ls -1 "$MEDIA_ROOT/{board_id}" 2>/dev/null || true'],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


# --- IMG-01: загрузка и выдача владельцу и участнику ---------------------------


def test_img01_owner_uploads_and_gets_same_bytes(board_user: Client, board: dict[str, str]) -> None:
    data = png(5, 7)
    body = uploaded(board_user, board["id"], data)
    resp = fetch(board_user, body["id"])
    assert resp.status_code == 200, (resp.status_code, resp.text)
    assert resp.content == data
    assert resp.headers["content-type"].split(";")[0].strip() == "image/png"


def test_img01_arch_file_stored_under_media_root_board_dir(board_user: Client, board: dict[str, str]) -> None:
    body = uploaded(board_user, board["id"], png())
    assert body["id"] in _media_dir_listing(board["id"])


def test_img01_participant_uploads_owner_sees(link_participant: Client, board_user: Client) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    data = png(3, 3, (1, 2, 3, 255))
    body = uploaded(link_participant, board_id, data)
    assert fetch(board_user, body["id"]).content == data
    assert fetch(link_participant, body["id"]).content == data


def test_img01_participant_gets_owner_file(link_participant: Client, board_user: Client) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    body = uploaded(board_user, board_id, png())
    assert fetch(link_participant, body["id"]).status_code == 200


@pytest.mark.parametrize("mime", ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"])
def test_img01_img07_image_types_accepted(board_user: Client, board: dict[str, str], mime: str) -> None:
    data = SVG_WITH_SCRIPT if mime == "image/svg+xml" else png()
    resp = upload(board_user, board["id"], data, mime, "f")
    assert resp.status_code == 201, (mime, resp.status_code, resp.text)


# --- Доступ к загрузке ----------------------------------------------------------


def test_img01_upload_without_session_refused(client: Client, board: dict[str, str]) -> None:
    resp = upload(client, board["id"], png())
    assert resp.status_code in REFUSED, (resp.status_code, resp.text)
    assert _media_dir_listing(board["id"]) == []


def test_img01_upload_with_other_board_session_refused(board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    other = create_board(board_user, unique_title())
    guest = _guest(clean_stack, link(board_user, other["id"])["token"])
    try:
        resp = upload(guest, board["id"], png())
        assert resp.status_code in REFUSED, (resp.status_code, resp.text)
    finally:
        guest.close()


def test_img01_upload_by_other_user_and_admin_refused(admin: Client, board: dict[str, str], clean_stack: str) -> None:
    stranger = _other_user(admin, clean_stack)
    try:
        assert upload(stranger, board["id"], png()).status_code in REFUSED
        assert upload(admin, board["id"], png()).status_code in REFUSED
    finally:
        stranger.close()
    assert _media_dir_listing(board["id"]) == []


def test_img01_upload_to_missing_board_same_as_foreign(admin: Client, board: dict[str, str], clean_stack: str) -> None:
    stranger = _other_user(admin, clean_stack)
    try:
        foreign = upload(stranger, board["id"], png())
        missing = upload(stranger, str(uuid.uuid4()), png())
        assert refusal(foreign) == refusal(missing)
    finally:
        stranger.close()


# --- Доступ к выдаче /api/media/{id} --------------------------------------------


def test_arch_media_without_session_refused(board_user: Client, board: dict[str, str], client: Client) -> None:
    body = uploaded(board_user, board["id"], png())
    assert fetch(client, body["id"]).status_code in REFUSED


def test_arch_media_other_board_session_refused(board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    body = uploaded(board_user, board["id"], png())
    other = create_board(board_user, unique_title())
    guest = _guest(clean_stack, link(board_user, other["id"])["token"])
    try:
        assert fetch(guest, body["id"]).status_code in REFUSED
    finally:
        guest.close()


def test_arch_media_other_user_and_admin_refused(admin: Client, board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    body = uploaded(board_user, board["id"], png())
    stranger = _other_user(admin, clean_stack)
    try:
        assert fetch(stranger, body["id"]).status_code in REFUSED
        assert fetch(admin, body["id"]).status_code in REFUSED
    finally:
        stranger.close()


def test_arch_media_reset_link_revokes_old_cookie(link_participant: Client, board_user: Client, clean_stack: str) -> None:
    board_id = link_participant.board["id"]  # type: ignore[attr-defined]
    body = uploaded(board_user, board_id, png())
    assert fetch(link_participant, body["id"]).status_code == 200
    assert reset(board_user, board_id).status_code in (200, 204)
    assert fetch(link_participant, body["id"]).status_code in REFUSED
    assert upload(link_participant, board_id, png()).status_code in REFUSED
    fresh = _guest(clean_stack, link(board_user, board_id)["token"])
    try:
        assert fetch(fresh, body["id"]).status_code == 200
    finally:
        fresh.close()
    assert fetch(board_user, body["id"]).status_code == 200


def test_arch_media_refusals_indistinguishable(admin: Client, board_user: Client, board: dict[str, str], clean_stack: str) -> None:
    body = uploaded(board_user, board["id"], png())
    stranger = _other_user(admin, clean_stack)
    try:
        foreign = refusal(fetch(stranger, body["id"]))
        missing = refusal(fetch(stranger, str(uuid.uuid4())))
        garbage = refusal(fetch(stranger, "not-a-media-id"))
        own_missing = refusal(fetch(board_user, str(uuid.uuid4())))
    finally:
        stranger.close()
    assert foreign[0] in REFUSED
    assert foreign == missing == own_missing, (foreign, missing, own_missing)
    assert garbage[0] in REFUSED | {422}
    assert body["id"] not in garbage[1]


def test_arch_media_deleted_board_refused(board_user: Client, clean_stack: str) -> None:
    board = create_board(board_user, unique_title())
    body = uploaded(board_user, board["id"], png())
    assert delete_board(board_user, board["id"]).status_code in (200, 204)
    assert fetch(board_user, body["id"]).status_code in REFUSED


# --- Лимит MAX_UPLOAD_BYTES -----------------------------------------------------


def test_img01_upload_over_limit_rejected_and_not_stored(board_user: Client, board: dict[str, str]) -> None:
    limit = max_upload_bytes()
    resp = upload(board_user, board["id"], padded_png(limit + 1))
    assert resp.status_code == 413, (resp.status_code, resp.text[:200])
    assert _media_dir_listing(board["id"]) == []


def test_img01_upload_exactly_limit_accepted(board_user: Client, board: dict[str, str]) -> None:
    limit = max_upload_bytes()
    body = uploaded(board_user, board["id"], padded_png(limit))
    assert body["size"] == limit


def test_img01_upload_over_limit_chunked_without_length_rejected(board_user: Client, board: dict[str, str]) -> None:
    limit = max_upload_bytes()
    chunk = b"\x00" * (1 << 20)

    def stream():  # тело без Content-Length (Transfer-Encoding: chunked)
        yield png()
        sent = 0
        while sent <= limit:
            yield chunk
            sent += len(chunk)

    resp = board_user.http.post(
        f"/api/boards/{board['id']}/media",
        params={"name": "big.png"},
        content=stream(),
        headers={"Content-Type": "image/png"},
        timeout=120.0,
    )
    assert resp.status_code == 413, (resp.status_code, resp.text[:200])
    assert _media_dir_listing(board["id"]) == []


# --- Проверка типа и подмена Content-Type -----------------------------------------


@pytest.mark.parametrize("mime", ["text/html", "application/javascript", "application/xhtml+xml", "text/xml", "application/octet-stream", "image/x-icon; foo=text/html", "text/html; charset=image/png"])
def test_img01_non_image_type_rejected(board_user: Client, board: dict[str, str], mime: str) -> None:
    resp = upload(board_user, board["id"], HTML_PAYLOAD, mime, "x.html")
    assert resp.status_code == 415, (mime, resp.status_code, resp.text)


def test_img01_missing_content_type_rejected(board_user: Client, board: dict[str, str]) -> None:
    resp = upload(board_user, board["id"], HTML_PAYLOAD, None, "x.html")
    assert resp.status_code in (400, 415, 422), (resp.status_code, resp.text)


@pytest.mark.parametrize("mime", ["image/png", "image/gif", "IMAGE/PNG", "image/png; charset=utf-8"])
def test_img01_spoofed_image_type_never_served_as_html(board_user: Client, board: dict[str, str], mime: str) -> None:
    """HTML под видом картинки: либо отказ, либо выдача без исполнения (тип картинки, nosniff, CSP)."""
    resp = upload(board_user, board["id"], HTML_PAYLOAD, mime, "evil.html")
    if resp.status_code != 201:
        assert resp.status_code in (400, 415, 422), (resp.status_code, resp.text)
        return
    got = fetch(board_user, resp.json()["id"])
    ctype = got.headers["content-type"].lower()
    assert "html" not in ctype and "xml" not in ctype and ctype.startswith("image/"), ctype
    assert got.headers.get("x-content-type-options", "").lower() == "nosniff"
    csp = got.headers.get("content-security-policy", "").lower()
    assert "sandbox" in csp or re.search(r"script-src\s+'none'|default-src\s+'none'", csp), csp


def test_img01_name_path_traversal_does_not_escape_board_dir(board_user: Client, board: dict[str, str]) -> None:
    body = uploaded(board_user, board["id"], png(), name="../../../../etc/qa-traversal.png")
    assert _media_dir_listing(board["id"]) == [body["id"]]
    probe = subprocess.run(
        ["docker", "exec", "myboard-qa-api-1", "sh", "-c", "ls /etc/qa-traversal.png \"$MEDIA_ROOT\"/../qa-traversal.png 2>/dev/null || true"],
        capture_output=True,
        text=True,
        check=True,
    )
    assert probe.stdout.strip() == ""


# --- IMG-07 и заголовки выдачи --------------------------------------------------


def test_img07_svg_served_with_script_blocking_headers(board_user: Client, board: dict[str, str]) -> None:
    body = uploaded(board_user, board["id"], SVG_WITH_SCRIPT, "image/svg+xml", "evil.svg")
    got = fetch(board_user, body["id"])
    assert got.status_code == 200
    assert got.headers["content-type"].split(";")[0].strip() == "image/svg+xml"
    csp = [c.lower() for c in got.headers.get_list("content-security-policy")]
    assert csp, dict(got.headers)
    # Любая из политик (их пересечение) должна запрещать скрипты.
    assert any("sandbox" in c or "default-src 'none'" in c or "script-src 'none'" in c for c in csp), csp
    assert got.headers.get("x-content-type-options", "").lower() == "nosniff"


def test_arch_media_response_denies_framing(board_user: Client, board: dict[str, str]) -> None:
    body = uploaded(board_user, board["id"], png())
    got = fetch(board_user, body["id"])
    assert _frame_denied(got), dict(got.headers)
    refused = fetch(board_user, str(uuid.uuid4()))
    assert _frame_denied(refused), dict(refused.headers)


@pytest.mark.parametrize("path", ["/", "/login", "/admin/login", "/admin/users", "/templates", "/boards/x", "/b/x", "/api/health", "/api/session"])
def test_arch_frame_pages_deny_framing_after_caddy_change(client: Client, path: str) -> None:
    """Caddy ставит CSP только при отсутствии своей — запрет фрейма не должен ослабнуть."""
    resp = client.http.get(path)
    assert resp.headers.get("x-frame-options", "").upper() == "DENY", (path, dict(resp.headers))
    csps = resp.headers.get_list("content-security-policy")
    assert csps, (path, dict(resp.headers))
    for csp in csps:
        match = re.search(r"frame-ancestors([^;]*)", csp, re.IGNORECASE)
        assert match and set(match.group(1).split()) <= {"'none'", "'self'"}, (path, csp)


def test_arch_frame_embed_still_allows_framing(board_user: Client, board: dict[str, str], client: Client) -> None:
    token = link(board_user, board["id"])["token"]
    resp = client.http.get(f"/b/{token}/embed")
    assert resp.status_code == 200
    assert "x-frame-options" not in resp.headers, dict(resp.headers)
    assert not any("frame-ancestors" in c.lower() for c in resp.headers.get_list("content-security-policy"))
