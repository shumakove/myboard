"""Приёмка T7.1, BUG-028 · копирование файлов на другую доску (CVS-20, SHR-04, SHR-05, SHR-06).

`POST /api/boards/{board_id}/media/copies` с телом `{"media": [id, …]}` — адрес и форма из handoff.
Сценарии — docs/qa/reports/T7.1.md (дополнение к проверке 2, зафиксировано до чтения handoff).
Только HTTP по PUBLIC_BASE_URL; docker exec — подготовка файла на диске и наблюдение MEDIA_ROOT.
"""

from __future__ import annotations

import os
import subprocess
import uuid
from collections.abc import Iterator

import httpx
import pytest

from admin_helpers import create_user, patch_user
from board_helpers import create_board, delete_board, unique_title
from media_helpers import SVG_WITH_SCRIPT, fetch, max_upload_bytes, padded_png, png, refusal, uploaded
from share_helpers import GUEST_COOKIE_PREFIX, join, link, reset
from stand import Client
from user_helpers import user_login


def _copies(one: Client, board_id: str, media: object) -> httpx.Response:
    return one.http.post(f"/api/boards/{board_id}/media/copies", json={"media": media}, timeout=120.0)


def _copied(one: Client, board_id: str, media: list[str]) -> dict[str, str]:
    resp = _copies(one, board_id, media)
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return resp.json()["copies"]


def _exec(script: str) -> str:
    out = subprocess.run(["docker", "exec", os.environ.get("QA_COMPOSE_PROJECT", "myboard-qa") + "-api-1", "sh", "-c", script], check=True, capture_output=True, text=True)
    return out.stdout


def _board_files(board_id: str) -> list[str]:
    uuid.UUID(board_id)
    return [line for line in _exec(f'ls -1 "$MEDIA_ROOT/{board_id}" 2>/dev/null || true').splitlines() if line.strip()]


def _storage_file(board_id: str, media_id: str) -> str:
    uuid.UUID(board_id)
    uuid.UUID(media_id)
    return f'"$MEDIA_ROOT/{board_id}/{media_id}"'


@pytest.fixture
def people(admin: Client, clean_stack: str) -> Iterator[dict[str, Client]]:
    """Владелец A и B, посторонний пользователь с доской C и свободные клиенты."""
    made: list[Client] = []

    def user() -> Client:
        account = create_user(admin)
        one = Client("user", clean_stack)
        made.append(one)
        resp = user_login(one, account["email"], account["_password"])
        assert resp.status_code == 204, (resp.status_code, resp.text)
        return one

    group = {"owner": user(), "stranger": user()}
    for name in ("guest", "guest2"):
        group[name] = Client(name, clean_stack)
        made.append(group[name])
    yield group
    for one in made:
        one.http.close()


@pytest.fixture
def boards(people: dict[str, Client]) -> dict[str, dict[str, str]]:
    return {
        "a": create_board(people["owner"], unique_title("QA A")),
        "b": create_board(people["owner"], unique_title("QA B")),
        "c": create_board(people["stranger"], unique_title("QA C")),
    }


def _guest_cookie(board_id: str) -> str:
    return f"{GUEST_COOKIE_PREFIX}{uuid.UUID(board_id).hex}"


def _join(one: Client, owner: Client, board_id: str) -> str:
    token = link(owner, board_id)["token"]
    resp = join(one, token, "QA Guest")
    assert resp.status_code == 200, (resp.status_code, resp.text)
    return token


# --- BUG-028: файл становится файлом целевой доски ---------------------------------


def test_cvs20_shr04_copy_is_file_of_target_board_seen_by_its_participant(people, boards) -> None:
    owner, guest = people["owner"], people["guest"]
    data = png(9, 5, (10, 20, 30, 255))
    source = uploaded(owner, boards["a"]["id"], data, name="photo.png")
    _join(guest, owner, boards["b"]["id"])

    copied = _copied(owner, boards["b"]["id"], [source["id"]])

    copy_id = copied[source["id"]]
    assert copy_id != source["id"]
    assert copy_id in _board_files(boards["b"]["id"])
    got = fetch(guest, copy_id)
    assert got.status_code == 200 and got.content == data
    assert got.headers["content-type"].split(";")[0].strip() == "image/png"
    assert fetch(guest, source["id"]).status_code == 404, "исходный файл участнику B не открывается"


