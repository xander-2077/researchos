"""personal standalone task ownership

Revision ID: 0009
Revises: 0008
Create Date: 2026-11-04 16:12:38.668847
"""
from alembic import op
import sqlalchemy as sa


revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('progress_events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_events_user', 'users', ['user_id'], ['id'], ondelete='SET NULL')

    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.add_column(sa.Column('owner_id', sa.Integer(), nullable=True))
        batch_op.drop_index(batch_op.f('uq_task_standalone_client_key'), sqlite_where=sa.text('project_id IS NULL'))
        batch_op.create_index('uq_task_standalone_client_key', ['owner_id', 'client_key'], unique=True, sqlite_where=sa.text('project_id IS NULL'), postgresql_where=sa.text('project_id IS NULL'))
        batch_op.create_index(batch_op.f('ix_tasks_owner_id'), ['owner_id'], unique=False)
        batch_op.create_foreign_key('fk_tasks_owner', 'users', ['owner_id'], ['id'])

    conn = op.get_bind()
    conn.execute(sa.text("UPDATE tasks SET owner_id = (SELECT MIN(id) FROM users)"))
    conn.execute(sa.text(
        "UPDATE progress_events SET user_id = (SELECT owner_id FROM tasks "
        "WHERE tasks.id = progress_events.related_resource_id) "
        "WHERE project_id IS NULL AND related_resource_type = 'task'"
    ))


def downgrade() -> None:
    duplicates = op.get_bind().execute(sa.text(
        "SELECT client_key FROM tasks WHERE project_id IS NULL AND client_key IS NOT NULL "
        "GROUP BY client_key HAVING COUNT(*) > 1"
    )).first()
    if duplicates:
        raise RuntimeError("Resolve duplicate standalone task client keys before downgrading")
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_constraint('fk_tasks_owner', type_='foreignkey')
        batch_op.drop_index('ix_tasks_owner_id')
        batch_op.drop_index('uq_task_standalone_client_key')
        batch_op.create_index('uq_task_standalone_client_key', ['client_key'], unique=True,
                              sqlite_where=sa.text('project_id IS NULL'), postgresql_where=sa.text('project_id IS NULL'))
        batch_op.drop_column('owner_id')
    with op.batch_alter_table('progress_events', schema=None) as batch_op:
        batch_op.drop_constraint('fk_events_user', type_='foreignkey')
        batch_op.drop_column('user_id')
