from __future__ import annotations

from datetime import date, timedelta

from tests.conftest import Ctx


def mkproject(ctx: Ctx, title: str = "Quadruped Soccer", **kw) -> dict:
    r = ctx.client.post("/api/v1/projects", json={"title": title, **kw}, headers=ctx.rw)
    assert r.status_code == 201, r.text
    return r.json()


def d(n: int) -> str:
    return (date.today() + timedelta(days=n)).isoformat()


# ------------------------------------------------------------------ auth
def test_unauthenticated_rejected(ctx: Ctx):
    ctx.client.cookies.clear()
    r = ctx.client.get("/api/v1/projects")
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "unauthorized"


def test_invalid_and_revoked_token(ctx: Ctx):
    assert ctx.client.get("/api/v1/projects", headers={"Authorization": "Bearer ros_nope"}).status_code == 401
    tokens = ctx.client.get("/api/v1/tokens", headers=ctx.csrf).json()
    ro = next(t for t in tokens if t["name"] == "readonly")
    assert "token" not in ro and "token_hash" not in ro
    assert ctx.client.delete(f"/api/v1/tokens/{ro['id']}", headers=ctx.csrf).status_code == 200
    r = ctx.client.get("/api/v1/projects", headers=ctx.ro)
    assert r.status_code == 401 and "revoked" in r.json()["error"]["message"]


def test_expired_token(ctx: Ctx):
    from app.database.session import SessionLocal
    from app.models import ApiToken, utcnow

    with SessionLocal() as db:
        t = db.query(ApiToken).filter_by(name="readonly").one()
        t.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    r = ctx.client.get("/api/v1/projects", headers=ctx.ro)
    assert r.status_code == 401 and "expired" in r.json()["error"]["message"]


def test_readonly_token_cannot_write(ctx: Ctx):
    p = mkproject(ctx)
    for method, url, body in [
        ("post", "/api/v1/projects", {"title": "x"}),
        ("patch", f"/api/v1/projects/{p['id']}", {"stage": "writing"}),
        ("post", "/api/v1/tasks", {"project_id": p["id"], "title": "t"}),
        ("post", f"/api/v1/projects/{p['id']}/progress", {"summary": "s"}),
        ("post", "/api/v1/experiments", {"project_id": p["id"], "name": "e"}),
    ]:
        r = getattr(ctx.client, method)(url, json=body, headers=ctx.ro)
        assert r.status_code == 403, (url, r.text)
        assert r.json()["error"]["code"] == "insufficient_scope"
    assert ctx.client.get("/api/v1/projects", headers=ctx.ro).status_code == 200


def test_tokens_cannot_manage_tokens(ctx: Ctx):
    r = ctx.client.post("/api/v1/tokens", json={"name": "x", "scopes": ["read"]}, headers=ctx.rw)
    assert r.status_code == 403


def test_csrf_required_for_cookie_writes(ctx: Ctx):
    assert ctx.client.post("/api/v1/projects", json={"title": "x"}).status_code == 403
    assert ctx.client.post("/api/v1/projects", json={"title": "x"}, headers=ctx.csrf).status_code == 201


def test_login_wrong_password(ctx: Ctx):
    r = ctx.client.post("/api/v1/auth/login", json={"username": "admin", "password": "wrong-password"})
    assert r.status_code == 401