def test_cvs20_copy_survives_deletion_of_source_and_source_survives_deletion_of_target(people, boards) -> None:
    owner = people["owner"]
    data = png(4, 4, (1, 200, 3, 255))
    source = uploaded(owner, boards["a"]["id"], data)
    copy_id = _copied(owner, boards["b"]["id"], [source["id"]])[source["id"]]
    assert delete_board(owner, boards["a"]["id"]).status_code < 300
    assert fetch(owner, copy_id).content == data

    other = create_board(owner, unique_title("QA D"))
    second = uploaded(owner, other["id"], data)
    second_copy = _copied(owner, boards["b"]["id"], [second["id"]])[second["id"]]
    assert delete_board(owner, boards["b"]["id"]).status_code < 300
    assert fetch(owner, second["id"]).content == data
    assert fetch(owner, second_copy).status_code == 404


def test_cvs20_several_files_from_several_boards_and_duplicates(people, boards) -> None:
    owner = people["owner"]
    third = create_board(owner, unique_title("QA D"))
    one = uploaded(owner, boards["a"]["id"], png(2, 2, (1, 1, 1, 255)))
    two = uploaded(owner, boards["a"]["id"], png(2, 2, (2, 2, 2, 255)))
    three = uploaded(owner, third["id"], png(2, 2, (3, 3, 3, 255)))

    copied = _copied(owner, boards["b"]["id"], [one["id"], two["id"], one["id"], three["id"], three["id"]])

    assert set(copied) == {one["id"], two["id"], three["id"]}
    assert len(set(copied.values())) == 3
    assert sorted(_board_files(boards["b"]["id"])) == sorted(copied.values())


def test_cvs20_same_board_file_is_not_duplicated(people, boards) -> None:
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    assert _copied(owner, boards["a"]["id"], [source["id"]]) == {source["id"]: source["id"]}
    assert _board_files(boards["a"]["id"]) == [source["id"]]


def test_cvs20_copy_of_a_copy_on_third_board(people, boards) -> None:
    owner = people["owner"]
    third = create_board(owner, unique_title("QA D"))
    data = png(3, 2)
    source = uploaded(owner, boards["a"]["id"], data)
    first = _copied(owner, boards["b"]["id"], [source["id"]])[source["id"]]
    second = _copied(owner, third["id"], [first])[first]
    assert fetch(owner, second).content == data


def test_cvs20_shr04_participant_of_both_boards_copies(people, boards) -> None:
    owner, guest, watcher = people["owner"], people["guest"], people["guest2"]
    data = png(6, 6, (9, 9, 9, 255))
    source = uploaded(owner, boards["a"]["id"], data)
    _join(guest, owner, boards["a"]["id"])
    _join(guest, owner, boards["b"]["id"])
    _join(watcher, owner, boards["b"]["id"])

    copy_id = _copied(guest, boards["b"]["id"], [source["id"]])[source["id"]]

    assert fetch(watcher, copy_id).content == data
    assert fetch(owner, copy_id).content == data


# --- Доступ: чужой файл не копируется и неотличим от несуществующего ----------------


