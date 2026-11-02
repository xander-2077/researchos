"""Task scheduling (start_date) and dependencies used by the Gantt view."""

from __future__ import annotations

from tests.conftest import Ctx
from tests.test_api import d, mkproject


def mk(ctx: Ctx, pid: int, title: str, **kw):
    r = ctx.client.post("/api/v1/tasks", json={"project_id": pid, "title": title, **kw}, headers=ctx.csrf)
    assert r.status_code == 201, r.text
    return r.json()


def test_start_date_and_dependencies_roundtrip(ctx: Ctx):
    p = mkproject(ctx)
    a = mk(ctx, p["id"], "A", start_date="2030-01-01", due_date="2030-01-05")
    b = mk(ctx, p["id"], "B", start_date="2030-01-06", due_date="2030-01-09", depends_on=[a["id"]])
    assert a["start_date"] == "2030-01-01" and a["depends_on"] == []
    assert b["depends_on"] == [a["id"]]
    got = ctx.client.get("/api/v1/tasks", params={"project_id": p["id"]}).json()["items"]
    assert {t["title"]: t["depends_on"] for t in got} == {"A": [], "B": [a["id"]]}
    # clear
    r = ctx.client.patch(f"/api/v1/tasks/{b['id']}", json={"depends_on": []}, headers=ctx.csrf)
    assert r.status_code == 200 and r.json()["depends_on"] == []


def test_start_after_due_rejected(ctx: Ctx):
    p = mkproject(ctx)
    r = ctx.client.post("/api/v1/tasks", json={"project_id": p["id"], "title": "x", "start_date": "2030-02-02", "due_date": "2030-02-01"}, headers=ctx.csrf)
    assert r.status_code == 422
    t = mk(ctx, p["id"], "ok", start_date="2030-02-01", due_date="2030-02-10")
    # moving due before the stored start is also rejected
    r = ctx.client.patch(f"/api/v1/tasks/{t['id']}", json={"due_date": "2030-01-20"}, headers=ctx.csrf)
    assert r.status_code in (400, 422)
    assert ctx.client.get(f"/api/v1/tasks/{t['id']}").json()["due_date"] == "2030-02-10"


def test_dependency_validation(ctx: Ctx):
    p, q = mkproject(ctx), mkproject(ctx, title="Other project")
    a, b, c = (mk(ctx, p["id"], n) for n in "abc")
    other = mk(ctx, q["id"], "elsewhere")
    patch = lambda tid, ids: ctx.client.patch(f"/api/v1/tasks/{tid}", json={"depends_on": ids}, headers=ctx.csrf)
    assert patch(a["id"], [a["id"]]).status_code in (400, 422)          # self
    assert patch(a["id"], [other["id"]]).status_code in (400, 422)      # cross-project
    assert patch(a["id"], [999999]).status_code in (400, 422)           # unknown
    assert patch(b["id"], [a["id"]]).status_code == 200
    assert patch(c["id"], [b["id"]]).status_code == 200
    assert patch(a["id"], [c["id"]]).status_code in (400, 422)          # a→c→b→a cycle
    assert ctx.client.get(f"/api/v1/tasks/{a['id']}").json()["depends_on"] == []


def test_dependency_cleanup(ctx: Ctx):
    p, q = mkproject(ctx), mkproject(ctx, title="Other project")
    a, b = mk(ctx, p["id"], "a"), mk(ctx, p["id"], "b")
    ctx.client.patch(f"/api/v1/tasks/{b['id']}", json={"depends_on": [a["id"]]}, headers=ctx.csrf)
    # deleting the prerequisite removes the link
    assert ctx.client.delete(f"/api/v1/tasks/{a['id']}", headers=ctx.csrf).status_code == 204
    assert ctx.client.get(f"/api/v1/tasks/{b['id']}").json()["depends_on"] == []
    # moving a task to another project drops links in both directions
    c, e = mk(ctx, p["id"], "c"), mk(ctx, p["id"], "e")
    ctx.client.patch(f"/api/v1/tasks/{e['id']}", json={"depends_on": [c["id"]]}, headers=ctx.csrf)
    assert ctx.client.patch(f"/api/v1/tasks/{c['id']}", json={"project_id": q["id"]}, headers=ctx.csrf).status_code == 200
    assert ctx.client.get(f"/api/v1/tasks/{e['id']}").json()["depends_on"] == []


def test_export_includes_dependencies(ctx: Ctx):
    p = mkproject(ctx)
    a, b = mk(ctx, p["id"], "a"), mk(ctx, p["id"], "b")
    ctx.client.patch(f"/api/v1/tasks/{b['id']}", json={"depends_on": [a["id"]]}, headers=ctx.csrf)
    data = ctx.client.get("/api/v1/export").json()
    assert data["task_dependencies"] == [{"task_id": b["id"], "depends_on_id": a["id"]}]
