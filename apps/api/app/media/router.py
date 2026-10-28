"""HTTP-маршруты модуля media (IMG-01, IMG-07; раздел 8 архитектуры).

- `POST /api/boards/{board_id}/media?name=…` — тело запроса — сам файл, `Content-Type` —
  его объявленный тип. Загружают владелец и участник по ссылке этой доски.
- `GET /api/media/{media_id}` — файл, только при сессии его доски.

Без права на доску оба маршрута отвечают одинаковым 404: существует ли доска или файл,
наружу не сообщается.
"""

import uuid
from typing import Annotated, Any

import anyio
from fastapi import APIRouter, HTTPException, Query, Request, status
from fastapi.responses import FileResponse

from app.core.db import SessionDep
from app.identity.http import settings_of
from app.media import service
from app.media.access import can_use_board
from app.media.models import NAME_MAX_LENGTH
from app.media.schemas import MediaOut

router = APIRouter(tags=["media"])

NOT_FOUND = "Not found"
UNSUPPORTED = "This file type is not supported"
TOO_LARGE = "The file is too large"

# Тело запроса — двоичный файл: его схема OpenAPI описывается вручную.
_UPLOAD_BODY: dict[str, Any] = {
    "requestBody": {
        "required": True,
        "content": {
            mime: {"schema": {"type": "string", "format": "binary"}}
            for mime in sorted(service.ALLOWED_TYPES)
        },
    }
}

_FILE_HEADERS = {
    # Файл в браузере — только данные: SVG не исполняет скрипты, даже открытый напрямую.
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
    # Право могут отозвать (SHR-06): браузер переспрашивает сервер, прежде чем взять копию.
    "Cache-Control": "private, no-cache",
}


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, NOT_FOUND)


def _too_large() -> HTTPException:
    return HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, TOO_LARGE)


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
) -> MediaOut:
    """IMG-01, IMG-07: изображение на доску; ответ — id и адрес файла."""
    if not await can_use_board(db, board_id, request.cookies):
        raise _not_found()
    try:
        mime = service.declared_type(request.headers.get("content-type"))
    except service.UnsupportedTypeError:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, UNSUPPORTED) from None
    settings = settings_of(request)
    # Объявленная длина больше лимита — отказ, не читая тело.
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > settings.max_upload_bytes:
        raise _too_large()
    try:
        media = await service.save(
            db,
            media_root=settings.media_root,
            max_bytes=settings.max_upload_bytes,
            board_id=board_id,
            name=service.clean_name(name),
            mime=mime,
            chunks=request.stream(),
        )
    except service.TooLargeError:
        raise _too_large() from None
    return MediaOut(
        id=media.id,
        name=media.original_name,
        mime=media.mime,
        size=media.byte_size,
        url=f"/api/media/{media.id}",
    )


@router.get(
    "/media/{media_id}",
    response_class=FileResponse,
    responses={
        200: {"content": {"application/octet-stream": {}}},
        404: {"description": NOT_FOUND},
    },
)
async def get_media(media_id: uuid.UUID, request: Request, db: SessionDep) -> FileResponse:
    """Файл доски — только владельцу и участнику по действующей ссылке этой доски."""
    media = await service.get(db, media_id)
    if media is None or not await can_use_board(db, media.board_id, request.cookies):
        raise _not_found()
    path = service.file_path(settings_of(request).media_root, media)
    if not await anyio.Path(path).is_file():
        raise _not_found()
    return FileResponse(
        path,
        media_type=media.mime,
        filename=media.original_name,
        content_disposition_type="inline",
        headers=_FILE_HEADERS,
    )