def test_cvs20_participant_of_target_only_gets_nothing_like_for_missing_file(people, boards) -> None:
    owner, guest = people["owner"], people["guest"]
    source = uploaded(owner, boards["a"]["id"], png())
    _join(guest, owner, boards["b"]["id"])

    foreign = _copies(guest, boards["b"]["id"], [source["id"]])
    missing = _copies(guest, boards["b"]["id"], [str(uuid.uuid4())])

    assert foreign.status_code == 200
    assert refusal(foreign) == refusal(missing) == (200, '{"copies":{}}')
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_participant_of_source_only_cannot_copy_to_other_board(people, boards) -> None:
    owner, guest = people["owner"], people["guest"]
    source = uploaded(owner, boards["a"]["id"], png())
    _join(guest, owner, boards["a"]["id"])

    target = _copies(guest, boards["b"]["id"], [source["id"]])
    absent = _copies(guest, str(uuid.uuid4()), [source["id"]])

    assert target.status_code == 404
    assert refusal(target) == refusal(absent)
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_other_user_cannot_pull_foreign_file_to_own_board(people, boards) -> None:
    owner, stranger = people["owner"], people["stranger"]
    source = uploaded(owner, boards["a"]["id"], png())

    foreign = _copies(stranger, boards["c"]["id"], [source["id"]])
    missing = _copies(stranger, boards["c"]["id"], [str(uuid.uuid4())])

    assert refusal(foreign) == refusal(missing) == (200, '{"copies":{}}')
    assert _board_files(boards["c"]["id"]) == []


def test_cvs20_other_user_cannot_push_to_foreign_board(people, boards) -> None:
    stranger = people["stranger"]
    source = uploaded(stranger, boards["c"]["id"], png())

    foreign = _copies(stranger, boards["b"]["id"], [source["id"]])
    absent = _copies(stranger, str(uuid.uuid4()), [source["id"]])

    assert foreign.status_code == 404
    assert refusal(foreign) == refusal(absent)
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_no_session_refused_same_as_missing_board(client: Client, people, boards) -> None:
    source = uploaded(people["owner"], boards["a"]["id"], png())
    real = _copies(client, boards["b"]["id"], [source["id"]])
    absent = _copies(client, str(uuid.uuid4()), [source["id"]])
    assert real.status_code == 404
    assert refusal(real) == refusal(absent)
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_admin_session_is_not_board_session(admin: Client, people, boards) -> None:
    source = uploaded(people["owner"], boards["a"]["id"], png())
    assert _copies(admin, boards["b"]["id"], [source["id"]]).status_code == 404
    assert _board_files(boards["b"]["id"]) == []


def test_shr06_old_source_cookie_after_reset_does_not_copy(people, boards) -> None:
    owner, guest = people["owner"], people["guest"]
    source = uploaded(owner, boards["a"]["id"], png())
    _join(guest, owner, boards["a"]["id"])
    _join(guest, owner, boards["b"]["id"])
    assert _copied(guest, boards["b"]["id"], [source["id"]]), "до сброса файл копируется"
    before = _board_files(boards["b"]["id"])

    assert reset(owner, boards["a"]["id"]).status_code < 300

    assert _copied(guest, boards["b"]["id"], [source["id"]]) == {}
    assert _board_files(boards["b"]["id"]) == before


def test_shr06_old_target_cookie_after_reset_refused(people, boards) -> None:
    owner, guest = people["owner"], people["guest"]
    source = uploaded(owner, boards["a"]["id"], png())
    _join(guest, owner, boards["a"]["id"])
    _join(guest, owner, boards["b"]["id"])
    assert reset(owner, boards["b"]["id"]).status_code < 300
    resp = _copies(guest, boards["b"]["id"], [source["id"]])
    assert refusal(resp) == refusal(_copies(guest, str(uuid.uuid4()), [source["id"]]))
    assert resp.status_code == 404


def test_cvs20_session_of_one_board_under_cookie_name_of_another_gives_nothing(people, boards) -> None:
    """Подмена имени cookie: сессия участника B не становится сессией A."""
    owner, guest = people["owner"], people["guest"]
    source = uploaded(owner, boards["a"]["id"], png())
    _join(guest, owner, boards["b"]["id"])
    session = guest.http.cookies.get(_guest_cookie(boards["b"]["id"]))
    assert session
    guest.http.cookies.set(_guest_cookie(boards["a"]["id"]), session)
    assert _copied(guest, boards["b"]["id"], [source["id"]]) == {}

    forged = people["guest2"]
    forged.http.cookies.set(_guest_cookie(boards["c"]["id"]), session)
    assert _copies(forged, boards["c"]["id"], [source["id"]]).status_code == 404


