"""history: снимки документа доски и лента действий (основа COL-07, COL-08).

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_snapshots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("state", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["board_id"], ["boards.id"], name=op.f("fk_board_snapshots_board_id_boards")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_board_snapshots")),
    )
    op.create_index(
        "ix_board_snapshots_board_id_created_at", "board_snapshots", ["board_id", "created_at"]
    )
    op.create_table(
        "board_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("actor_name", sa.String(length=200), nullable=False),
        sa.Column("event_type", sa.String(length=64), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["board_id"], ["boards.id"], name=op.f("fk_board_events_board_id_boards")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_board_events")),
    )
    op.create_index(
        "ix_board_events_board_id_created_at", "board_events", ["board_id", "created_at"]
    )


def downgrade() -> None:
    raise NotImplementedError("Миграции только вперёд")
