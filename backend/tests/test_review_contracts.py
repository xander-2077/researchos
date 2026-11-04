"""Regression coverage for run metrics, archive guards and MCP nulls."""
import json

import pytest
from pydantic import ValidationError

from app.schemas.entities import RunCreate
from tests.test_mcp import error_text, mcp_client, payload


@pytest.fixture
def anyio_backend():
    return "asyncio"


def create_run(ctx):
    c, h = ctx.client, ctx.csrf
    p = c.post('/api/v1/projects', json={'title': 'Contracts'}, headers=h).json()
    e = c.post('/api/v1/experiments', json={'project_id': p['id'], 'name': 'Results'}, headers=h).json()
    r = c.post(f"/api/v1/experiments/{e['id']}/runs", json={
        'external_run_id': 'run-1', 'metrics': {'accuracy': 0.8, 'old': 2}}, headers=h).json()
    return p, e, r


def test_run_metrics_replace_delete_and_merge(ctx):
    _, e, r = create_run(ctx)
    url = f"/api/v1/runs/{r['id']}"
    merged = ctx.client.patch(url, json={'metrics': {'accuracy': 0.9}}, headers=ctx.rw)
    assert merged.status_code == 200
    assert set(merged.json()['metrics_json']) == {'accuracy', 'old'}
    replaced = ctx.client.patch(url, json={'metrics': {'accuracy': 0.7}, 'metrics_mode': 'replace'}, headers=ctx.csrf)
    assert replaced.status_code == 200, replaced.text
    assert set(replaced.json()['metrics_json']) == {'accuracy'}
    preserved = ctx.client.patch(url, json={'metrics_mode': 'replace', 'conclusion': 'Updated'}, headers=ctx.csrf)
    assert set(preserved.json()['metrics_json']) == {'accuracy'}
    cleared = ctx.client.patch(url, json={'metrics': {}, 'metrics_mode': 'replace'}, headers=ctx.csrf)
    assert cleared.json()['metrics_json'] == {}
    retried = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={
        'external_run_id': 'run-1', 'metrics': {'new': 3}}, headers=ctx.rw)
    assert retried.json()['id'] == r['id']


def test_replace_metrics_preserves_permissions(ctx):
    _, _, r = create_run(ctx)
    url = f"/api/v1/runs/{r['id']}"
    ctx.client.patch(url, json={'verification_status': 'verified'}, headers=ctx.csrf)
    change = {'metrics': {}, 'metrics_mode': 'replace'}
    assert ctx.client.patch(url, json=change, headers=ctx.ro).status_code == 403
    rejected = ctx.client.patch(url, json=change, headers=ctx.rw)
    assert rejected.status_code == 409
    assert rejected.json()['error']['code'] == 'verified_protected'
    changed = ctx.client.patch(url, json={**change, 'confirm_overwrite_verified': True}, headers=ctx.rw)
    assert changed.status_code == 200
    assert changed.json()['metrics_json'] == {}
    assert changed.json()['verification_status'] == 'needs_review'


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')])
@pytest.mark.parametrize('structured', [False, True])
def test_nonfinite_metric_rejected(value, structured):
    with pytest.raises(ValidationError):
        RunCreate(external_run_id='bad', metrics={'bad': {'value': value} if structured else value})


def test_nonfinite_rest_metric_rejected_before_write(ctx):
    _, e, _ = create_run(ctx)
    for metric in [float('nan'), {'value': float('inf')}, {'value': 'NaN'}]:
        response = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", content=json.dumps({
            'external_run_id': 'bad', 'metrics': {'bad': metric}}),
            headers={**ctx.csrf, 'Content-Type': 'application/json'})
        assert response.status_code == 422
    detail = ctx.client.get(f"/api/v1/experiments/{e['id']}", headers=ctx.csrf).json()
    assert [r['external_run_id'] for r in detail['runs']] == ['run-1']
    assert ctx.client.get('/api/v1/export', headers=ctx.csrf).status_code == 200


def test_archive_requires_agent_confirmation(ctx):
    p = ctx.client.post('/api/v1/projects', json={'title': 'Archive guard'}, headers=ctx.csrf).json()
    url = f"/api/v1/projects/{p['id']}"
    denied = ctx.client.delete(url, headers=ctx.rw)
    assert denied.status_code == 409
    assert denied.json()['error']['code'] == 'confirmation_required'
    assert ctx.client.get(url, headers=ctx.rw).json()['archived'] is False
    assert ctx.client.delete(url + '?confirm=true', headers=ctx.ro).status_code == 403
    assert ctx.client.delete(url + '?confirm=true', headers=ctx.rw).json()['archived'] is True
    ctx.client.patch(url, json={'archived': False}, headers=ctx.csrf)
    assert ctx.client.delete(url, headers=ctx.csrf).json()['archived'] is True


