"""HTTP-маршруты модуля media (IMG-01, IMG-07, FIL-01…FIL-04; раздел 8 архитектуры).

- `POST /api/boards/{board_id}/media?name=…` — тело запроса — сам файл, `Content-Type` —
  его объявленный тип. Загружают владелец и участник по ссылке этой доски. С `kind=file` —
  ярлык файла любого типа (FIL-01): тип `application/octet-stream`.
- `POST /api/boards/{board_id}/media/copies` — копии файлов других досок на эту доску (CVS-20).
- `POST /api/boards/{board_id}/link-preview` — название и изображение страницы для карточки
  ссылки (EMB-02); изображение становится файлом этой доски.
- `GET /api/media/{media_id}` — файл, только при сессии его доски; поддерживает `Range`
  (перемотка, FIL-03, FIL-04). С `download=<имя>` — скачивание под этим именем (FIL-01).

Без права на доску оба маршрута отвечают одинаковым 404: существует ли доска или файл,
наружу не сообщается.
"""

import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal

import anyio
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from starlette.requests import ClientDisconnect

from app.core.db import SessionDep
from app.identity.http import settings_of
from app.media import link_preview, service
from app.media.access import can_copy_from, can_use_board
from app.media.models import NAME_MAX_LENGTH, Media
from app.media.schemas import (
    LinkPreviewIn,
    LinkPreviewOut,
    MediaCopiesOut,
    MediaCopyIn,
    MediaOut,
)

router = APIRouter(tags=["media"])

NOT_FOUND = "Not found"
UNSUPPORTED = "This file type is not supported"
TOO_LARGE = "The file is too large"
PREVIEW_IMAGE_NAME = "link-preview"

# Сколько байт сервер готов принять ради ответа 413 (BUG-029). Тело длиннее не читается:
# соединение оборвётся, и браузер покажет ошибку сети вместо размера.
REFUSED_BODY_MAX_BYTES = 4 * 1024**3

# Тело запроса — двоичный файл: его схема OpenAPI описывается вручную.
_UPLOAD_BODY: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            mime: {"schema": {"type": "string", "format": "binary"}}
            for mime in sorted(service.ALLOWED_TYPES | {service.GENERIC_TYPE})
        },
    }
}

_FILE_HEADERS = {
    # Файл в браузере — только данные: SVG не исполняет скрипты, даже открытый напрямую.
    "Content-Security-Policy": (
        "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    # Право могут отозвать (SHR-06): браузер переспрашивает сервер, прежде чем взять копию.
    "Cache-Control": "private, no-cache",
}


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)


def _too_large() -> HTTPException:
    return HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)


def _media_out(media: Media) -> MediaOut:
    return MediaOut(
        id=media.id,
        name=media.original_name,
        mime=media.mime,
        size=media.byte_size,
        url=f"/api/media/{media.id}",
    )


async def _discard(chunks: AsyncIterator[bytes]) -> None:
    """BUG-029: дочитать тело отклонённой загрузки, ничего не сохраняя.

    Браузер не увидит ответ, пока отправляет файл: соединение, закрытое раньше конца тела,
    `fetch` считает ошибкой сети.
    """
    received = 0
    try:
        async for chunk in chunks:
            received += len(chunk)
            if received > REFUSED_BODY_MAX_BYTES:
                return
    except ClientDisconnect:
        return


@router.post(
    "/boards/{board_id}/media",
    status_code=status.HTTP_201_CREATED,
    openapi_extra=_UPLOAD_BODY,
    responses={
        404: {"description": NOT_FOUND},
        413: {"description": TOO_LARGE},
        415: {"description": UNSUPPORTED},
    },
)
async def upload_media(
    board_id: uuid.UUID,
    request: Request,
    db: SessionDep,
    name: Annotated[str, Query(max_length=NAME_MAX_LENGTH * 4)] = "",
    kind: Literal["file"] | None = None,
) -> MediaOut:
    """IMG-01, IMG-07, FIL-01…FIL-04: файл на доску; ответ — id и адрес файла."""
    if not await can_use_board(db, board_id, request.cookies):
        raise _not_found()
    try:
        mime = service.declared_type(request.headers.get("content-type"), generic=kind == "file")
    except service.UnsupportedTypeError:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, UNSUPPORTED) from None
    settings = settings_of(request)
    chunks = request.stream()
    # Объявленная длина больше лимита — на диск ничего не пишется.
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > settings.max_upload_bytes:
        if int(length) <= REFUSED_BODY_MAX_BYTES:
            await _discard(chunks)
        raise _too_large()
    try:
        media = await service.save(
            db,
            media_root=settings.media_root,
            max_bytes=settings.max_upload_bytes,
            board_id=board_id,
            name=service.clean_name(name),
            mime=mime,
            chunks=chunks,
        )
    except service.TooLargeError:
        await _discard(chunks)
        raise _too_large() from None
    return _media_out(media)


