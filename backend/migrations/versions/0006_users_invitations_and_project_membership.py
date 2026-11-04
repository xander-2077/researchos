"""users invitations and project membership

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-04 15:02:51.634902
"""
from alembic import op
import sqlalchemy as sa
import app.models.entities


revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('user_invitations',
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('expires_at', app.models.entities.UTCDateTime(), nullable=False),
    sa.Column('used_at', app.models.entities.UTCDateTime(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('user_id'),
    sa.UniqueConstraint('token_hash')
    )
    op.create_table('project_members',
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('project_id', 'user_id')
    )
    with op.batch_alter_table('api_tokens', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_index(batch_op.f('ix_api_tokens_user_id'), ['user_id'], unique=False)
        batch_op.create_foreign_key('fk_api_tokens_user', 'users', ['user_id'], ['id'])

    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.add_column(sa.Column('owner_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_projects_owner', 'users', ['owner_id'], ['id'])

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_admin', sa.Boolean(), server_default='0', nullable=False))
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), server_default='1', nullable=False))

    # Existing installations were shared workspaces: retain every user's access.
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE users SET is_admin = 1"))
    conn.execute(sa.text("UPDATE projects SET owner_id = (SELECT MIN(id) FROM users)"))
    conn.execute(sa.text("UPDATE api_tokens SET user_id = (SELECT MIN(id) FROM users)"))
    conn.execute(sa.text("INSERT INTO project_members (project_id, user_id) SELECT projects.id, users.id FROM projects CROSS JOIN users"))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('is_active')
        batch_op.drop_column('is_admin')

    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_constraint('fk_projects_owner', type_='foreignkey')
        batch_op.drop_column('owner_id')

    with op.batch_alter_table('api_tokens', schema=None) as batch_op:
        batch_op.drop_constraint('fk_api_tokens_user', type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_api_tokens_user_id'))
        batch_op.drop_column('user_id')

    op.drop_table('project_members')
    op.drop_table('user_invitations')