@pytest.mark.anyio
async def test_mcp_task_null_clears_dates_milestone_and_project(live_server):
    c, h = live_server.client, live_server.csrf
    p = c.post('/api/v1/projects', json={'title': 'Nulls'}, headers=h).json()
    m = c.post(f"/api/v1/projects/{p['id']}/milestones", json={'title': 'Checkpoint'}, headers=h).json()
    async with mcp_client(live_server.url, live_server.rw_token) as mc:
        args = {'project': p['slug'], 'client_key': 'task-null', 'title': 'Task',
                'milestone_id': m['id'], 'start_date': '2026-01-01', 'due_date': '2026-02-01'}
        t = payload(await mc.call_tool('upsert_task', args))
        preserved = payload(await mc.call_tool('upsert_task', {'task_id': t['task_id'], 'priority': 'high'}))
        assert preserved['start_date'] == '2026-01-01'
        cleared = payload(await mc.call_tool('upsert_task', {'project': p['slug'], 'client_key': 'task-null',
                                                           'start_date': None, 'due_date': None, 'milestone_id': None}))
        assert cleared['task_id'] == t['task_id'] and not cleared['created']
        assert cleared['start_date'] is None and cleared['due_date'] is None
        assert c.get(f"/api/v1/tasks/{t['task_id']}", headers=h).json()['milestone_id'] is None
        detached = payload(await mc.call_tool('upsert_task', {'task_id': t['task_id'], 'project': None}))
        assert detached['project'] is None


@pytest.mark.anyio
async def test_mcp_project_and_milestone_null_dates(live_server):
    c, h = live_server.client, live_server.csrf
    p = c.post('/api/v1/projects', json={'title': 'Deadlines', 'submission_deadline': '2026-02-01'}, headers=h).json()
    async with mcp_client(live_server.url, live_server.rw_token) as mc:
        m = payload(await mc.call_tool('upsert_milestone', {'project': p['slug'], 'title': 'Due', 'due_date': '2026-02-01'}))
        saved = payload(await mc.call_tool('upsert_milestone', {'project': p['slug'], 'milestone_id': m['milestone_id'], 'description': 'Preserve'}))
        assert saved['due_date'] == '2026-02-01'
        cleared = payload(await mc.call_tool('upsert_milestone', {'project': p['slug'], 'milestone_id': m['milestone_id'], 'due_date': None}))
        assert cleared['due_date'] is None
        payload(await mc.call_tool('update_project', {'project': p['slug'], 'priority': 'high'}))
        assert c.get(f"/api/v1/projects/{p['id']}", headers=h).json()['submission_deadline'] == '2026-02-01'
        result = payload(await mc.call_tool('update_project', {'project': p['slug'], 'submission_deadline': None}))
        assert result['changed']['submission_deadline']['to'] is None
        for name, args in [
            ('upsert_milestone', {'project': p['slug'], 'milestone_id': m['milestone_id'], 'title': None}),
            ('update_project', {'project': p['slug'], 'priority': None}),
        ]:
            assert 'validation_error' in error_text(await mc.call_tool(name, args))


@pytest.mark.anyio
async def test_mcp_run_null_seed_and_timestamps(live_server):
    c, h = live_server.client, live_server.csrf
    p = c.post('/api/v1/projects', json={'title': 'Run nulls'}, headers=h).json()
    async with mcp_client(live_server.url, live_server.rw_token) as mc:
        key = {'project': p['slug'], 'experiment_key': 'null-run', 'external_run_id': 'one'}
        r = payload(await mc.call_tool('record_experiment', {**key, 'experiment_name': 'Null runs', 'seed': 4,
            'started_at': '2026-01-01T00:00:00Z', 'finished_at': '2026-01-02T00:00:00Z', 'metrics': {'a': 1}}))
        payload(await mc.call_tool('record_experiment', {**key, 'metrics': {'b': 2}}))
        detail = c.get(f"/api/v1/experiments/{r['experiment_id']}", headers=h).json()['runs'][0]
        assert detail['seed'] == 4 and detail['started_at'] is not None
        cleared = payload(await mc.call_tool('record_experiment', {**key, 'seed': None, 'started_at': None, 'finished_at': None}))
        assert cleared['run_id'] == r['run_id'] and not cleared['run_created']
        assert set(cleared['metrics']) == {'a', 'b'}
        detail = c.get(f"/api/v1/experiments/{r['experiment_id']}", headers=h).json()['runs'][0]
        assert detail['seed'] is None and detail['started_at'] is None and detail['finished_at'] is None
        assert 'validation_error' in error_text(await mc.call_tool('record_experiment', {**key, 'run_status': None}))


@pytest.mark.parametrize('explicit_range', [False, True])
def test_deadlines_include_archived_only_when_requested(ctx, explicit_range):
    from datetime import date, timedelta

    due = (date.today() + timedelta(days=3)).isoformat()
    p = ctx.client.post('/api/v1/projects', json={'title': 'Archived deadlines', 'submission_deadline': due}, headers=ctx.csrf).json()
    ctx.client.post(f"/api/v1/projects/{p['id']}/milestones", json={'title': 'Milestone', 'due_date': due}, headers=ctx.csrf)
    ctx.client.post('/api/v1/tasks', json={'project_id': p['id'], 'title': 'Task', 'due_date': due}, headers=ctx.csrf)
    ctx.client.delete(f"/api/v1/projects/{p['id']}", headers=ctx.csrf)
    params = {'project_id': p['id']}
    if explicit_range:
        params.update(start=date.today().isoformat(), end=due)
    assert ctx.client.get('/api/v1/dashboard/deadlines', params=params, headers=ctx.ro).json() == []
    found = ctx.client.get('/api/v1/dashboard/deadlines', params={**params, 'include_archived': True}, headers=ctx.ro).json()
    assert {item['kind'] for item in found} == {'submission', 'milestone', 'task'}
