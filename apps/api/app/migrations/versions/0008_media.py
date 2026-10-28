"""media: файлы досок (IMG-*, FIL-*; ARCHITECTURE.md, разделы 7, 8).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-28
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("storage_key", sa.String(length=80), nullable=False),
        sa.Column("original_name", sa.String(length=255), nullable=False),
        sa.Column("mime", sa.String(length=127), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["board_id"], ["boards.id"], name=op.f("fk_media_board_id_boards")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_media")),
    )
    op.create_index(op.f("ix_media_board_id"), "media", ["board_id"])


def downgrade() -> None:
    raise NotImplementedError("Миграции только вперёд")
