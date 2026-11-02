#!/usr/bin/env python3
"""End-to-end acceptance test for a running ResearchOS instance with an EMPTY database.

Drives the real web UI (Playwright/Chromium), the REST API and the MCP endpoint (official
MCP Python client over Streamable HTTP), following README "Acceptance scenario":

  1. create three projects in the web UI          6. see that experiment in the web UI
  2. add a milestone + task to each via the UI     7. MCP query: unfinished tasks due in 7 days
  3. see all three in the Portfolio                9. read-only token cannot write (REST + MCP)
  4. REST: create a progress entry                10. edit / filter / view in the browser
  5. MCP: record an experiment run

Usage (from backend/ with the dev venv):
  .venv/bin/python ../scripts/e2e_acceptance.py --base http://127.0.0.1:8000 --password '<admin password>'
Writes ./e2e-state.json (tokens) so scripts/acceptance-docker.sh can re-check persistence.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

import httpx
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from playwright.sync_api import Page, expect, sync_playwright

PROJECTS = [
    ("Humanoid Whole-Body Manipulation", "experimentation"),
    ("Multi-Agent Quadruped Soccer", "analysis"),
    ("Humanoid Data Generation", "research_design"),
]


def step(msg: str) -> None:
    print(f"✔ {msg}", flush=True)


def ui_create_project(page: Page, base: str, title: str, stage: str) -> None:
    page.goto(f"{base}/projects")
    page.get_by_role("button", name="New project").click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Title").fill(title)
    dlg.get_by_label("Stage").select_option(stage)
    dlg.get_by_role("button", name="Create project").click()
    expect(page.get_by_role("heading", name=title)).to_be_visible()


def ui_add_milestone_and_task(page: Page, i: int) -> None:
    due = (date.today() + timedelta(days=3 + i)).isoformat()
    page.get_by_role("tab", name="Milestones").click()
    page.get_by_role("button", name="Milestone", exact=True).click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Title").fill(f"Milestone {i + 1}: first results")
    dlg.get_by_label("Due date").fill((date.today() + timedelta(days=20)).isoformat())
    dlg.get_by_role("button", name="Add milestone").click()
    expect(page.get_by_text(f"Milestone {i + 1}: first results")).to_be_visible()

    page.get_by_role("tab", name="Tasks").click()
    page.get_by_role("button", name="Task", exact=True).click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Title").fill(f"Task {i + 1}: run baseline")
    dlg.get_by_label("Deadline").fill(due)
    dlg.get_by_label("Priority").select_option("high")
    dlg.get_by_role("button", name="Create task").click()
    expect(page.get_by_text(f"Task {i + 1}: run baseline")).to_be_visible()


def ui_create_token(page: Page, base: str, name: str, scope: str) -> str:
    page.goto(f"{base}/settings")
    page.get_by_role("button", name="New token").click()
    dlg = page.get_by_role("dialog")
    dlg.get_by_label("Name").fill(name)
    dlg.get_by_label("Scope").select_option(scope)
    dlg.get_by_role("button", name="Create token").click()
    token = dlg.locator("pre").inner_text().strip()
    dlg.get_by_role("button", name="Done").click()
    assert token.startswith("ros_"), token
    return token


async def mcp_call(base: str, token: str, tool: str, args: dict) -> tuple[bool, dict | str]:
    async with httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30) as http:
        async with Client(streamable_http_client(f"{base}/mcp", http_client=http), mode="legacy") as c:
            r = await c.call_tool(tool, args)
            if r.is_error:
                return False, r.content[0].text
            return True, r.structured_content or json.loads(r.content[0].text)


def mcp(base: str, token: str, tool: str, args: dict) -> tuple[bool, dict | str]:
    """Run the async MCP client in its own thread (Playwright's sync API owns this thread's loop)."""
    with ThreadPoolExecutor(1) as ex:
        return ex.submit(asyncio.run, mcp_call(base, token, tool, args)).result()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000")
    ap.add_argument("--username", default="admin")
    ap.add_argument("--password", required=True)
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--state-file", default="e2e-state.json")
    a = ap.parse_args()
    base = a.base.rstrip("/")

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=not a.headed)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(base)
        page.get_by_label("Username").fill(a.username)
        page.get_by_label("Password").fill(a.password)
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_text("Active Projects")).to_be_visible()
        expect(page.get_by_text("No research projects yet")).to_be_visible()
        step("logged in; database is empty")

        for i, (title, stage) in enumerate(PROJECTS):
            ui_create_project(page, base, title, stage)
            ui_add_milestone_and_task(page, i)
        step("1–2. created 3 projects, each with a milestone and a task, via the web UI")

        page.goto(base)
        expect(page.get_by_test_id("project-card")).to_have_count(3)
        for title, _ in PROJECTS:
            expect(page.get_by_test_id("project-card").filter(has_text=title)).to_be_visible()
        step("3. portfolio shows all three projects")

        rw = ui_create_token(page, base, "codex-e2e", "write")
        ro = ui_create_token(page, base, "readonly-e2e", "read")
        step("created read/write and read-only tokens in Settings")

        r = httpx.post(f"{base}/api/v1/projects/multi-agent-quadruped-soccer/progress", headers={"Authorization": f"Bearer {rw}"},
                       json={"summary": "E2E: REST progress note"})
        assert r.status_code == 201, r.text
        step("4. REST API created a progress entry")

        ok, res = mcp(base, rw, "record_experiment", {
            "project": "multi-agent-quadruped-soccer", "experiment_key": "ablation-no-world-model",
            "experiment_name": "Ablation: no world model", "group_name": "World-model ablations",
            "external_run_id": "e2e-run-seed0", "seed": 0, "git_commit": "abc1234",
            "metrics": {"goal_rate": {"value": 0.52, "unit": "goals/episode"}},
        })
        assert ok, res
        exp_id = res["experiment_id"]
        ok2, res2 = mcp(base, rw, "record_experiment", {
            "project": "multi-agent-quadruped-soccer", "experiment_key": "ablation-no-world-model",
            "external_run_id": "e2e-run-seed0", "metrics": {"goal_rate": 0.52},
        })
        assert ok2 and res2["run_created"] is False and res2["run_count"] == 1, res2
        step("5. MCP recorded an experiment + run (idempotent on retry)")

        page.goto(f"{base}/experiments")
        expect(page.get_by_text("Ablation: no world model")).to_be_visible()
        page.goto(f"{base}/experiments/{exp_id}")
        expect(page.get_by_text("e2e-run-seed0")).to_be_visible()
        expect(page.get_by_text("Needs Review").first).to_be_visible()
        page.goto(base)
        expect(page.get_by_text("E2E: REST progress note")).to_be_visible()
        step("6. web UI shows the MCP experiment and the REST progress note")

        week = (date.today() + timedelta(days=7)).isoformat()
        ok, res = mcp(base, ro, "query_work", {"resource_type": "task", "due_before": week})
        assert ok and res["total"] == 3, res
        step(f"7. MCP query: {res['total']} unfinished tasks due within 7 days across projects")

        ok, res = mcp(base, ro, "log_progress", {"project": "humanoid-data-generation", "summary": "should fail"})
        assert not ok and "insufficient_scope" in str(res), res
        r = httpx.post(f"{base}/api/v1/tasks", headers={"Authorization": f"Bearer {ro}"}, json={"project_id": 1, "title": "x"})
        assert r.status_code == 403, r.text
        step("9. read-only token is rejected for writes (MCP and REST)")

        page.goto(f"{base}/projects/humanoid-data-generation")
        page.get_by_label("Research stage").select_option("implementation")
        expect(page.get_by_text("Research stage → Implementation")).to_be_visible()
        page.goto(f"{base}/tasks")
        page.get_by_role("tab", name="Due in 7 days").click()
        expect(page.locator("tbody tr")).to_have_count(3)
        page.get_by_label("Search tasks").fill("Task 2")
        expect(page.locator("tbody tr")).to_have_count(1)
        page.goto(f"{base}/timeline")
        expect(page.get_by_text("Task 1: run baseline")).to_be_visible()
        page.goto(f"{base}/activity")
        page.get_by_label("Source").select_option("codex")
        expect(page.get_by_text("E2E: REST progress note")).to_be_visible()
        step("10. browser editing, filtering, timeline and activity views work")

        assert not errors, errors
        browser.close()

    with open(a.state_file, "w") as f:
        json.dump({"ro_token": ro, "experiment_id": exp_id}, f)
    print("\nACCEPTANCE: ALL STEPS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
