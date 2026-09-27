"""Точка входа процесса: `python -m app`.

Сначала проверяет обязательные переменные окружения: без любой из них процесс
завершается с кодом 1 и именем переменной в stderr (ARCHITECTURE.md, раздел 11).
"""

import logging
import sys

import uvicorn

from app.core.settings import SettingsError, load_settings
from app.main import create_app


def main() -> None:
    try:
        settings = load_settings()
    except SettingsError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    # Журнал Alembic (применённые ревизии) виден в логах контейнера до старта Uvicorn.
    logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s %(message)s")
    uvicorn.run(
        create_app(settings),
        host="0.0.0.0",  # noqa: S104  # внутри контейнера; наружу публикует только Caddy
        port=8000,
        proxy_headers=True,
        forwarded_allow_ips="*",
    )


if __name__ == "__main__":
    main()
