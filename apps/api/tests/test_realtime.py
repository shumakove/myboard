"""Модуль realtime: синхронизация документа доски по WebSocket `/api/ws` (COL-01, SHR-04, SHR-06),
присутствие и курсоры (COL-02…COL-04, COL-09).

Клиенты эмулируются документом `pycrdt` и кадрами y-protocols (как у `yjs` в браузере).
Все «браузеры» работают через один TestClient — одно приложение и один цикл событий;
cookie каждого браузера передаются явно.
"""

import json
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pycrdt import (
    Decoder,
    Doc,
    Map,
    Text,
    YSyncMessageType,
    create_update_message,
    write_message,
)
from sqlalchemy import create_engine, text
from starlette.testclient import WebSocketTestSession
from starlette.websockets import WebSocketDisconnect

from app.core.settings import Settings
from app.realtime import router as realtime_router

ADMIN = {"email": "admin@example.com", "password": "admin-password"}
ALICE = {"name": "Alice", "email": "alice@example.com", "password": "alice-pw"}
BOB = {"name": "Bob", "email": "bob@example.com", "password": "bob-pw"}

SYNC, AWARENESS, PRESENCE = 0, 1, 2

POLICY_VIOLATION = 1008
INVALID_PAYLOAD = 1007
ACCESS_REVOKED = 4403

Cookies = dict[str, str]


def create_sync_step1_message(state: bytes) -> bytes:
    return bytes([0, YSyncMessageType.SYNC_STEP1]) + write_message(state)


def create_sync_step2_message(update: bytes) -> bytes:
    return bytes([0, YSyncMessageType.SYNC_STEP2]) + write_message(update)


def create_awareness_message(state: Any) -> bytes:
    return bytes([AWARENESS]) + write_message(json.dumps(state).encode())


def _cookie_header(cookies: Cookies) -> dict[str, str]:
    return {"cookie": "; ".join(f"{name}={value}" for name, value in cookies.items())}


def _take_cookies(client: TestClient) -> Cookies:
    """Cookie, выданные последним ответом; общий jar очищается — у каждого браузера свои."""
    cookies = dict(client.cookies.items())
    client.cookies.clear()
    return cookies


@pytest.fixture
def accounts(client: TestClient) -> None:
    assert client.post("/api/admin/login", json=ADMIN).status_code == 204
    for account in (ALICE, BOB):
        assert client.post("/api/admin/users", json=account).status_code == 201
    client.cookies.clear()


def _sign_in(client: TestClient, account: dict[str, str]) -> Cookies:
    credentials = {"email": account["email"], "password": account["password"]}
    assert client.post("/api/login", json=credentials).status_code == 204
    return _take_cookies(client)


@pytest.fixture
def alice(client: TestClient, accounts: None) -> Cookies:
    return _sign_in(client, ALICE)


@pytest.fixture
def board(client: TestClient, alice: Cookies) -> str:
    response = client.post("/api/boards", json={"title": "Sprint"}, headers=_cookie_header(alice))
    assert response.status_code == 201, response.text
    board_id: str = response.json()["id"]
    return board_id


def _share_token(client: TestClient, owner: Cookies, board_id: str) -> str:
    response = client.get(f"/api/boards/{board_id}/share", headers=_cookie_header(owner))
    assert response.status_code == 200, response.text
    token: str = response.json()["token"]
    return token


def _join(client: TestClient, token: str, name: str) -> Cookies:
    response = client.post(f"/api/share/{token}/join", json={"name": name})
    assert response.status_code == 200, response.text
    return _take_cookies(client)


@pytest.fixture
def link(client: TestClient, alice: Cookies, board: str) -> str:
    return _share_token(client, alice, board)


@pytest.fixture
def kate(client: TestClient, link: str) -> Cookies:
    """Участник по ссылке без учётной записи."""
    return _join(client, link, "Kate")


