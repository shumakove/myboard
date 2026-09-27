"""Применение миграций Alembic при старте процесса (ARCHITECTURE.md, раздел 11).

Миграции только вперёд: `downgrade` в ревизиях не реализуется.
"""

from pathlib import Path

from alembic import command
from alembic.config import Config

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations"


def alembic_config(database_url: str) -> Config:
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    # «%» в пароле экранируется: Config интерполирует значения как ConfigParser.
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def upgrade_to_head(database_url: str) -> None:
    """Доводит схему базы до последней ревизии; на актуальной базе ничего не делает."""
    command.upgrade(alembic_config(database_url), "head")