def test_cvs20_garbage_source_cookie_gives_nothing(people, boards) -> None:
    owner, guest = people["owner"], people["guest"]
    source = uploaded(owner, boards["a"]["id"], png())
    _join(guest, owner, boards["b"]["id"])
    guest.http.cookies.set(_guest_cookie(boards["a"]["id"]), "garbage-session-value")
    assert _copied(guest, boards["b"]["id"], [source["id"]]) == {}


def test_cvs20_deleted_source_participant_refused_owner_allowed_stranger_refused(people, boards) -> None:
    """Участник удалённой доски файла не получает; владелец забирает свой файл на свою живую доску."""
    owner, guest, stranger = people["owner"], people["guest"], people["stranger"]
    data = png(7, 7)
    source = uploaded(owner, boards["a"]["id"], data)
    _join(guest, owner, boards["a"]["id"])
    _join(guest, owner, boards["b"]["id"])
    assert delete_board(owner, boards["a"]["id"]).status_code < 300

    assert _copied(guest, boards["b"]["id"], [source["id"]]) == {}
    assert _copied(stranger, boards["c"]["id"], [source["id"]]) == {}
    assert fetch(owner, source["id"]).status_code == 404, "файл удалённой доски напрямую не отдаётся"

    copy_id = _copied(owner, boards["b"]["id"], [source["id"]])[source["id"]]
    assert fetch(owner, copy_id).content == data
    assert fetch(guest, copy_id).content == data


def test_cvs20_deactivated_owner_cannot_copy_from_deleted_board(admin: Client, clean_stack: str) -> None:
    """Право владельца на доску в корзине держится на живой сессии пользователя."""
    account = create_user(admin)
    owner = Client("owner", clean_stack)
    try:
        assert user_login(owner, account["email"], account["_password"]).status_code == 204
        a = create_board(owner, unique_title("QA A"))
        b = create_board(owner, unique_title("QA B"))
        source = uploaded(owner, a["id"], png())
        assert delete_board(owner, a["id"]).status_code < 300
        assert patch_user(admin, account["id"], disabled=True).status_code == 200
        assert _copies(owner, b["id"], [source["id"]]).status_code == 404
    finally:
        owner.http.close()


def test_cvs20_deleted_target_refused_even_for_owner(people, boards) -> None:
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    assert delete_board(owner, boards["b"]["id"]).status_code < 300
    assert _copies(owner, boards["b"]["id"], [source["id"]]).status_code == 404


def test_cvs20_response_reveals_no_board_or_storage_path(people, boards) -> None:
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    resp = _copies(owner, boards["b"]["id"], [source["id"]])
    assert boards["a"]["id"] not in resp.text
    assert "/data" not in resp.text and "storage" not in resp.text
    assert set(resp.json()) == {"copies"}


# --- Некорректные запросы и лимиты --------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        {"media": "not-a-list"},
        {"media": None},
        {"media": [None]},
        {"media": ["../../etc/passwd"]},
        {"media": ["x" * 5000]},
        {"media": [1]},
        {"media": [{"id": "x"}]},
        {},
        [],
        "text",
    ],
)
def test_cvs20_malformed_body_is_client_error(people, boards, body: object) -> None:
    resp = people["owner"].http.post(f"/api/boards/{boards['b']['id']}/media/copies", json=body)
    assert 400 <= resp.status_code < 500, (body, resp.status_code, resp.text)
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_empty_list_copies_nothing(people, boards) -> None:
    assert _copied(people["owner"], boards["b"]["id"], []) == {}


def test_cvs20_not_uuid_board_is_client_error(people) -> None:
    resp = _copies(people["owner"], "not-a-board", [])
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)