class YClient:
    """Браузер с документом доски: рукопожатие sync, правки и приём чужих правок.

    Кадры присутствия, пришедшие во время ожидания sync, складываются в `presence`
    и `awareness` по порядку прихода.
    """

    def __init__(self, websocket: WebSocketTestSession) -> None:
        self.ws = websocket
        self.doc: Doc[Any] = Doc()
        self.objects = self.doc.get("objects", type=Map)
        self.presence: list[dict[str, Any]] = []
        self.awareness: list[dict[str, Any]] = []

    def handshake(self) -> None:
        # Сервер первым присылает свой вектор версии; клиент досылает, чего у сервера нет.
        kind, server_state = self.receive()
        assert kind == YSyncMessageType.SYNC_STEP1
        self.ws.send_bytes(create_sync_step1_message(self.doc.get_state()))
        self.ws.send_bytes(create_sync_step2_message(self.doc.get_update(server_state)))
        kind, missing = self.receive()
        assert kind == YSyncMessageType.SYNC_STEP2
        self.doc.apply_update(missing)

    def receive(self) -> tuple[int, bytes]:
        """Следующий кадр sync: (подтип, байты)."""
        while True:
            frame = self.ws.receive_bytes()
            if frame[0] == SYNC:
                payload = Decoder(frame[2:]).read_message()
                assert payload is not None
                return frame[1], payload
            self._keep(frame)

    def _keep(self, frame: bytes) -> None:
        payload = Decoder(frame[1:]).read_message()
        assert payload is not None
        message: dict[str, Any] = json.loads(payload)
        if frame[0] == PRESENCE:
            self.presence.append(message)
        else:
            assert frame[0] == AWARENESS
            self.awareness.append(message)

    def next_presence(self) -> dict[str, Any]:
        """Ближайший ещё не просмотренный кадр presence (ждёт, если его нет)."""
        while not self.presence:
            self._keep(self.ws.receive_bytes())
        return self.presence.pop(0)

    def next_awareness(self) -> dict[str, Any]:
        while not self.awareness:
            self._keep(self.ws.receive_bytes())
        return self.awareness.pop(0)

    def send_awareness(self, state: Any) -> None:
        self.ws.send_bytes(create_awareness_message(state))

    def receive_update(self) -> None:
        kind, update = self.receive()
        assert kind == YSyncMessageType.SYNC_UPDATE
        self.doc.apply_update(update)

    def prepare(self, change: Callable[[Doc[Any]], None]) -> bytes:
        """Правка в локальном документе; возвращает кадр, который ещё не отправлен."""
        before = self.doc.get_state()
        change(self.doc)
        return create_update_message(self.doc.get_update(before))

    def edit(self, change: Callable[[Doc[Any]], None]) -> None:
        self.ws.send_bytes(self.prepare(change))

    def flush(self) -> None:
        """Ждёт ответа на запрос вектора: всё отправленное раньше сервер уже обработал."""
        self.ws.send_bytes(create_sync_step1_message(self.doc.get_state()))
        kind, _ = self.receive()
        assert kind == YSyncMessageType.SYNC_STEP2


@contextmanager
def _connect(client: TestClient, query: str, cookies: Cookies) -> Iterator[YClient]:
    with client.websocket_connect(f"/api/ws?{query}", headers=_cookie_header(cookies)) as ws:
        peer = YClient(ws)
        peer.handshake()
        yield peer


def _refused(client: TestClient, query: str, headers: dict[str, str]) -> int:
    with (
        pytest.raises(WebSocketDisconnect) as refusal,
        client.websocket_connect(f"/api/ws?{query}", headers=headers),
    ):
        pass
    return refusal.value.code


def _closed_with(peer: YClient) -> int:
    with pytest.raises(WebSocketDisconnect) as closed:
        while True:
            peer.ws.receive_bytes()
    return closed.value.code


def _snapshot(doc: Doc[Any]) -> dict[str, Any]:
    return doc.get("objects", type=Map).to_py() or {}


def _sql(settings: Settings, sql: str, **params: Any) -> Any:
    engine = create_engine(settings.database_url)
    try:
        with engine.connect() as connection:
            return connection.execute(text(sql), params).scalar()
    finally:
        engine.dispose()


def _add_sticker(doc: Doc[Any]) -> None:
    doc.get("objects", type=Map)["s1"] = Map({"type": "sticker", "x": 0, "text": Text("Hello")})


def _sticker(doc: Doc[Any]) -> Map[Any]:
    sticker: Map[Any] = doc.get("objects", type=Map)["s1"]
    return sticker


# --- COL-01: правки всех участников без блокировок --------------------------------------