# ------------------------------------------------------------------ projects
def test_project_crud_and_activity(ctx: Ctx):
    p = mkproject(ctx, research_question="RQ", submission_deadline=d(30), target_venue="ICRA")
    assert p["slug"] == "quadruped-soccer" and p["version"] == 1
    assert p["milestone_progress"] == {"completed": 0, "total": 0, "percent": None}
    # duplicate title → unique slug
    assert mkproject(ctx)["slug"] == "quadruped-soccer-2"
    # get by slug and id
    assert ctx.client.get("/api/v1/projects/quadruped-soccer", headers=ctx.ro).json()["id"] == p["id"]
    r = ctx.client.patch(f"/api/v1/projects/{p['id']}", json={"stage": "writing", "version": 1}, headers=ctx.csrf)
    assert r.status_code == 200 and r.json()["stage"] == "writing" and r.json()["version"] == 2
    # stale version → 409
    r = ctx.client.patch(f"/api/v1/projects/{p['id']}", json={"priority": "high", "version": 1}, headers=ctx.csrf)
    assert r.status_code == 409
    # archive (soft delete)
    r = ctx.client.delete(f"/api/v1/projects/{p['id']}", headers=ctx.csrf)
    assert r.json()["archived"] is True
    active = ctx.client.get("/api/v1/projects", headers=ctx.ro).json()
    assert p["id"] not in [x["id"] for x in active["items"]]
    archived = ctx.client.get("/api/v1/projects?archived=true", headers=ctx.ro).json()
    assert [x["id"] for x in archived["items"]] == [p["id"]]
    events = ctx.client.get(f"/api/v1/projects/{p['id']}/progress", headers=ctx.ro).json()["items"]
    types = [e["event_type"] for e in events]
    assert {"project_created", "stage_changed", "project_archived"} <= set(types)
    stage_ev = next(e for e in events if e["event_type"] == "stage_changed")
    assert stage_ev["source"] == "manual" and stage_ev["actor"] == "admin"


def test_agent_high_impact_requires_confirm(ctx: Ctx):
    p = mkproject(ctx)
    r = ctx.client.patch(f"/api/v1/projects/{p['id']}", json={"stage": "completed"}, headers=ctx.rw)
    assert r.status_code == 409 and r.json()["error"]["code"] == "confirmation_required"
    r = ctx.client.patch(f"/api/v1/projects/{p['id']}", json={"stage": "completed", "confirm": True}, headers=ctx.rw)
    assert r.status_code == 200 and r.json()["stage"] == "completed"


def test_invalid_payloads(ctx: Ctx):
    r = ctx.client.post("/api/v1/projects", json={"title": ""}, headers=ctx.rw)
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"
    r = ctx.client.post("/api/v1/projects", json={"title": "x", "stage": "dreaming"}, headers=ctx.rw)
    assert r.status_code == 422
    r = ctx.client.post("/api/v1/projects", json={"title": "x", "unknown_field": 1}, headers=ctx.rw)
    assert r.status_code == 422
    r = ctx.client.post("/api/v1/tasks", json={"project_id": 9999, "title": "x"}, headers=ctx.rw)
    assert r.status_code == 404
    r = ctx.client.get("/api/v1/tasks?sort=password", headers=ctx.rw)
    assert r.status_code == 422
    r = ctx.client.get("/api/v1/tasks?status=nonsense", headers=ctx.rw)
    assert r.status_code == 422
    big = "x" * 1_100_000
    r = ctx.client.post("/api/v1/projects", content=big, headers={**ctx.rw, "Content-Type": "application/json"})
    assert r.status_code == 413


def test_pagination_limits(ctx: Ctx):
    p = mkproject(ctx)
    for i in range(5):
        ctx.client.post("/api/v1/tasks", json={"project_id": p["id"], "title": f"t{i}"}, headers=ctx.rw)
    page = ctx.client.get("/api/v1/tasks?limit=2&offset=2", headers=ctx.ro).json()
    assert page["total"] == 5 and len(page["items"]) == 2 and page["offset"] == 2
    assert ctx.client.get("/api/v1/tasks?limit=100000", headers=ctx.ro).json()["limit"] == 200


