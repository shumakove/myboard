"""Настройки процесса из переменных окружения (ARCHITECTURE.md, раздел 11).

Без любой обязательной переменной процесс не стартует: `load_settings` бросает
`SettingsError` с именами переменных.
"""

from typing import Annotated

from pydantic import Field, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

NonEmpty = Annotated[str, Field(min_length=1)]


class Settings(BaseSettings):
    """Переменные окружения; имя поля в верхнем регистре — имя переменной.

    Все обязательны, кроме полей со значением по умолчанию.
    """

    model_config = SettingsConfigDict(case_sensitive=False, frozen=True, str_strip_whitespace=True)

    public_base_url: NonEmpty
    secret_key: NonEmpty
    database_url: NonEmpty
    media_root: NonEmpty
    admin_email: NonEmpty
    admin_password: NonEmpty
    max_upload_bytes: Annotated[int, Field(gt=0)]
    # Как часто открытая доска с правками пишет снимок и сжимает журнал (T4.3).
    snapshot_interval_seconds: Annotated[float, Field(gt=0)] = 300.0

    @field_validator("public_base_url")
    @classmethod
    def _http_base_url(cls, value: str) -> str:
        # Из адреса собираются ссылки на доски; схема определяет флаг Secure у cookie.
        if not value.startswith(("http://", "https://")):
            raise ValueError("must start with http:// or https://")
        return value.rstrip("/")

    @property
    def secure_cookies(self) -> bool:
        """Cookie получают флаг Secure только при HTTPS-адресе (ARCHITECTURE.md, раздел 5)."""
        return self.public_base_url.startswith("https://")


class SettingsError(Exception):
    """Настройки неполны или некорректны; сообщение перечисляет переменные окружения."""


def load_settings() -> Settings:
    """Читает настройки из окружения или бросает `SettingsError` с именами переменных."""
    try:
        return Settings()  # значения приходят из окружения
    except ValidationError as exc:
        problems = []
        for error in exc.errors():
            name = str(error["loc"][0]).upper()
            # Пустое значение приравнивается к отсутствующему.
            value = error.get("input")
            missing = error["type"] == "missing" or (isinstance(value, str) and not value.strip())
            reason = "is required" if missing else error["msg"]
            problems.append(f"{name}: {reason}")
        raise SettingsError(
            "Invalid environment configuration:\n  " + "\n  ".join(problems)
        ) from None