@router.post("/boards/{board_id}/media/copies", responses={404: {"description": NOT_FOUND}})
async def copy_media(
    board_id: uuid.UUID, body: MediaCopyIn, request: Request, db: SessionDep
) -> MediaCopiesOut:
    """CVS-20: вставка на другую доску — файл становится файлом этой доски (BUG-028).

    Файл без права на его доску неотличим от несуществующего: в ответе его просто нет.
    """
    if not await can_use_board(db, board_id, request.cookies):
        raise _not_found()
    settings = settings_of(request)
    readable: dict[uuid.UUID, bool] = {}
    copies: dict[uuid.UUID, uuid.UUID] = {}
    for media_id in dict.fromkeys(body.media):
        source = await service.get(db, media_id)
        if source is None:
            continue
        if source.board_id == board_id:
            copies[media_id] = media_id
            continue
        if source.board_id not in readable:
            readable[source.board_id] = await can_copy_from(db, source.board_id, request.cookies)
        if not readable[source.board_id]:
            continue
        copy = await service.copy_to_board(
            db,
            source,
            media_root=settings.media_root,
            max_bytes=settings.max_upload_bytes,
            board_id=board_id,
        )
        if copy is not None:
            copies[media_id] = copy.id
    return MediaCopiesOut(copies=copies)


@router.post("/boards/{board_id}/link-preview", responses={404: {"description": NOT_FOUND}})
async def preview_link(
    board_id: uuid.UUID, body: LinkPreviewIn, request: Request, db: SessionDep
) -> LinkPreviewOut:
    """EMB-02: название и изображение страницы; страница недоступна или закрыта — `null`.

    Ответ не различает недоступную и внутреннюю страницу: маршрут не сканирует сеть.
    """
    if not await can_use_board(db, board_id, request.cookies):
        raise _not_found()
    # Соединение с базой не держится, пока идёт внешний запрос.
    await db.rollback()
    settings = settings_of(request)
    url = str(body.url)
    preview = await link_preview.read_preview(
        url, settings.link_preview_hosts, settings.max_upload_bytes
    )
    image = None
    if preview.image is not None:
        image = _media_out(
            await service.save_bytes(
                db,
                media_root=settings.media_root,
                board_id=board_id,
                name=PREVIEW_IMAGE_NAME,
                mime=preview.image.mime,
                body=preview.image.body,
            )
        )
    return LinkPreviewOut(url=url, title=preview.title, image=image)


@router.get(
    "/media/{media_id}",
    response_class=FileResponse,
    responses={
        200: {"content": {"application/octet-stream": {}}},
        404: {"description": NOT_FOUND},
    },
)
async def get_media(
    media_id: uuid.UUID,
    request: Request,
    db: SessionDep,
    download: Annotated[str | None, Query(max_length=NAME_MAX_LENGTH * 4)] = None,
) -> FileResponse:
    """Файл доски — только владельцу и участнику по действующей ссылке этой доски.

    FIL-01: `download` — имя ярлыка на доске; файл скачивается под ним, а не показывается.
    """
    media = await service.get(db, media_id)
    if media is None or not await can_use_board(db, media.board_id, request.cookies):
        raise _not_found()
    path = service.file_path(settings_of(request).media_root, media)
    if not await anyio.Path(path).is_file():
        raise _not_found()
    return FileResponse(
        path,
        media_type=media.mime,
        filename=media.original_name if download is None else service.clean_name(download),
        content_disposition_type="inline" if download is None else "attachment",
        headers=_FILE_HEADERS,
    )