# ------------------------------------------------------------------ milestones
def test_milestone_crud_and_progress(ctx: Ctx):
    p = mkproject(ctx)
    base = f"/api/v1/projects/{p['id']}/milestones"
    ids = [ctx.client.post(base, json={"title": f"M{i}", "due_date": d(i + 1)}, headers=ctx.rw).json()["id"] for i in range(4)]
    r = ctx.client.patch(f"/api/v1/milestones/{ids[0]}", json={"status": "completed"}, headers=ctx.rw)
    assert r.json()["completed_at"] is not None
    ctx.client.patch(f"/api/v1/milestones/{ids[3]}", json={"status": "cancelled"}, headers=ctx.rw)
    proj = ctx.client.get(f"/api/v1/projects/{p['id']}", headers=ctx.ro).json()
    assert proj["milestone_progress"] == {"completed": 1, "total": 3, "percent": 33.3}
    assert proj["next_milestone"]["id"] == ids[1]
    assert ctx.client.delete(f"/api/v1/milestones/{ids[2]}", headers=ctx.rw).status_code == 204
    assert len(ctx.client.get(base, headers=ctx.ro).json()) == 3
    events = ctx.client.get(f"/api/v1/projects/{p['id']}/progress?event_type=milestone_completed", headers=ctx.ro).json()
    assert events["total"] == 1


# ------------------------------------------------------------------ tasks
def test_task_crud_and_filters(ctx: Ctx):
    a, b = mkproject(ctx, "A"), mkproject(ctx, "B")
    m = ctx.client.post(f"/api/v1/projects/{a['id']}/milestones", json={"title": "M"}, headers=ctx.rw).json()
    t1 = ctx.client.post("/api/v1/tasks", json={"project_id": a["id"], "title": "due soon", "due_date": d(3),
                                                "priority": "high", "milestone_id": m["id"], "tags": ["exp"]}, headers=ctx.rw).json()
    assert t1["milestone_title"] == "M" and t1["project_slug"] == "a"
    ctx.client.post("/api/v1/tasks", json={"project_id": b["id"], "title": "later", "due_date": d(20)}, headers=ctx.rw)
    ctx.client.post("/api/v1/tasks", json={"project_id": b["id"], "title": "overdue", "due_date": d(-2), "priority": "critical"}, headers=ctx.rw)
    ctx.client.post("/api/v1/tasks", json={"project_id": b["id"], "title": "stuck", "status": "blocked"}, headers=ctx.rw)
    # milestone from another project is rejected
    r = ctx.client.post("/api/v1/tasks", json={"project_id": b["id"], "title": "x", "milestone_id": m["id"]}, headers=ctx.rw)
    assert r.status_code == 422

    week = ctx.client.get(f"/api/v1/tasks?open_only=true&due_after={d(0)}&due_before={d(7)}", headers=ctx.ro).json()
    assert [t["title"] for t in week["items"]] == ["due soon"]
    assert [t["title"] for t in ctx.client.get("/api/v1/tasks?status=blocked", headers=ctx.ro).json()["items"]] == ["stuck"]
    assert [t["title"] for t in ctx.client.get("/api/v1/tasks?overdue=true", headers=ctx.ro).json()["items"]] == ["overdue"]
    top = ctx.client.get("/api/v1/tasks?open_only=true&sort=priority,due_date", headers=ctx.ro).json()["items"][0]
    assert top["title"] == "overdue"
    assert ctx.client.get("/api/v1/tasks?tag=exp", headers=ctx.ro).json()["total"] == 1
    assert ctx.client.get("/api/v1/tasks?q=stuck", headers=ctx.ro).json()["total"] == 1

    r = ctx.client.patch(f"/api/v1/tasks/{t1['id']}", json={"status": "done"}, headers=ctx.rw)
    assert r.json()["completed_at"] is not None
    r = ctx.client.patch(f"/api/v1/tasks/{t1['id']}", json={"status": "todo"}, headers=ctx.rw)
    assert r.json()["completed_at"] is None
    assert ctx.client.get(f"/api/v1/tasks/{t1['id']}", headers=ctx.ro).status_code == 200
    assert ctx.client.delete(f"/api/v1/tasks/{t1['id']}", headers=ctx.rw).status_code == 204
    assert ctx.client.get(f"/api/v1/tasks/{t1['id']}", headers=ctx.ro).status_code == 404
    evs = ctx.client.get(f"/api/v1/dashboard/activity?project_id={a['id']}", headers=ctx.ro).json()["items"]
    assert {"task_created", "task_completed", "task_status_changed", "task_deleted"} <= {e["event_type"] for e in evs}
    assert all(e["source"] == "codex" for e in evs if e["event_type"].startswith("task"))


