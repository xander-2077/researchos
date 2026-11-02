"""session_version on users; rename all-digit project slugs

Revision ID: 0002
Revises: 0001
"""
import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("session_version", sa.Integer(), nullable=False, server_default="1"))

    # A purely numeric slug is ambiguous with a numeric project id ("/projects/1"). Rename any
    # such legacy slug to "project-<id>" (ids are unique, so this cannot collide with itself).
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, slug FROM projects")).fetchall()
    taken = {slug for _, slug in rows}
    for pid, slug in rows:
        if slug.isdigit():
            new = f"project-{pid}"
            n = 2
            while new in taken:
                new = f"project-{pid}-{n}"
                n += 1
            conn.execute(sa.text("UPDATE projects SET slug = :s WHERE id = :i"), {"s": new, "i": pid})
            taken.add(new)


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("session_version")
