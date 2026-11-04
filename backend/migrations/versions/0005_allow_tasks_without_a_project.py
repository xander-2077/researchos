"""allow tasks without a project

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-03 14:48:34.065342
"""
from alembic import op
import sqlalchemy as sa


revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.alter_column('project_id',
               existing_type=sa.INTEGER(),
               nullable=True)
        batch_op.create_index('uq_task_standalone_client_key', ['client_key'], unique=True, sqlite_where=sa.text('project_id IS NULL'), postgresql_where=sa.text('project_id IS NULL'))



def downgrade() -> None:
    # Never discard standalone tasks to restore the previous NOT NULL constraint.
    if op.get_bind().execute(sa.text("SELECT 1 FROM tasks WHERE project_id IS NULL LIMIT 1")).first():
        raise RuntimeError("Assign standalone tasks to projects before downgrading")
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_index('uq_task_standalone_client_key', sqlite_where=sa.text('project_id IS NULL'), postgresql_where=sa.text('project_id IS NULL'))
        batch_op.alter_column('project_id',
               existing_type=sa.INTEGER(),
               nullable=False)