def test_task_client_key_idempotent(ctx: Ctx):
    p = mkproject(ctx)
    body = {"project_id": p["id"], "title": "Run ablation", "client_key": "abl-1"}
    t1 = ctx.client.post("/api/v1/tasks", json=body, headers=ctx.rw).json()
    t2 = ctx.client.post("/api/v1/tasks", json={**body, "status": "in_progress"}, headers=ctx.rw).json()
    assert t1["id"] == t2["id"] and t2["status"] == "in_progress"
    assert ctx.client.get(f"/api/v1/tasks?project_id={p['id']}", headers=ctx.ro).json()["total"] == 1


# ------------------------------------------------------------------ experiments
def test_experiment_crud_and_runs_idempotent(ctx: Ctx):
    p = mkproject(ctx)
    e = ctx.client.post("/api/v1/experiments", json={
        "project_id": p["id"], "name": "No world model", "group_name": "WM ablations", "type": "ablation",
        "variant": "remove WM"}, headers=ctx.rw).json()
    assert e["experiment_key"] == "no-world-model" and e["run_count"] == 0
    dup = ctx.client.post("/api/v1/experiments", json={"project_id": p["id"], "name": "No world model"}, headers=ctx.rw)
    assert dup.status_code == 409
    run = {"external_run_id": "wandb-abc", "seed": 1, "git_commit": "deadbeef",
           "metrics": {"success_rate": {"value": 0.5, "unit": "%"}}, "config": {"lr": 0.001}}
    r1 = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json=run, headers=ctx.rw).json()
    r2 = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={**run, "metrics": {"return": 10}}, headers=ctx.rw).json()
    assert r1["id"] == r2["id"]
    assert set(r2["metrics_json"]) == {"success_rate", "return"}  # merged
    assert r1["verification_status"] == "needs_review"
    ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={**run, "external_run_id": "wandb-def", "seed": 2,
                                                                  "metrics": {"success_rate": 0.7}}, headers=ctx.rw)
    detail = ctx.client.get(f"/api/v1/experiments/{e['id']}", headers=ctx.ro).json()
    assert detail["run_count"] == 2 and len(detail["runs"]) == 2
    sr = detail["metric_summary"]["success_rate"]
    assert sr["n"] == 2 and abs(sr["mean"] - 0.6) < 1e-9
    assert len(ctx.client.get(f"/api/v1/experiments/{e['id']}/runs", headers=ctx.ro).json()) == 2
    # filters
    assert ctx.client.get("/api/v1/experiments?metric=return", headers=ctx.ro).json()["total"] == 1
    assert ctx.client.get("/api/v1/experiments?group_name=WM ablations", headers=ctx.ro).json()["total"] == 1
    assert ctx.client.get("/api/v1/experiments?status=verified", headers=ctx.ro).json()["total"] == 0
    # patch run
    rr = ctx.client.patch(f"/api/v1/runs/{r1['id']}", json={"conclusion": "worse than full"}, headers=ctx.rw).json()
    assert rr["conclusion"] == "worse than full"
    ex = ctx.client.patch(f"/api/v1/experiments/{e['id']}", json={"status": "analyzing"}, headers=ctx.rw).json()
    assert ex["status"] == "analyzing"


