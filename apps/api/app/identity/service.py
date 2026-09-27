"""Операции над учётными записями: первый администратор, вход, пользователи досок."""

import uuid

from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.identity.models import Admin, SubjectType, User
from app.identity.passwords import hash_password, verify_password
from app.identity.schemas import UserCreate, UserUpdate, normalize_email
from app.identity.sessions import delete_subject_sessions


class EmailTakenError(Exception):
    """Почта уже занята другой учётной записью (ADM-07)."""


async def ensure_first_admin(
    factory: async_sessionmaker[AsyncSession], email: str, password: str
) -> None:
    """Создаёт администратора из ADMIN_EMAIL/ADMIN_PASSWORD, только если таблица `admins` пуста."""
    async with factory() as db:
        if await db.scalar(select(exists().select_from(Admin))):
            return
        db.add(Admin(email=normalize_email(email), password_hash=await hash_password(password)))
        await db.commit()


async def authenticate_admin(db: AsyncSession, email: str, password: str) -> Admin | None:
    """Администратор с этой почтой и паролем; учётки пользователей досок не подходят (ADM-01)."""
    admin = await db.scalar(select(Admin).where(Admin.email == normalize_email(email)))
    if not await verify_password(admin.password_hash if admin else None, password):
        return None
    return admin


async def authenticate_user(db: AsyncSession, email: str, password: str) -> User | None:
    """ACC-01/ACC-02: включённый пользователь досок с этой почтой и паролем, иначе `None`.

    Пароль проверяется и у отключённой учётки: время отказа одинаково для всех причин.
    """
    user = await db.scalar(select(User).where(User.email == normalize_email(email)))
    if not await verify_password(user.password_hash if user else None, password):
        return None
    if user is None or user.disabled:
        return None
    return user


async def active_user(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    """Пользователь сессии, если учётка есть и не отключена (ADM-05)."""
    user = await db.get(User, user_id)
    return user if user is not None and not user.disabled else None


async def list_users(db: AsyncSession) -> list[User]:
    """Все пользователи досок в порядке создания (ADM-02)."""
    return list(await db.scalars(select(User).order_by(User.created_at, User.id)))


async def create_user(db: AsyncSession, data: UserCreate) -> User:
    """ADM-03; повтор почты отклоняет уникальное ограничение базы (ADM-07)."""
    user = User(name=data.name, email=data.email, password_hash=await hash_password(data.password))
    db.add(user)
    await _commit_unique_email(db, user)
    return user


async def update_user(db: AsyncSession, user_id: uuid.UUID, data: UserUpdate) -> User | None:
    """ADM-04 (имя, почта, пароль), ADM-05/ADM-06 (отключение и включение)."""
    user = await db.get(User, user_id)
    if user is None:
        return None
    if data.name is not None:
        user.name = data.name
    if data.email is not None:
        user.email = data.email
    if data.password is not None:
        user.password_hash = await hash_password(data.password)
    if data.disabled is not None:
        user.disabled = data.disabled
        if data.disabled:
            # Отключённый пользователь теряет и открытые сессии; доски остаются (ADM-05).
            await delete_subject_sessions(db, SubjectType.USER, user.id)
    await _commit_unique_email(db, user)
    return user


async def _commit_unique_email(db: AsyncSession, user: User) -> None:
    """Фиксирует изменения учётки; нарушение уникальности почты → `EmailTakenError`."""
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "uq_users_email" in str(exc.orig):
            raise EmailTakenError from exc
        raise
    await db.refresh(user)  # created_at и прочие значения по умолчанию из базы
