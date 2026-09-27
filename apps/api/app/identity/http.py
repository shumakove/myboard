"""Общие части маршрутов входа: настройки, адрес клиента, лимит попыток, скупые отказы."""

from fastapi import HTTPException, Request, status

from app.core.settings import Settings
from app.identity.rate_limit import LoginRateLimiter

# Одинаково скупой отказ для неизвестной почты, неверного пароля, отключённой учётки
# и учётки не того вида (ARCHITECTURE.md, раздел 12).
LOGIN_FAILED = "Invalid email or password"
TOO_MANY_ATTEMPTS = "Too many sign-in attempts, try again later"


def settings_of(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def client_address(request: Request) -> str:
    # Адрес клиента из X-Forwarded-For, который выставляет Caddy (uvicorn proxy_headers).
    return request.client.host if request.client else "unknown"


def ensure_attempt_allowed(limiter: LoginRateLimiter, address: str) -> None:
    """429 с `Retry-After`, пока у адреса исчерпан лимит неудачных попыток."""
    retry_after = limiter.retry_after(address)
    if retry_after is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            TOO_MANY_ATTEMPTS,
            headers={"Retry-After": str(retry_after)},
        )


def login_failed(limiter: LoginRateLimiter, address: str) -> HTTPException:
    """Учитывает неудачную попытку и возвращает одинаковый для всех причин отказ 401."""
    limiter.record_failure(address)
    return HTTPException(status.HTTP_401_UNAUTHORIZED, LOGIN_FAILED)
