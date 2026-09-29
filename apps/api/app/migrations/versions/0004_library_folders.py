"""library: папки и избранное (BRD-07, BRD-09…BRD-11).

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-29
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "folders",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("parent_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], name=op.f("fk_folders_owner_id_users")),
        sa.ForeignKeyConstraint(
            ["parent_id"], ["folders.id"], name=op.f("fk_folders_parent_id_folders")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_folders")),
    )
    op.create_index(op.f("ix_folders_owner_id"), "folders", ["owner_id"])

    op.add_column("boards", sa.Column("folder_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        op.f("fk_boards_folder_id_folders"), "boards", "folders", ["folder_id"], ["id"]
    )
    op.create_index(op.f("ix_boards_folder_id"), "boards", ["folder_id"])

    op.create_table(
        "favorites",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "target_type IN ('board', 'folder')", name=op.f("ck_favorites_target_type")
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_favorites_user_id_users")),
        sa.PrimaryKeyConstraint("user_id", "target_type", "target_id", name=op.f("pk_favorites")),
    )


def downgrade() -> None:
    raise NotImplementedError("Миграции только вперёд")
