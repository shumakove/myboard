"""sharing: ссылка на доску и сессии участников по ссылке (SHR-01…SHR-03, SHR-05, SHR-06).

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("boards", sa.Column("share_token", sa.String(length=64), nullable=True))
    op.add_column(
        "boards", sa.Column("share_token_revoked_at", sa.DateTime(timezone=True), nullable=True)
    )
    op.create_unique_constraint(op.f("uq_boards_share_token"), "boards", ["share_token"])

    op.add_column("sessions", sa.Column("board_id", sa.Uuid(), nullable=True))
    op.add_column("sessions", sa.Column("display_name", sa.String(length=200), nullable=True))
    op.create_foreign_key(
        op.f("fk_sessions_board_id_boards"), "sessions", "boards", ["board_id"], ["id"]
    )
    op.create_index(op.f("ix_sessions_board_id"), "sessions", ["board_id"])


def downgrade() -> None:
    raise NotImplementedError("Миграции только вперёд")
