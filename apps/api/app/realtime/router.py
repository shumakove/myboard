"""WebSocket `/api/ws` — канал документа доски (COL-01; канал для SHR-04).

Подключение: `/api/ws?board={id}` — владелец с сессией пользователя досок,
`/api/ws?token={token}` — участник по ссылке с cookie этой доски. Без права на доску
рукопожатие отклоняется (HTTP 403), причина не сообщается.
"""

import asyncio
from urllib.parse import urlsplit

from fastapi import APIRouter, WebSocket
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.realtime.access import AccessRequest, authorize
from app.realtime.hub import ACCESS_REVOKED, Hub, hub_of
from app.realtime.protocol import ProtocolError, SyncKind, SyncMessage, decode, encode_sync
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
    peer = Peer(websocket, guest=access.guest)
    room = await hub.join(access.board_id, peer)
    watcher = asyncio.create_task(_watch_access(peer, request, factory))
    try:
        # Вектор версии сервера: клиент в ответ досылает правки, которых нет у сервера.
        await peer.send(encode_sync(SyncKind.STEP1, room.state_vector()))
        await _receive(websocket, peer, room, hub)
    finally:
        watcher.cancel()
        await hub.leave(room, peer)


def _same_origin(websocket: WebSocket) -> bool:
    """Браузер присылает Origin: чужая страница не откроет канал с cookie участника.

    Клиент без Origin — не браузер, чужие cookie ему недоступны.
    """
    origin = websocket.headers.get("origin")
    return origin is None or urlsplit(origin).netloc == websocket.headers.get("host")


async def _receive(websocket: WebSocket, peer: Peer, room: BoardRoom, hub: Hub) -> None:
    while not peer.closed:
        message = await websocket.receive()
        if message["type"] == "websocket.disconnect" or peer.closed:
            return
        frame = message.get("bytes")
        try:
            if frame is None:
                raise ProtocolError("text frames are not accepted")
            await _handle(decode(frame), peer, room, hub)
        except ProtocolError:
            # Повреждённое обновление закрывает только это соединение.
            await peer.close(INVALID_PAYLOAD)
            return


async def _handle(message: SyncMessage, peer: Peer, room: BoardRoom, hub: Hub) -> None:
    if message.kind is SyncKind.STEP1:
        await peer.send(encode_sync(SyncKind.STEP2, room.missing_since(message.payload)))
    else:
        await room.apply(message.payload, peer, hub.persist)


async def _watch_access(
    peer: Peer, request: AccessRequest, factory: async_sessionmaker[AsyncSession]
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
            return
