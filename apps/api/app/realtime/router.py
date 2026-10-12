"""WebSocket `/api/ws` — канал документа доски (COL-01; канал для SHR-04) и присутствия
(COL-02…COL-04, COL-09).

Подключение: `/api/ws?board={id}` — владелец с сессией пользователя досок,
`/api/ws?token={token}` — участник по ссылке с cookie этой доски. Без права на доску
рукопожатие отклоняется (HTTP 403), причина не сообщается.
"""

import asyncio
from urllib.parse import urlsplit

import anyio
from fastapi import APIRouter, WebSocket
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.realtime.access import AccessRequest, authorize
from app.realtime.hub import ACCESS_REVOKED, Hub, hub_of
from app.realtime.inbox import Closed, Inbox, is_update
from app.realtime.protocol import (
    AwarenessMessage,
    ClientMessage,
    ProtocolError,
    SyncKind,
    decode,
    encode_sync,
)
from app.realtime.room import BoardRoom, Peer

router = APIRouter(tags=["realtime"])

# Как часто открытое соединение перепроверяет доступ: выход, смена пароля, отключение
# учётки, удаление доски закрывают канал не позже чем через этот срок.
ACCESS_CHECK_SECONDS = 5.0

# Коды закрытия WebSocket (RFC 6455).
POLICY_VIOLATION = 1008
INVALID_PAYLOAD = 1007


@router.websocket("/ws")
async def board_socket(
    websocket: WebSocket, board: str | None = None, token: str | None = None
) -> None:
    factory: async_sessionmaker[AsyncSession] = websocket.app.state.session_factory
    request = AccessRequest(board=board, token=token, cookies=dict(websocket.cookies))
    access = None
    if _same_origin(websocket):
        async with factory() as db:
            access = await authorize(db, request)
    if access is None:
        # Закрытие до accept — отказ рукопожатия с HTTP 403.
        await websocket.close(POLICY_VIOLATION)
        return

    await websocket.accept()
    hub = hub_of(websocket)
    peer = Peer(websocket, name=access.name, guest=access.guest)
    room = await hub.join(access.board_id, peer)
    watcher = asyncio.create_task(_watch_access(peer, room, request, factory))
    try:
        # Вектор версии сервера: клиент в ответ досылает правки, которых нет у сервера.
        await peer.send(encode_sync(SyncKind.STEP1, room.state_vector()))
        await room.announce(peer)
        await _receive(websocket, peer, room, hub)
    finally:
        watcher.cancel()
        # Выход доводится до конца, даже если задачу соединения отменили: иначе доска
        # не выгрузится и не сожмётся.
        with anyio.CancelScope(shield=True):
            await hub.leave(room, peer)
            await room.announce_leave()


def _same_origin(websocket: WebSocket) -> bool:
    """Браузер присылает Origin: чужая страница не откроет канал с cookie участника.

    Клиент без Origin — не браузер, чужие cookie ему недоступны.
    """
    origin = websocket.headers.get("origin")
    return origin is None or urlsplit(origin).netloc == websocket.headers.get("host")


async def _receive(websocket: WebSocket, peer: Peer, room: BoardRoom, hub: Hub) -> None:
    """Кадры применяются по порядку прихода; сокет вычитывает отдельная задача (BUG-018)."""
    inbox = Inbox()
    reader = asyncio.create_task(_read(websocket, inbox))
    try:
        while not peer.closed:
            item = await inbox.get()
            if isinstance(item, Closed):
                if item.corrupted:
                    await peer.close(INVALID_PAYLOAD)
                return
            try:
                await _handle(item, inbox, peer, room, hub)
            except ProtocolError:
                # Повреждённое обновление закрывает только это соединение.
                await peer.close(INVALID_PAYLOAD)
                return
    finally:
        reader.cancel()


async def _read(websocket: WebSocket, inbox: Inbox) -> None:
    """Забирает кадры из сокета сразу по приходу, не дожидаясь их применения.

    Поток всегда завершается элементом `Closed`, даже если чтение прервалось ошибкой.
    """
    corrupted = False
    try:
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect":
                return
            frame = message.get("bytes")
            if frame is None:
                raise ProtocolError("text frames are not accepted")
            inbox.put(decode(frame))
    except ProtocolError:
        corrupted = True
    finally:
        inbox.put(Closed(corrupted))


async def _handle(
    message: ClientMessage, inbox: Inbox, peer: Peer, room: BoardRoom, hub: Hub
) -> None:
    if is_update(message):
        # Накопившиеся подряд правки применяются и пишутся в журнал одной транзакцией:
        # под нагрузкой сервер догоняет клиента, а не отстаёт на запись за правку.
        await room.apply([message.payload, *inbox.take_updates()], peer, hub.persist)
    elif isinstance(message, AwarenessMessage):
        await room.update_awareness(peer, message.state)
    else:
        await peer.send(encode_sync(SyncKind.STEP2, room.missing_since(message.payload)))


async def _watch_access(
    peer: Peer,
    room: BoardRoom,
    request: AccessRequest,
    factory: async_sessionmaker[AsyncSession],
) -> None:
    while True:
        await asyncio.sleep(ACCESS_CHECK_SECONDS)
        try:
            async with factory() as db:
                allowed = await authorize(db, request) is not None
        except SQLAlchemyError:
            continue  # база недоступна — это не отзыв доступа
        if not allowed:
            await peer.close(ACCESS_REVOKED)
            await room.announce_leave()
            return
