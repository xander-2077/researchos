"""task start_date and task_dependencies (Gantt)

Revision ID: 0003
Revises: 0002
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("start_date", sa.Date(), nullable=True))
    op.create_table(
        "task_dependencies",
        sa.Column("task_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("depends_on_id", sa.Integer(), sa.ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_index("ix_task_dependencies_depends_on_id", "task_dependencies", ["depends_on_id"])


def downgrade() -> None:
    op.drop_index("ix_task_dependencies_depends_on_id", table_name="task_dependencies")
    op.drop_table("task_dependencies")
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("start_date")
