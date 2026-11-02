"""Manual ordering (projects / Kanban) and project icons."""

from __future__ import annotations

from tests.conftest import Ctx
from tests.test_api import mkproject


def titles(ctx: Ctx, **params) -> list[str]:
    return [p["title"] for p in ctx.client.get("/api/v1/projects", params=params).json()["items"]]


def test_projects_follow_creation_then_manual_order(ctx: Ctx):
    a, b, c = (mkproject(ctx, title=n, priority=pr) for n, pr in (("A", "low"), ("B", "critical"), ("C", "medium")))
    assert titles(ctx) == ["A", "B", "C"]                          # default = manual = creation order
    assert titles(ctx, sort="priority") == ["B", "C", "A"]         # other sorts still work
    before = ctx.client.get(f"/api/v1/projects/{b['id']}").json()
    r = ctx.client.post("/api/v1/projects/reorder", json={"ids": [c["id"], a["id"]]}, headers=ctx.csrf)
    assert r.status_code == 204
    assert titles(ctx) == ["C", "A", "B"]                          # unlisted projects keep their place after
    after = ctx.client.get(f"/api/v1/projects/{b['id']}").json()
    # a reorder is not an edit: no version bump, updated_at untouched, no activity noise
    assert after["version"] == before["version"] and after["updated_at"] == before["updated_at"]
    events = ctx.client.get("/api/v1/dashboard/activity", params={"limit": 100}).json()["items"]
    assert not any("reorder" in e["summary"].lower() for e in events)


def test_reorder_rejects_unknown_ids(ctx: Ctx):
    a = mkproject(ctx, title="A")
    r = ctx.client.post("/api/v1/projects/reorder", json={"ids": [a["id"], 99999]}, headers=ctx.csrf)
    assert r.status_code == 404
    assert ctx.client.post("/api/v1/projects/reorder", json={"ids": []}, headers=ctx.csrf).status_code == 422


def test_project_icon_and_colour(ctx: Ctx):
    p = mkproject(ctx, title="Robots", icon="bot", color="#3E63DD")
    assert (p["icon"], p["color"]) == ("bot", "#3e63dd")
    r = ctx.client.patch(f"/api/v1/projects/{p['id']}", json={"icon": "microscope", "color": ""}, headers=ctx.csrf)
    assert r.status_code == 200 and (r.json()["icon"], r.json()["color"]) == ("microscope", "")
    for bad in ({"icon": "<svg>"}, {"color": "red"}, {"color": "#12345"}):
        assert ctx.client.patch(f"/api/v1/projects/{p['id']}", json=bad, headers=ctx.csrf).status_code == 422


def test_task_sort_order_appends_and_moves(ctx: Ctx):
    p = mkproject(ctx)
    mk = lambda title: ctx.client.post("/api/v1/tasks", json={"project_id": p["id"], "title": title}, headers=ctx.csrf).json()
    a, b, c = mk("a"), mk("b"), mk("c")
    assert a["sort_order"] < b["sort_order"] < c["sort_order"]
    # move c between a and b, and to another column, in one PATCH
    mid = (a["sort_order"] + b["sort_order"]) / 2
    r = ctx.client.patch(f"/api/v1/tasks/{c['id']}", json={"sort_order": mid, "status": "in_progress"}, headers=ctx.csrf)
    assert r.status_code == 200 and r.json()["sort_order"] == mid and r.json()["status"] == "in_progress"
    got = ctx.client.get("/api/v1/tasks", params={"project_id": p["id"], "sort": "sort_order"}).json()["items"]
    assert [x["title"] for x in got] == ["a", "c", "b"]
    # a pure reorder does not create a 'task_updated' event
    ctx.client.patch(f"/api/v1/tasks/{a['id']}", json={"sort_order": 1.5}, headers=ctx.csrf)
    events = ctx.client.get("/api/v1/dashboard/activity", params={"limit": 100}).json()["items"]
    assert not any(e["event_type"] == "task_updated" for e in events)
