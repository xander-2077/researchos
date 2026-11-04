"""MCP integration tests over real Streamable HTTP (uvicorn + official MCP client)."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import date, timedelta

import httpx
import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from tests.conftest import LiveServer

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend():
    return "asyncio"


@asynccontextmanager
async def mcp_client(url: str, token: str | None, mode: str = "legacy"):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx2.AsyncClient(headers=headers, timeout=30) as http:
        async with Client(streamable_http_client(f"{url}/mcp", http_client=http), mode=mode) as c:
            yield c


def payload(result) -> dict:
    assert not result.is_error, result.content[0].text
    if result.structured_content is not None:
        sc = result.structured_content
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc
    return json.loads(result.content[0].text)


def error_text(result) -> str:
    assert result.is_error
    return result.content[0].text


def seed(ls: LiveServer) -> dict:
    c, h = ls.client, ls.csrf
    p = c.post("/api/v1/projects", json={"title": "Quadruped Soccer", "slug": "quadruped-soccer",
                                         "stage": "experimentation"}, headers=h).json()
    c.post("/api/v1/projects", json={"title": "Humanoid WBM"}, headers=h)
    soon = (date.today() + timedelta(days=3)).isoformat()
    later = (date.today() + timedelta(days=30)).isoformat()
    c.post("/api/v1/tasks", json={"project_id": p["id"], "title": "Run seeds", "due_date": soon}, headers=h)
    c.post("/api/v1/tasks", json={"project_id": p["id"], "title": "Write paper", "due_date": later}, headers=h)
    c.post("/api/v1/tasks", json={"project_id": p["id"], "title": "Done thing", "due_date": soon, "status": "done"}, headers=h)
    return p


async def test_http_auth_required(live_server: LiveServer):
    async with httpx.AsyncClient() as h:
        r = await h.post(f"{live_server.url}/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
        assert r.status_code == 401
        r = await h.post(f"{live_server.url}/mcp", json={}, headers={"Authorization": "Bearer ros_invalid"})
        assert r.status_code == 401


async def test_connect_and_list_tools(live_server: LiveServer):
    async with mcp_client(live_server.url, live_server.ro_token) as c:
        tools = {t.name: t for t in (await c.list_tools()).tools}
    assert set(tools) == {"list_projects", "get_project", "query_work", "upsert_task", "upsert_milestone",
                          "record_experiment", "log_progress", "update_project"}
    assert tools["list_projects"].annotations.read_only_hint is True
    assert tools["log_progress"].annotations.read_only_hint is False
    assert "project" in tools["upsert_task"].input_schema["properties"]


async def test_read_tools(live_server: LiveServer):
    p = seed(live_server)
    async with mcp_client(live_server.url, live_server.ro_token) as c:
        res = payload(await c.call_tool("list_projects", {}))
        assert res["total"] == 2
        soccer = next(x for x in res["projects"] if x["slug"] == "quadruped-soccer")
        assert soccer["milestone_progress"] == "not set" and soccer["open_tasks"] == 2
        res = payload(await c.call_tool("list_projects", {"stage": "experimentation"}))
        assert [x["slug"] for x in res["projects"]] == ["quadruped-soccer"]

        proj = payload(await c.call_tool("get_project", {"project": "quadruped-soccer", "include": ["tasks", "deadlines"]}))
        assert proj["project_id"] == p["id"] and len(proj["open_tasks_list"]) == 2
        assert "recent_experiments" not in proj  # concise by default
        proj2 = payload(await c.call_tool("get_project", {"project": str(p["id"])}))
        assert proj2["slug"] == "quadruped-soccer"

        bad = await c.call_tool("get_project", {"project": "nope"})
        assert "not found" in error_text(bad)

        week = (date.today() + timedelta(days=7)).isoformat()
        res = payload(await c.call_tool("query_work", {"resource_type": "task", "due_before": week}))
        assert [i["title"] for i in res["items"]] == ["Run seeds"]
        res = payload(await c.call_tool("query_work", {"resource_type": "deadline", "due_before": week}))
        assert [i["title"] for i in res["items"]] == ["Run seeds"]


async def test_readonly_token_cannot_write(live_server: LiveServer):
    seed(live_server)
    async with mcp_client(live_server.url, live_server.ro_token) as c:
        for name, args in [
            ("log_progress", {"project": "quadruped-soccer", "summary": "x"}),
            ("upsert_task", {"project": "quadruped-soccer", "title": "x"}),
            ("record_experiment", {"project": "quadruped-soccer", "experiment_key": "k", "experiment_name": "n"}),
            ("update_project", {"project": "quadruped-soccer", "priority": "high"}),
            ("upsert_milestone", {"project": "quadruped-soccer", "title": "m"}),
        ]:
            assert "insufficient_scope" in error_text(await c.call_tool(name, args)), name
    tasks = live_server.client.get("/api/v1/tasks?q=x", headers=live_server.csrf).json()
    assert tasks["total"] == 0


async def test_write_tools_end_to_end(live_server: LiveServer):
    p = seed(live_server)
    async with mcp_client(live_server.url, live_server.rw_token) as c:
        # tasks: create, update by id, idempotent by client_key
        t = payload(await c.call_tool("upsert_task", {"project": "quadruped-soccer", "title": "Sim ablation",
                                                       "priority": "high", "client_key": "sim-abl"}))
        assert t["created"] is True
        t2 = payload(await c.call_tool("upsert_task", {"project": "quadruped-soccer", "task_id": t["task_id"], "status": "in_progress"}))
        assert t2["created"] is False and t2["status"] == "in_progress" and t2["priority"] == "high"
        t3 = payload(await c.call_tool("upsert_task", {"project": "quadruped-soccer", "client_key": "sim-abl", "status": "done"}))
        assert t3["task_id"] == t["task_id"] and t3["status"] == "done"
        assert "title is required" in error_text(await c.call_tool("upsert_task", {"project": "quadruped-soccer"}))

        # milestones
        m = payload(await c.call_tool("upsert_milestone", {"project": "quadruped-soccer", "title": "Ablations done",
                                                            "due_date": (date.today() + timedelta(days=5)).isoformat()}))
        m2 = payload(await c.call_tool("upsert_milestone", {"project": "quadruped-soccer", "milestone_id": m["milestone_id"], "status": "completed"}))
        assert m2["status"] == "completed"

        # experiments: create + run; repeat → no duplicates
        args = {"project": "quadruped-soccer", "experiment_key": "ablation-no-world-model",
                "experiment_name": "Ablation: no world model", "group_name": "World-model ablations",
                "variant": "remove world model", "external_run_id": "wandb-123", "seed": 0, "git_commit": "abc1234",
                "metrics": {"goal_rate": {"value": 0.52, "unit": "goals/ep"}}, "config": {"lr": 0.0003}}
        e1 = payload(await c.call_tool("record_experiment", args))
        e2 = payload(await c.call_tool("record_experiment", args))
        assert e1["experiment_created"] and e1["run_created"]
        assert not e2["experiment_created"] and not e2["run_created"]
        assert e1["run_id"] == e2["run_id"] and e2["run_count"] == 1
        assert e1["experiment_status"] == "needs_review" and e1["verification_status"] == "needs_review"
        e3 = payload(await c.call_tool("record_experiment", {**args, "external_run_id": "wandb-124", "seed": 1}))
        assert e3["run_count"] == 2
        # agents cannot verify
        rej = await c.call_tool("record_experiment", {"project": "quadruped-soccer", "experiment_key": "ablation-no-world-model", "status": "verified"})
        assert rej.is_error
        # run data without external_run_id is rejected (no silent duplicates)
        rej = await c.call_tool("record_experiment", {"project": "quadruped-soccer", "experiment_key": "x", "experiment_name": "x", "metrics": {"a": 1}})
        assert "external_run_id is required" in error_text(rej)

        # progress
        lp = payload(await c.call_tool("log_progress", {"project": "quadruped-soccer",
                                                         "summary": "Finished WBC base compensation; next: sim ablations"}))
        assert lp["source"] == "claude_code"

        # update_project: high-impact requires confirm
        up = payload(await c.call_tool("update_project", {"project": "quadruped-soccer", "health_status": "at_risk",
                                                           "next_action": "Re-run seeds"}))
        assert set(up["changed"]) == {"health_status", "next_action"}
        assert "confirmation_required" in error_text(await c.call_tool("update_project", {"project": "quadruped-soccer", "research_stage": "completed"}))

        # cross-project deadline query
        week = (date.today() + timedelta(days=7)).isoformat()
        dl = payload(await c.call_tool("query_work", {"resource_type": "deadline", "due_before": week}))
        assert "Run seeds" in [i["title"] for i in dl["items"]]

    # Web/REST sees the MCP writes immediately (same DB + services).
    api = live_server.client
    exps = api.get(f"/api/v1/experiments?project_id={p['id']}", headers=live_server.csrf).json()
    assert exps["total"] == 1 and exps["items"][0]["run_count"] == 2
    acts = api.get(f"/api/v1/dashboard/activity?project_id={p['id']}&source=claude_code", headers=live_server.csrf).json()
    types = {a["event_type"] for a in acts["items"]}
    assert {"task_created", "task_completed", "experiment_created", "run_recorded", "progress_note", "health_changed"} <= types


async def test_modern_protocol_mode(live_server: LiveServer):
    """The SDK's newest protocol path (auto-negotiated) also authenticates correctly."""
    seed(live_server)
    async with mcp_client(live_server.url, live_server.ro_token, mode="auto") as c:
        res = payload(await c.call_tool("list_projects", {}))
        assert res["total"] == 2
        assert "insufficient_scope" in error_text(await c.call_tool("log_progress", {"project": "quadruped-soccer", "summary": "x"}))


