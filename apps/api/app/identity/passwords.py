"""Хэши паролей Argon2id (ARCHITECTURE.md, раздел 5).

Проверка выполняется в пуле потоков: Argon2 намеренно долгий и блокировал бы цикл событий.
"""

import anyio.to_thread
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()  # по умолчанию Argon2id

# Хэш для проверки, когда учётки с такой почтой нет: время ответа не выдаёт, есть ли она.
_DUMMY_HASH = _hasher.hash("dummy password")


async def hash_password(password: str) -> str:
    return await anyio.to_thread.run_sync(_hasher.hash, password)


def _verify(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerificationError, InvalidHashError):
        return False


async def verify_password(password_hash: str | None, password: str) -> bool:
    """Верен ли пароль; при отсутствии учётки (`None`) тратит то же время и возвращает False."""
    if password_hash is None:
        await anyio.to_thread.run_sync(_verify, _DUMMY_HASH, password)
        return False
    return await anyio.to_thread.run_sync(_verify, password_hash, password)
