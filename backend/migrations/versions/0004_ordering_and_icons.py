"""manual ordering (projects, tasks) and project icons

Revision ID: 0004
Revises: 0003
"""
import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}


def upgrade() -> None:
    with op.batch_alter_table("projects") as batch:
        batch.add_column(sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("icon", sa.String(40), nullable=False, server_default=""))
        batch.add_column(sa.Column("color", sa.String(7), nullable=False, server_default=""))
    with op.batch_alter_table("tasks") as batch:
        batch.add_column(sa.Column("sort_order", sa.Float(), nullable=False, server_default="0"))

    # Seed the manual order from what users saw before: priority first, then title / due date.
    conn = op.get_bind()
    projects = conn.execute(sa.text("SELECT id, priority, title FROM projects")).fetchall()
    for pos, (pid, *_rest) in enumerate(sorted(projects, key=lambda r: (_RANK.get(r[1], 9), (r[2] or "").lower(), r[0])), 1):
        conn.execute(sa.text("UPDATE projects SET sort_order = :s WHERE id = :i"), {"s": pos, "i": pid})
    tasks = conn.execute(sa.text("SELECT id, priority, due_date FROM tasks")).fetchall()
    for pos, (tid, *_rest) in enumerate(sorted(tasks, key=lambda r: (_RANK.get(r[1], 9), r[2] is None, str(r[2] or ""), r[0])), 1):
        conn.execute(sa.text("UPDATE tasks SET sort_order = :s WHERE id = :i"), {"s": pos * 1024.0, "i": tid})


def downgrade() -> None:
    with op.batch_alter_table("tasks") as batch:
        batch.drop_column("sort_order")
    with op.batch_alter_table("projects") as batch:
        batch.drop_column("color")
        batch.drop_column("icon")
        batch.drop_column("sort_order")