def test_cvs20_too_many_ids_refused_before_any_copy(people, boards) -> None:
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    resp = _copies(owner, boards["b"]["id"], [source["id"]] + [str(uuid.uuid4()) for _ in range(5000)])
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text[:200])
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_many_missing_ids_answered_without_error(people, boards) -> None:
    resp = _copies(people["owner"], boards["b"]["id"], [str(uuid.uuid4()) for _ in range(5000)])
    assert resp.status_code == 200, (resp.status_code, resp.text[:200])
    assert resp.json() == {"copies": {}}


def test_cvs20_huge_body_without_session_is_not_server_error(client: Client, boards) -> None:
    resp = client.http.post(
        f"/api/boards/{boards['b']['id']}/media/copies",
        content=b'{"media":["' + b"a" * (8 * 1024 * 1024) + b'"]}',
        headers={"Content-Type": "application/json"},
        timeout=60.0,
    )
    assert 400 <= resp.status_code < 500, resp.status_code


def test_cvs20_cross_site_simple_request_does_not_copy(people, boards) -> None:
    """Простой межсайтовый запрос без предварительной проверки: text/plain с JSON в теле."""
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    resp = owner.http.post(
        f"/api/boards/{boards['b']['id']}/media/copies",
        content='{"media":["%s"]}' % source["id"],
        headers={"Content-Type": "text/plain", "Origin": "http://evil.example"},
    )
    assert 400 <= resp.status_code < 500, (resp.status_code, resp.text)
    assert _board_files(boards["b"]["id"]) == []


def test_cvs20_file_exactly_at_limit_is_copied(people, boards) -> None:
    owner = people["owner"]
    limit = max_upload_bytes()
    data = padded_png(limit)
    source = uploaded(owner, boards["a"]["id"], data)
    copy_id = _copied(owner, boards["b"]["id"], [source["id"]])[source["id"]]
    assert owner.http.get(f"/api/media/{copy_id}", timeout=120.0).content == data


def test_cvs20_file_over_limit_on_disk_is_not_copied_and_leaves_nothing(people, boards) -> None:
    """Файл стал больше лимита (лимит снижен после загрузки): копия не создаётся, мусора нет."""
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    good = uploaded(owner, boards["a"]["id"], png(2, 2))
    limit = max_upload_bytes()
    _exec(f"truncate -s {limit + 1} {_storage_file(boards['a']['id'], source['id'])}")

    copied = _copied(owner, boards["b"]["id"], [source["id"], good["id"]])

    assert set(copied) == {good["id"]}, "остальные файлы копии не теряются"
    assert _board_files(boards["b"]["id"]) == [copied[good["id"]]]


def test_cvs20_file_missing_on_disk_is_not_copied_and_leaves_nothing(people, boards) -> None:
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], png())
    good = uploaded(owner, boards["a"]["id"], png(2, 2))
    _exec(f"rm {_storage_file(boards['a']['id'], source['id'])}")

    copied = _copied(owner, boards["b"]["id"], [source["id"], good["id"]])

    assert set(copied) == {good["id"]}
    assert _board_files(boards["b"]["id"]) == [copied[good["id"]]]


# --- Копия отдаётся так же безопасно, как исходный файл -----------------------------


def test_img07_svg_copy_keeps_type_and_script_blocking_headers(people, boards) -> None:
    owner = people["owner"]
    source = uploaded(owner, boards["a"]["id"], SVG_WITH_SCRIPT, "image/svg+xml", "x.svg")
    copy_id = _copied(owner, boards["b"]["id"], [source["id"]])[source["id"]]

    original, copy = fetch(owner, source["id"]), fetch(owner, copy_id)

    assert copy.content == SVG_WITH_SCRIPT
    assert copy.headers["content-type"] == original.headers["content-type"]
    csp = copy.headers.get("content-security-policy", "")
    assert "sandbox" in csp and "frame-ancestors 'none'" in csp, csp
    assert copy.headers.get("x-content-type-options") == "nosniff"
    assert copy.headers.get("x-frame-options", "").upper() == "DENY"
