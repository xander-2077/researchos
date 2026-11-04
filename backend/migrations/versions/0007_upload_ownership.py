"""upload ownership

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-04 15:18:45.107965
"""
import re

from alembic import op
import sqlalchemy as sa


revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table('upload_owners',
    sa.Column('name', sa.String(length=40), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('name', 'user_id')
    )

    op.create_table('upload_projects',
    sa.Column('name', sa.String(length=40), nullable=False),
    sa.Column('project_id', sa.Integer(), nullable=False),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('name', 'project_id')
    )
    # Snapshot existing image references once. Future sharing checks the editor's access.
    conn = op.get_bind()
    refs = set()
    queries = [
        "SELECT id, notes || ' ' || description FROM projects",
        "SELECT project_id, description || ' ' || conclusion FROM experiments",
        "SELECT project_id, description || ' ' || notes FROM tasks WHERE project_id IS NOT NULL",
        "SELECT project_id, description FROM milestones",
        "SELECT project_id, details FROM progress_events WHERE project_id IS NOT NULL",
        "SELECT experiments.project_id, experiment_runs.conclusion FROM experiment_runs JOIN experiments ON experiments.id = experiment_runs.experiment_id",
    ]
    pattern = re.compile(r"/api/v1/uploads/([0-9a-f]{32}\.(?:png|jpg|gif|webp))")
    for query in queries:
        for project_id, content in conn.execute(sa.text(query)):
            refs.update((name, project_id) for name in pattern.findall(content or ""))
    for name, project_id in refs:
        conn.execute(sa.text("INSERT INTO upload_projects (name, project_id) VALUES (:name, :project_id)"),
                     {"name": name, "project_id": project_id})


def downgrade() -> None:
    op.drop_table('upload_projects')
    op.drop_table('upload_owners')
