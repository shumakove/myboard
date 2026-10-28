"""Загрузка и выдача файлов досок (IMG-01, IMG-07; раздел 8 архитектуры).

Файл лежит в `MEDIA_ROOT/{board_id}/{media_id}`; в базу пишутся ключ, исходное имя,
MIME и размер. Сервер проверяет объявленный тип и отклоняет файл больше
`MAX_UPLOAD_BYTES`, не дочитывая его.
"""

import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import anyio
from sqlalchemy.ext.asyncio import AsyncSession

from app.media.models import NAME_MAX_LENGTH, Media

# IMG-01, IMG-06, IMG-07: изображения, которые показывает браузер, включая GIF и SVG.
# Файлы, PDF, видео и аудио добавляет T7.2 (FIL-*).
ALLOWED_TYPES = frozenset({"image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"})

DEFAULT_NAME = "file"


class UnsupportedTypeError(Exception):
    """Объявленный тип файла не принимается."""


class TooLargeError(Exception):
    """Файл больше `MAX_UPLOAD_BYTES`."""


def declared_type(content_type: str | None) -> str:
    """MIME из заголовка `Content-Type` без параметров; чужой тип — `UnsupportedTypeError`."""
    mime = (content_type or "").split(";", 1)[0].strip().lower()
    if mime not in ALLOWED_TYPES:
        raise UnsupportedTypeError(mime)
    return mime


def clean_name(name: str | None) -> str:
    """Исходное имя без пути и управляющих символов, не длиннее столбца."""
    base = (name or "").replace("\\", "/").rsplit("/", 1)[-1]
    printable = "".join(ch for ch in base if ch.isprintable()).strip()
    return printable[:NAME_MAX_LENGTH] or DEFAULT_NAME


def file_path(media_root: str, media: Media) -> Path:
    return Path(media_root) / media.storage_key


async def save(
    db: AsyncSession,
    *,
    media_root: str,
    max_bytes: int,
    board_id: uuid.UUID,
    name: str,
    mime: str,
    chunks: AsyncIterator[bytes],
) -> Media:
    """Пишет поток на диск и строку в базу; больше `max_bytes` — `TooLargeError`, файла нет."""
    media_id = uuid.uuid4()
    key = f"{board_id}/{media_id}"
    target = anyio.Path(media_root) / key
    # Недописанный файл не виден под своим ключом: переименование — после проверки размера.
    partial = target.with_name(f"{media_id}.part")
    await target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    try:
        async with await anyio.open_file(partial, "wb") as out:
            async for chunk in chunks:
                size += len(chunk)
                if size > max_bytes:
                    raise TooLargeError
                await out.write(chunk)
        await partial.rename(target)
    finally:
        await partial.unlink(missing_ok=True)
    media = Media(
        id=media_id,
        board_id=board_id,
        storage_key=key,
        original_name=name,
        mime=mime,
        byte_size=size,
    )
    db.add(media)
    await db.commit()
    return media


async def get(db: AsyncSession, media_id: uuid.UUID) -> Media | None:
    return await db.get(Media, media_id)
