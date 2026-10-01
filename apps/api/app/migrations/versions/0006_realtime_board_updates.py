"""realtime: журнал обновлений документа доски (COL-01).

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-01
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_updates",
        sa.Column("board_id", sa.Uuid(), nullable=False),
        sa.Column("seq", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("update", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["board_id"], ["boards.id"], name=op.f("fk_board_updates_board_id_boards")
        ),
        sa.PrimaryKeyConstraint("board_id", "seq", name=op.f("pk_board_updates")),
    )


def downgrade() -> None:
    raise NotImplementedError("Миграции только вперёд")