def test_col01_owner_and_participant_edit_same_object_and_text_at_once(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        owner.edit(_add_sticker)
        guest.receive_update()

        def owner_change(doc: Doc[Any]) -> None:
            _sticker(doc)["x"] = 120
            note: Text = _sticker(doc)["text"]
            note.insert(len(note), " world")

        def guest_change(doc: Doc[Any]) -> None:
            _sticker(doc)["color"] = "yellow"
            _sticker(doc)["text"].insert(0, "Hi! ")

        # Обе правки сделаны от одного состояния, до получения чужой.
        owner_frame, guest_frame = owner.prepare(owner_change), guest.prepare(guest_change)
        owner.ws.send_bytes(owner_frame)
        guest.ws.send_bytes(guest_frame)
        owner.receive_update()
        guest.receive_update()

        expected = {"type": "sticker", "x": 120, "color": "yellow", "text": "Hi! Hello world"}
        assert _snapshot(owner.doc) == {"s1": expected}
        assert _snapshot(guest.doc) == {"s1": expected}


def test_col01_late_client_receives_current_state(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        owner.edit(_add_sticker)
        owner.flush()
        with _connect(client, f"token={link}", kate) as late:
            assert _snapshot(late.doc) == _snapshot(owner.doc)


def test_col01_state_survives_when_everyone_leaves(
    client: TestClient, alice: Cookies, board: str, settings: Settings
) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        owner.edit(_add_sticker)
        owner.flush()
        expected = _snapshot(owner.doc)
    # Документ выгружен из памяти; новое подключение собирает его из журнала.
    with _connect(client, f"board={board}", alice) as again:
        assert _snapshot(again.doc) == expected
    assert _sql(settings, "SELECT count(*) FROM board_updates WHERE board_id = :id", id=board) == 1


def test_col01_offline_edits_are_delivered_on_reconnect(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        owner.edit(_add_sticker)
        with client.websocket_connect(f"/api/ws?token={link}", headers=_cookie_header(kate)) as ws:
            guest = YClient(ws)
            guest.handshake()
        # Связи нет: участник продолжает править свою копию.
        _sticker(guest.doc)["x"] = 42

        with client.websocket_connect(f"/api/ws?token={link}", headers=_cookie_header(kate)) as ws:
            guest.ws = ws
            guest.handshake()  # STEP2 участника несёт накопленную правку
            owner.receive_update()

        assert _sticker(owner.doc)["x"] == 42


def test_col01_accepted_edit_moves_board_up_in_recent(
    client: TestClient, alice: Cookies, board: str
) -> None:
    def updated_at() -> str:
        response = client.get(f"/api/boards/{board}", headers=_cookie_header(alice))
        value: str = response.json()["updated_at"]
        return value

    created = updated_at()
    with _connect(client, f"board={board}", alice) as owner:
        assert updated_at() == created  # подключение без правок доску не меняет
        owner.edit(_add_sticker)
        owner.flush()
    assert updated_at() > created


# --- Повреждённое обновление закрывает только своё соединение ------------------------


def test_corrupted_update_closes_only_sender(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        owner.edit(_add_sticker)
        guest.receive_update()
        before = _snapshot(guest.doc)

        guest.ws.send_bytes(create_update_message(b"definitely not a yjs update"))
        assert _closed_with(guest) == INVALID_PAYLOAD

        with _connect(client, f"board={board}", alice) as late:
            assert _snapshot(late.doc) == before
            late.edit(lambda doc: _sticker(doc).__setitem__("x", 7))
            # Следующее, что получил владелец, — правка третьего клиента, а не мусор.
            owner.receive_update()
            assert _sticker(owner.doc)["x"] == 7


@pytest.mark.parametrize(
    "frame",
    [
        b"",
        b"\x05\x00\x00",  # неизвестный тип сообщения
        b"\x00\x07\x00",  # неизвестный подтип sync
        b"\x00\x02\x10abc",  # длина больше кадра
        b"\x00\x02\x02\x00\x00\xff",  # лишние байты
        b"\x00\x00\x01\xff",  # повреждённый вектор версии
        b"\x02\x02{}",  # presence шлёт только сервер
        b"\x01\x03abc",  # awareness не JSON
        b"\x01\x02[]",  # awareness не объект
        b'\x01\x0a{"x": NaN}',  # NaN — не JSON
        b"\x01\x02{}\x00",  # лишние байты после awareness
        create_awareness_message({"pad": "x" * 5000}),  # слишком большое состояние
    ],
)
def test_malformed_frame_closes_connection(
    client: TestClient, alice: Cookies, board: str, frame: bytes
) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        owner.ws.send_bytes(frame)
        assert _closed_with(owner) == INVALID_PAYLOAD


def test_text_frame_closes_connection(client: TestClient, alice: Cookies, board: str) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        owner.ws.send_text("hello")
        assert _closed_with(owner) == INVALID_PAYLOAD


# --- Доступ к каналу: владелец и участник по ссылке (SHR-04 канал, SHR-05, SHR-06) -----


def test_shr04_participant_gets_same_channel_as_owner(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"token={link}", kate) as guest,
        _connect(client, f"board={board}", alice) as owner,
    ):
        guest.edit(_add_sticker)
        owner.receive_update()
        guest.edit(lambda doc: doc.get("objects", type=Map).pop("s1"))
        owner.receive_update()
        assert _snapshot(owner.doc) == {}


def test_channel_is_refused_without_rights(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    bob = _sign_in(client, BOB)
    assert client.post("/api/admin/login", json=ADMIN).status_code == 204
    admin = _take_cookies(client)
    other = client.post("/api/boards", json={"title": "Other"}, headers=_cookie_header(alice))
    other_board = other.json()["id"]

    refusals = [
        ("", alice),  # нет доски
        (f"board={board}", {}),  # нет сессии
        (f"board={board}", bob),  # чужая доска
        (f"board={board}", admin),  # сессия администратора
        (f"board={board}", kate),  # участник не входит как владелец
        ("board=not-a-uuid", alice),
        (f"board={board}&token={link}", alice),  # ровно один способ входа
        (f"token={link}", {}),  # ссылка без имени (SHR-03)
        (f"token={link}", alice),  # сессия владельца не заменяет cookie участника
        ("token=unknown-token", kate),
        (f"board={other_board}", kate),  # cookie одной доски не открывает другую
    ]
    for query, cookies in refusals:
        assert _refused(client, query, _cookie_header(cookies)) == POLICY_VIOLATION, query


def test_deleted_board_channel_is_refused(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    assert client.delete(f"/api/boards/{board}", headers=_cookie_header(alice)).status_code == 204

    assert _refused(client, f"board={board}", _cookie_header(alice)) == POLICY_VIOLATION
    assert _refused(client, f"token={link}", _cookie_header(kate)) == POLICY_VIOLATION


def test_shr06_reset_closes_open_channel_and_refuses_old_link_and_cookie(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        reset = client.post(f"/api/boards/{board}/share/reset", headers=_cookie_header(alice))
        assert reset.status_code == 200
        new_link = reset.json()["token"]

        assert _closed_with(guest) == ACCESS_REVOKED
        # Канал владельца сброс не трогает.
        owner.edit(_add_sticker)
        owner.flush()

    assert _refused(client, f"token={link}", _cookie_header(kate)) == POLICY_VIOLATION
    assert _refused(client, f"token={new_link}", _cookie_header(kate)) == POLICY_VIOLATION
    rejoined = _join(client, new_link, "Kate")
    with _connect(client, f"token={new_link}", rejoined) as guest:
        assert "s1" in _snapshot(guest.doc)


def test_open_channel_closes_after_sign_out(
    client: TestClient, alice: Cookies, board: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(realtime_router, "ACCESS_CHECK_SECONDS", 0.05)
    with _connect(client, f"board={board}", alice) as owner:
        assert client.post("/api/logout", headers=_cookie_header(alice)).status_code == 204
        assert _closed_with(owner) == ACCESS_REVOKED


def test_foreign_page_cannot_open_channel(client: TestClient, alice: Cookies, board: str) -> None:
    headers = _cookie_header(alice) | {"origin": "http://evil.example"}
    assert _refused(client, f"board={board}", headers) == POLICY_VIOLATION

    same_origin = _cookie_header(alice) | {"origin": "http://testserver"}
    with client.websocket_connect(f"/api/ws?board={board}", headers=same_origin) as ws:
        YClient(ws).handshake()


# --- Присутствие и курсоры (COL-02…COL-04, COL-09) -----------------------------------


def _names(presence: dict[str, Any]) -> list[str]:
    return sorted(peer["name"] for peer in presence["peers"])


def test_col09_everyone_on_board_is_listed_until_they_leave(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        alone = owner.next_presence()
        assert alone["peers"] == [{"peer": alone["self"], "name": "Alice"}]

        # Каждый вход и выход — один новый список у каждого присутствующего.
        with _connect(client, f"token={link}", kate) as guest:
            seen_by_guest = guest.next_presence()
            seen_by_owner = owner.next_presence()
            assert _names(seen_by_guest) == _names(seen_by_owner) == ["Alice", "Kate"]
            # Каждый узнаёт свой id в списке, у всех один и тот же список.
            assert seen_by_guest["peers"] == seen_by_owner["peers"]
            assert seen_by_guest["self"] != seen_by_owner["self"]

        # Отключение — участник пропадает из списка у оставшихся.
        assert owner.next_presence()["peers"] == [{"peer": alone["self"], "name": "Alice"}]


def test_col02_cursor_and_name_reach_other_participant(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        kate_id = guest.next_presence()["self"]
        state = {"cursor": {"x": 120.5, "y": -40}, "camera": {"x": 0, "y": 0, "zoom": 1}}
        guest.send_awareness(state)

        assert owner.next_awareness() == {"peer": kate_id, "name": "Kate", "state": state}

        # Курсор владельца тоже виден участнику; своё состояние отправителю не возвращается.
        owner.send_awareness({"cursor": {"x": 1, "y": 2}})
        received = guest.next_awareness()
        assert received["name"] == "Alice"
        assert received["state"] == {"cursor": {"x": 1, "y": 2}}
        guest.flush()
        owner.flush()
        assert guest.awareness == []
        assert owner.awareness == []


def test_col02_name_comes_from_session_not_from_client(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        guest.send_awareness({"name": "Alice", "cursor": {"x": 0, "y": 0}})
        assert owner.next_awareness()["name"] == "Kate"


def test_col02_late_participant_sees_current_cursors(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with _connect(client, f"board={board}", alice) as owner:
        owner_id = owner.next_presence()["self"]
        owner.send_awareness({"cursor": {"x": 5, "y": 6}})
        owner.flush()
        with _connect(client, f"token={link}", kate) as late:
            assert late.next_awareness() == {
                "peer": owner_id,
                "name": "Alice",
                "state": {"cursor": {"x": 5, "y": 6}},
            }


def test_col04_followed_participant_camera_reaches_follower(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        kate_id = guest.next_presence()["self"]
        owner_id = owner.next_presence()["self"]
        # Владелец следит за участником; каждое перемещение вида участника доходит до него.
        owner.send_awareness({"following": kate_id})
        assert guest.next_awareness()["state"] == {"following": kate_id}
        for x in (100, 250):
            guest.send_awareness({"camera": {"x": x, "y": 10, "zoom": 2}})
            message = owner.next_awareness()
            assert message["peer"] == kate_id
            assert message["state"]["camera"] == {"x": x, "y": 10, "zoom": 2}
        owner.send_awareness({"following": None})
        assert guest.next_awareness() == {
            "peer": owner_id,
            "name": "Alice",
            "state": {"following": None},
        }


def test_presence_stays_out_of_document_and_journal(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies, settings: Settings
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        guest.send_awareness({"cursor": {"x": 1, "y": 1}, "following": None})
        owner.next_awareness()
        owner.flush()
        assert (
            _sql(settings, "SELECT count(*) FROM board_updates WHERE board_id = :id", id=board) == 0
        )
        with _connect(client, f"board={board}", alice) as late:
            assert late.doc.get_update() == Doc().get_update()


def test_presence_does_not_leak_to_other_boards(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    other = client.post("/api/boards", json={"title": "Other"}, headers=_cookie_header(alice))
    other_board = other.json()["id"]
    with (
        _connect(client, f"board={other_board}", alice) as elsewhere,
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        guest.send_awareness({"cursor": {"x": 3, "y": 3}})
        owner.next_awareness()
        elsewhere.flush()
        assert elsewhere.awareness == []
        assert _names(elsewhere.next_presence()) == ["Alice"]
        assert elsewhere.presence == []


def test_participant_closed_by_link_reset_leaves_presence(
    client: TestClient, alice: Cookies, board: str, link: str, kate: Cookies
) -> None:
    with (
        _connect(client, f"board={board}", alice) as owner,
        _connect(client, f"token={link}", kate) as guest,
    ):
        owner.next_presence()  # пока один
        assert _names(owner.next_presence()) == ["Alice", "Kate"]
        client.post(f"/api/boards/{board}/share/reset", headers=_cookie_header(alice))
        assert _closed_with(guest) == ACCESS_REVOKED
        assert _names(owner.next_presence()) == ["Alice"]
