"""HTTP-маршруты административной панели: вход администратора и учётные записи (ADM-01…ADM-07)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status

from app.core.db import SessionDep
from app.core.settings import Settings
from app.identity import service
from app.identity.models import Admin, SubjectType, User
from app.identity.rate_limit import LoginRateLimiter
from app.identity.schemas import AdminSession, Credentials, UserCreate, UserOut, UserUpdate
from app.identity.sessions import (
    ADMIN_COOKIE,
    clear_session_cookie,
    create_session,
    delete_session,
    find_subject,
    set_session_cookie,
)

router = APIRouter(prefix="/admin", tags=["admin"])

# Одинаково скупой отказ для неизвестной почты, неверного пароля и учётки не администратора.
LOGIN_FAILED = "Invalid email or password"
TOO_MANY_ATTEMPTS = "Too many sign-in attempts, try again later"
NOT_SIGNED_IN = "Sign in as administrator"
EMAIL_TAKEN = "Email is already in use"
USER_NOT_FOUND = "User not found"

AdminCookie = Annotated[str | None, Cookie(alias=ADMIN_COOKIE, include_in_schema=False)]


def _settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def _limiter(request: Request) -> LoginRateLimiter:
    limiter: LoginRateLimiter = request.app.state.admin_login_limiter
    return limiter


def _client_address(request: Request) -> str:
    # Адрес клиента из X-Forwarded-For, который выставляет Caddy (uvicorn proxy_headers).
    return request.client.host if request.client else "unknown"


async def _signed_in_admin(db: SessionDep, token: AdminCookie = None) -> Admin | None:
    admin_id = await find_subject(db, token, SubjectType.ADMIN)
    return await db.get(Admin, admin_id) if admin_id else None


async def require_admin(admin: Annotated[Admin | None, Depends(_signed_in_admin)]) -> Admin:
    """Зависимость маршрутов панели: без сессии администратора — 401."""
    if admin is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_SIGNED_IN)
    return admin


AdminDep = Annotated[Admin, Depends(require_admin)]


@router.post(
    "/login",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"description": LOGIN_FAILED}, 429: {"description": TOO_MANY_ATTEMPTS}},
)
async def login(credentials: Credentials, request: Request, db: SessionDep) -> Response:
    """ADM-01: вход в панель отдельной учётной записью администратора."""
    limiter, address = _limiter(request), _client_address(request)
    retry_after = limiter.retry_after(address)
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            TOO_MANY_ATTEMPTS,
            headers={"Retry-After": str(retry_after)},
        )
    admin = await service.authenticate_admin(db, credentials.email, credentials.password)
    if admin is None:
        limiter.record_failure(address)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_FAILED)
    token = await create_session(db, SubjectType.ADMIN, admin.id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    set_session_cookie(response, ADMIN_COOKIE, token, _settings(request))
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: SessionDep, token: AdminCookie = None) -> Response:
    await delete_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, ADMIN_COOKIE, _settings(request))
    return response


@router.get("/session")
async def get_session(
    admin: Annotated[Admin | None, Depends(_signed_in_admin)],
) -> AdminSession:
    """Вошёл ли браузер в панель. Отвечает 200 и без сессии — интерфейс решает, что показать."""
    return AdminSession(authenticated=admin is not None, email=admin.email if admin else None)


@router.get("/users")
async def list_users(_: AdminDep, db: SessionDep) -> list[UserOut]:
    """ADM-02: список учётных записей пользователей досок."""
    return [UserOut.model_validate(user) for user in await service.list_users(db)]


@router.post(
    "/users",
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": EMAIL_TAKEN}},
)
async def create_user(data: UserCreate, _: AdminDep, db: SessionDep) -> UserOut:
    """ADM-03: новая учётка с именем, почтой и паролем; ADM-07: почта не повторяется."""
    try:
        user = await service.create_user(db, data)
    except service.EmailTakenError:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN) from None
    return UserOut.model_validate(user)


@router.patch(
    "/users/{user_id}",
    responses={404: {"description": USER_NOT_FOUND}, 409: {"description": EMAIL_TAKEN}},
)
async def update_user(user_id: uuid.UUID, data: UserUpdate, _: AdminDep, db: SessionDep) -> UserOut:
    """ADM-04: имя, почта, пароль; ADM-05/ADM-06: `disabled` отключает и включает учётку."""
    try:
        user: User | None = await service.update_user(db, user_id, data)
    except service.EmailTakenError:
        raise HTTPException(status.HTTP_409_CONFLICT, EMAIL_TAKEN) from None
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, USER_NOT_FOUND)
    return UserOut.model_validate(user)
