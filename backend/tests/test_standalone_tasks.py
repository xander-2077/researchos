from datetime import date, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.database.session import SessionLocal
from app.models import Task
from tests.test_api import mkproject


def create(ctx, **fields):
    r = ctx.client.post('/api/v1/tasks', json={'title': 'Independent work', **fields}, headers=ctx.rw)
    assert r.status_code == 201, r.text
    return r.json()


def test_standalone_task_in_lists_summary_deadlines_and_activity(ctx):
    task = create(ctx, due_date=(date.today() - timedelta(days=1)).isoformat())
    assert task['project_id'] is None and task['project_slug'] is None
    p = mkproject(ctx)
    create(ctx, project_id=p['id'])
    ctx.client.patch(f"/api/v1/projects/{p['id']}", json={'archived': True}, headers=ctx.csrf)
    items = ctx.client.get('/api/v1/tasks').json()['items']
    assert [t['id'] for t in items] == [task['id']]
    assert ctx.client.get('/api/v1/tasks', params={'project_id': p['id']}).json()['items'] == []
    summary = ctx.client.get('/api/v1/dashboard/summary').json()
    assert summary['open_tasks'] == 1 and summary['overdue_tasks'] == 1
    deadlines = ctx.client.get('/api/v1/dashboard/deadlines').json()
    assert len(deadlines) == 1 and deadlines[0]['project_id'] is None
    assert deadlines[0]['id'] == task['id']
    events = ctx.client.get('/api/v1/dashboard/activity').json()['items']
    assert any(e['event_type'] == 'task_created' and e['project_id'] is None for e in events)
    r = ctx.client.patch(f"/api/v1/tasks/{task['id']}", json={'status': 'done'}, headers=ctx.csrf)
    assert r.status_code == 200 and r.json()['completed_at']
    assert ctx.client.get('/api/v1/dashboard/summary').json()['open_tasks'] == 0
    assert ctx.client.delete(f"/api/v1/tasks/{task['id']}", headers=ctx.csrf).status_code == 204


def test_task_can_leave_and_join_project_clearing_project_relations(ctx):
    p = mkproject(ctx)
    ms = ctx.client.post(f"/api/v1/projects/{p['id']}/milestones", json={'title': 'Checkpoint'}, headers=ctx.csrf).json()
    a = create(ctx, project_id=p['id'])
    b = create(ctx, project_id=p['id'], milestone_id=ms['id'], depends_on=[a['id']])
    c = create(ctx, project_id=p['id'], depends_on=[b['id']])
    r = ctx.client.patch(f"/api/v1/tasks/{b['id']}", json={'project_id': None}, headers=ctx.csrf)
    assert r.status_code == 200, r.text
    assert r.json()['milestone_id'] is None and r.json()['depends_on'] == []
    assert ctx.client.get(f"/api/v1/tasks/{c['id']}").json()['depends_on'] == []
    r = ctx.client.patch(f"/api/v1/tasks/{b['id']}", json={'project_id': p['id']}, headers=ctx.csrf)
    assert r.status_code == 200 and r.json()['project_id'] == p['id']
    r = ctx.client.post('/api/v1/tasks', json={'title': 'Invalid milestone', 'project_id': None, 'milestone_id': ms['id']}, headers=ctx.csrf)
    assert r.status_code in (400, 422)


def test_standalone_idempotency_has_its_own_scope_and_database_constraint(ctx):
    a = create(ctx, project_id=None, client_key='daily')
    retry = create(ctx, client_key='daily', title='Updated title')
    assert retry['id'] == a['id'] and retry['title'] == 'Updated title'
    p = mkproject(ctx)
    other = create(ctx, project_id=p['id'], client_key='daily')
    assert other['id'] != a['id']
    create(ctx)
    create(ctx)
    with SessionLocal() as db:
        db.add(Task(project_id=None, client_key='daily', title='Duplicate'))
        with pytest.raises(IntegrityError):
            db.commit()


def test_standalone_task_still_requires_write_scope(ctx):
    r = ctx.client.post('/api/v1/tasks', json={'title': 'Not allowed'}, headers=ctx.ro)
    assert r.status_code == 403


def test_migration_preserves_existing_tasks_dependencies_and_events(ctx, settings):
    import sqlite3
    from alembic import command
    from app.database.migrate import alembic_config
    from app.database.session import get_engine

    p = mkproject(ctx)
    a = create(ctx, project_id=p['id'], client_key='a')
    create(ctx, project_id=p['id'], depends_on=[a['id']], start_date='2030-01-01', due_date='2030-01-02')
    get_engine().dispose()
    cfg = alembic_config(settings.sqlalchemy_url)
    command.downgrade(cfg, '0004')
    path = settings.data_dir / 'researchos.db'
    tables = ['tasks', 'task_dependencies', 'progress_events', 'projects']
    with sqlite3.connect(path) as db:
        before = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
    command.upgrade(cfg, 'head')
    with sqlite3.connect(path) as db:
        after = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in tables}
        assert after == before
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
        assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
    create(ctx, project_id=None)
    with pytest.raises(RuntimeError, match='Assign standalone tasks'):
        command.downgrade(cfg, '0004')
