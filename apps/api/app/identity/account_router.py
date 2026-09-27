"""HTTP-маршруты входа пользователя досок (ACC-01…ACC-03)."""

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status

from app.core.db import SessionDep
from app.identity import service
from app.identity.http import (
    LOGIN_FAILED,
    TOO_MANY_ATTEMPTS,
    client_address,
    ensure_attempt_allowed,
    login_failed,
    settings_of,
)
from app.identity.models import SubjectType, User
from app.identity.rate_limit import LoginRateLimiter
from app.identity.schemas import AccountSession, Credentials
from app.identity.sessions import (
    USER_COOKIE,
    USER_COOKIE_MAX_AGE,
    clear_session_cookie,
    create_session,
    delete_session,
    find_subject,
    set_session_cookie,
)

router = APIRouter(tags=["account"])

NOT_SIGNED_IN = "Sign in"

UserCookie = Annotated[str | None, Cookie(alias=USER_COOKIE, include_in_schema=False)]


def _limiter(request: Request) -> LoginRateLimiter:
    limiter: LoginRateLimiter = request.app.state.user_login_limiter
    return limiter


async def _signed_in_user(db: SessionDep, token: UserCookie = None) -> User | None:
    user_id = await find_subject(db, token, SubjectType.USER)
    return await service.active_user(db, user_id) if user_id else None


async def require_user(user: Annotated[User | None, Depends(_signed_in_user)]) -> User:
    """Зависимость маршрутов пользователя досок: без живой сессии — 401."""
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_SIGNED_IN)
    return user


UserDep = Annotated[User, Depends(require_user)]


def _keep_session_cookie(response: Response, request: Request, token: str) -> None:
    # ACC-03: cookie переживает закрытие браузера.
    set_session_cookie(
        response, USER_COOKIE, token, settings_of(request), max_age=USER_COOKIE_MAX_AGE
    )


@router.post(
    "/login",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={401: {"description": LOGIN_FAILED}, 429: {"description": TOO_MANY_ATTEMPTS}},
)
async def login(credentials: Credentials, request: Request, db: SessionDep) -> Response:
    """ACC-01: вход по почте и паролю, заданным администратором.

    ACC-02: неизвестная почта, неверный пароль и отключённая учётка дают один и тот же 401.
    """
    limiter, address = _limiter(request), client_address(request)
    ensure_attempt_allowed(limiter, address)
    user = await service.authenticate_user(db, credentials.email, credentials.password)
    if user is None:
        raise login_failed(limiter, address)
    token = await create_session(db, SubjectType.USER, user.id)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    _keep_session_cookie(response, request, token)
    return response


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(request: Request, db: SessionDep, token: UserCookie = None) -> Response:
    """ACC-03: выход отзывает сессию; скопированная cookie больше не действует."""
    await delete_session(db, token)
    response = Response(status_code=status.HTTP_204_NO_CONTENT)
    clear_session_cookie(response, USER_COOKIE, settings_of(request))
    return response


@router.get("/session")
async def get_session(
    request: Request,
    response: Response,
    user: Annotated[User | None, Depends(_signed_in_user)],
    token: UserCookie = None,
) -> AccountSession:
    """Вошёл ли браузер. Отвечает 200 и без сессии; живую сессию продлевает (ACC-03)."""
    if user is None or token is None:
        return AccountSession(authenticated=False, name=None, email=None)
    _keep_session_cookie(response, request, token)
    return AccountSession(authenticated=True, name=user.name, email=user.email)