async def test_deadline_query_filters_before_truncating(live_server: LiveServer):
    """Regression: priority was applied *after* `limit`, hiding a critical task behind an earlier low one."""
    c, h = live_server.client, live_server.csrf
    p = c.post("/api/v1/projects", json={"title": "Deadlines"}, headers=h).json()
    d = lambda n: (date.today() + timedelta(days=n)).isoformat()  # noqa: E731
    for title, prio, due in [("low tomorrow", "low", d(1)), ("critical day after", "critical", d(2)), ("high later", "high", d(3))]:
        c.post("/api/v1/tasks", json={"project_id": p["id"], "title": title, "priority": prio, "due_date": due}, headers=h)
    async with mcp_client(live_server.url, live_server.ro_token) as cl:
        res = payload(await cl.call_tool("query_work", {"resource_type": "deadline", "priority": "critical", "limit": 1}))
        assert res["total"] == 1 and [i["title"] for i in res["items"]] == ["critical day after"]
        res = payload(await cl.call_tool("query_work", {"resource_type": "deadline", "priority": "critical,high", "limit": 1}))
        assert res["total"] == 2 and len(res["items"]) == 1  # total counts matches, items respects limit
        res = payload(await cl.call_tool("query_work", {"resource_type": "deadline", "keyword": "later", "limit": 1}))
        assert res["total"] == 1 and res["items"][0]["title"] == "high later"
        res = payload(await cl.call_tool("query_work", {"resource_type": "deadline", "limit": 2}))
        assert res["total"] == 3 and len(res["items"]) == 2