def test_agents_cannot_verify_and_verified_is_protected(ctx: Ctx):
    p = mkproject(ctx)
    e = ctx.client.post("/api/v1/experiments", json={"project_id": p["id"], "name": "E"}, headers=ctx.rw).json()
    r = ctx.client.patch(f"/api/v1/experiments/{e['id']}", json={"status": "verified"}, headers=ctx.rw)
    assert r.status_code == 403 and r.json()["error"]["code"] == "verification_requires_human"
    run = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": "r1", "metrics": {"x": 1}}, headers=ctx.rw).json()
    assert ctx.client.patch(f"/api/v1/runs/{run['id']}", json={"verification_status": "verified"}, headers=ctx.rw).status_code == 403
    # Human verifies
    assert ctx.client.patch(f"/api/v1/experiments/{e['id']}", json={"status": "verified", "conclusion": "OK"}, headers=ctx.csrf).status_code == 200
    assert ctx.client.patch(f"/api/v1/runs/{run['id']}", json={"verification_status": "verified"}, headers=ctx.csrf).status_code == 200
    # Agent may not silently overwrite
    r = ctx.client.patch(f"/api/v1/experiments/{e['id']}", json={"conclusion": "changed"}, headers=ctx.rw)
    assert r.status_code == 409 and r.json()["error"]["code"] == "verified_protected"
    r = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": "r1", "metrics": {"x": 2}}, headers=ctx.rw)
    assert r.status_code == 409
    # With explicit confirmation, change is applied and drops back to needs_review
    r = ctx.client.patch(f"/api/v1/experiments/{e['id']}", json={"conclusion": "changed", "confirm_overwrite_verified": True}, headers=ctx.rw)
    assert r.status_code == 200 and r.json()["status"] == "needs_review"
    # Agents cannot delete experiments
    assert ctx.client.delete(f"/api/v1/experiments/{e['id']}", headers=ctx.rw).status_code == 403
    assert ctx.client.delete(f"/api/v1/experiments/{e['id']}", headers=ctx.csrf).status_code == 204


# ------------------------------------------------------------------ progress / dashboard
def test_progress_append_and_source(ctx: Ctx):
    p = mkproject(ctx)
    r = ctx.client.post(f"/api/v1/projects/{p['id']}/progress", json={"summary": "WBC module done", "details": "next: ablation"},
                        headers={**ctx.rw, "X-ResearchOS-Source": "claude-code"})
    assert r.status_code == 201 and r.json()["source"] == "claude_code"
    r = ctx.client.post(f"/api/v1/projects/{p['id']}/progress", json={"summary": "x", "source": "manual"}, headers=ctx.rw)
    assert r.json()["source"] == "codex"  # agents cannot claim to be manual
    page = ctx.client.get(f"/api/v1/projects/{p['id']}/progress?event_type=progress_note", headers=ctx.ro).json()
    assert page["total"] == 2
    assert ctx.client.get("/api/v1/dashboard/activity?source=claude_code", headers=ctx.ro).json()["total"] == 1
    r = ctx.client.post(f"/api/v1/projects/{p['id']}/progress", json={"summary": "x", "related_resource_type": "task"}, headers=ctx.rw)
    assert r.status_code == 422