async def test_get_project_with_mixed_unit_metrics(live_server: LiveServer):
    c, h = live_server.client, live_server.csrf
    p = c.post("/api/v1/projects", json={"title": "Units"}, headers=h).json()
    e = c.post("/api/v1/experiments", json={"project_id": p["id"], "name": "Latency"}, headers=h).json()
    for i, (v, u) in enumerate([(1, "s"), (1000, "ms")]):
        c.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": f"r{i}", "metrics": {"latency": {"value": v, "unit": u}}}, headers=h)
    async with mcp_client(live_server.url, live_server.ro_token) as cl:
        res = payload(await cl.call_tool("get_project", {"project": "units", "include": ["experiments"]}))
    m = res["recent_experiments"][0]["metrics"]["latency"]
    assert m == {"mixed_units": ["ms", "s"], "n": 2}  # no misleading mean


async def test_standalone_task_mcp_roundtrip(live_server: LiveServer):
    async with mcp_client(live_server.url, live_server.rw_token) as c:
        first = payload(await c.call_tool("upsert_task", {"title": "Read methods", "client_key": "methods"}))
        assert first["project"] is None and first["created"]
        retry = payload(await c.call_tool("upsert_task", {"project": None, "title": "Read more", "client_key": "methods"}))
        assert retry["task_id"] == first["task_id"] and not retry["created"]
        found = payload(await c.call_tool("query_work", {"keyword": "Read more"}))
        assert found["total"] == 1 and found["items"][0]["project"] is None
        updated = payload(await c.call_tool("upsert_task", {"task_id": first["task_id"], "status": "done"}))
        assert updated["status"] == "done"