def test_dashboard_aggregation_and_deadlines(ctx: Ctx):
    a = mkproject(ctx, "A", submission_deadline=d(10), target_venue="CoRL")
    b = mkproject(ctx, "B", health_status="blocked")
    mkproject(ctx, "Done", stage="completed")
    ctx.client.post("/api/v1/tasks", json={"project_id": a["id"], "title": "t1", "due_date": d(2)}, headers=ctx.rw)
    ctx.client.post("/api/v1/tasks", json={"project_id": b["id"], "title": "t2", "due_date": d(-1)}, headers=ctx.rw)
    ctx.client.post("/api/v1/tasks", json={"project_id": b["id"], "title": "t3", "status": "done", "due_date": d(1)}, headers=ctx.rw)
    ctx.client.post(f"/api/v1/projects/{b['id']}/milestones", json={"title": "M", "due_date": d(40)}, headers=ctx.rw)
    ctx.client.post("/api/v1/experiments", json={"project_id": a["id"], "name": "E", "status": "running"}, headers=ctx.rw)
    ctx.client.post("/api/v1/experiments", json={"project_id": a["id"], "name": "F", "status": "needs_review"}, headers=ctx.rw)
    s = ctx.client.get("/api/v1/dashboard/summary", headers=ctx.ro).json()
    assert s == {**s, "active_projects": 2, "open_tasks": 2, "running_experiments": 1, "blocked_projects": 1,
                 "overdue_tasks": 1, "experiments_needing_review": 1, "upcoming_deadlines": 2}
    dl = ctx.client.get("/api/v1/dashboard/deadlines?days=30", headers=ctx.ro).json()
    assert [(x["kind"], x["title"]) for x in dl] == [("task", "t2"), ("task", "t1"), ("submission", "CoRL submission")]
    assert dl[0]["overdue"] is True
    dl = ctx.client.get("/api/v1/dashboard/deadlines?days=60&include_overdue=false&kinds=milestone", headers=ctx.ro).json()
    assert [x["title"] for x in dl] == ["M"]
    nr = ctx.client.get("/api/v1/dashboard/needs-review", headers=ctx.ro).json()
    assert [x["name"] for x in nr] == ["F"]
    projects = ctx.client.get("/api/v1/projects?sort=next_deadline", headers=ctx.ro).json()["items"]
    assert projects[0]["title"] == "A" and projects[0]["next_deadline"]["title"] == "t1"


def test_export_and_health(ctx: Ctx):
    mkproject(ctx)
    assert ctx.client.get("/api/v1/healthz").json() == {"status": "ok"}
    data = ctx.client.get("/api/v1/export", headers=ctx.ro).json()
    assert data["format"] == "researchos-export" and len(data["projects"]) == 1
    assert "api_tokens" not in data and "users" not in data


def test_openapi_available(ctx: Ctx):
    spec = ctx.client.get("/api/openapi.json").json()
    assert "/api/v1/projects" in spec["paths"] and "/api/v1/experiments/{experiment_id}/runs" in spec["paths"]


def test_project_routes_accept_slug(ctx: Ctx):
    p = mkproject(ctx, "Humanoid WBM")
    r = ctx.client.post("/api/v1/projects/humanoid-wbm/progress", json={"summary": "via slug"}, headers=ctx.rw)
    assert r.status_code == 201 and r.json()["project_id"] == p["id"]
    r = ctx.client.post("/api/v1/projects/humanoid-wbm/milestones", json={"title": "M"}, headers=ctx.rw)
    assert r.status_code == 201
    assert len(ctx.client.get("/api/v1/projects/humanoid-wbm/milestones", headers=ctx.ro).json()) == 1
    assert ctx.client.get("/api/v1/projects/humanoid-wbm/progress", headers=ctx.ro).json()["total"] >= 2
    assert ctx.client.get("/api/v1/projects/nope/progress", headers=ctx.ro).status_code == 404


def test_deadlines_explicit_range(ctx: Ctx):
    p = mkproject(ctx, "Cal")
    for n in (-40, -5, 3, 50):
        ctx.client.post("/api/v1/tasks", json={"project_id": p["id"], "title": f"t{n}", "due_date": d(n)}, headers=ctx.rw)
    r = ctx.client.get(f"/api/v1/dashboard/deadlines?start={d(-45)}&end={d(-1)}", headers=ctx.ro).json()
    assert [x["title"] for x in r] == ["t-40", "t-5"]
    r = ctx.client.get(f"/api/v1/dashboard/deadlines?start={d(0)}&end={d(60)}", headers=ctx.ro).json()
    assert [x["title"] for x in r] == ["t3", "t50"]
    assert ctx.client.get(f"/api/v1/dashboard/deadlines?start={d(5)}&end={d(1)}", headers=ctx.ro).status_code == 422
