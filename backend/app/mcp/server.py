"""ResearchOS MCP server (mcp SDK 2.x ``MCPServer``, formerly FastMCP).

All tools call the shared service layer — the same code path as the REST API —
so validation, permission checks, transactions and activity logging are identical.

Authentication: every call carries ``Authorization: Bearer <token>`` (HTTP) or uses
``RESEARCHOS_TOKEN`` (stdio). The token is re-validated inside each tool so read-only
tokens can never write, regardless of transport.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import date
from typing import Annotated, Any, Literal, TypeVar

import anyio.to_thread
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp_types import ToolAnnotations
from pydantic import Field, ValidationError
from sqlalchemy.orm import Session

from app.api.deps import actor_from_bearer
from app.auth.actor import Actor
from app.core.enums import Health, MilestoneStatus, Priority, Stage, TaskStatus
from app.core.errors import AppError, Unauthorized
from app.database.session import SessionLocal
from app.schemas.entities import ProgressCreate, ProjectUpdate
from app.services import activity as act_svc
from app.services import dashboard as dash_svc
from app.services import experiments as exp_svc
from app.services import milestones as ms_svc
from app.services import projects as proj_svc
from app.services import tasks as task_svc

T = TypeVar("T")

INSTRUCTIONS = """\
ResearchOS stores the user's research portfolio: projects, milestones, tasks, experiments
(with runs/seeds) and an append-only progress log. Use it as the source of truth for
research context instead of conversation memory.

Guidelines:
- Read first: list_projects / get_project / query_work. Reads never modify data.
- Log meaningful progress with log_progress (not every small code edit).
- Record experiment results with record_experiment; always pass a stable external_run_id
  so retries update the same run. Results land in 'needs_review'. Never claim a result is
  verified — only the researcher can verify in the web UI.
- Only submit results backed by evidence (logs, metrics, commits). Never invent numbers.
- High-impact changes (completing/archiving a project, changing research question or
  hypothesis, overwriting verified results) require confirm=true after asking the user.
- Never store secrets, credentials or sensitive raw data in ResearchOS.
"""

mcp = MCPServer(
    name="researchos",
    title="ResearchOS",
    description="Research portfolio management: projects, tasks, milestones, experiments, progress log.",
    instructions=INSTRUCTIONS,
    version="0.1.0",
)

READ = ToolAnnotations(read_only_hint=True, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
WRITE_IDEMPOTENT = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=False)
APPEND = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=False, open_world_hint=False)

AgentSource = Literal["claude_code", "codex", "mcp"]


# ---------------------------------------------------------------------------- plumbing
def _stdio_token() -> str | None:
    return os.environ.get("RESEARCHOS_TOKEN")


def _authenticate(db: Session, ctx: Context | None) -> Actor:
    headers = None
    if ctx is not None:
        try:
            headers = ctx.headers
        except Exception:  # noqa: BLE001 - no request context (stdio)
            headers = None
    if headers is not None and headers.get("authorization"):
        return actor_from_bearer(db, headers["authorization"], headers.get("x-researchos-source"), "mcp")
    token = _stdio_token()
    if token and headers is None:
        return actor_from_bearer(db, f"Bearer {token}", os.environ.get("RESEARCHOS_SOURCE"), "mcp")
    raise Unauthorized("Missing bearer token")


async def _run(ctx: Context | None, fn: Callable[[Session, Actor], T]) -> T:
    def work() -> T:
        db = SessionLocal()
        try:
            actor = _authenticate(db, ctx)
            return fn(db, actor)
        except AppError as e:
            db.rollback()
            hint = f" Details: {e.details}" if e.details else ""
            raise ToolError(f"[{e.code}] {e.message}{hint}") from None
        except ValidationError as e:
            db.rollback()
            msgs = "; ".join(f"{'.'.join(str(p) for p in err['loc'])}: {err['msg']}" for err in e.errors())
            raise ToolError(f"[validation_error] {msgs}") from None
        finally:
            db.close()

    return await anyio.to_thread.run_sync(work)


def _iso(v: Any) -> Any:
    return v.isoformat() if hasattr(v, "isoformat") else v


def _project_brief(s: dict[str, Any]) -> dict[str, Any]:
    nd = s["next_deadline"]
    blockers = s["blocker_summary"] or ("; ".join(s["blocked_tasks"]) if s["blocked_tasks"] else "")
    return {
        "project_id": s["id"],
        "slug": s["slug"],
        "name": s["title"],
        "stage": s["stage"],
        "health": s["health_status"],
        "priority": s["priority"],
        "milestone_progress": f"{s['milestone_progress']['completed']}/{s['milestone_progress']['total']}"
        if s["milestone_progress"]["total"] else "not set",
        "next_deadline": {"kind": nd["kind"], "title": nd["title"], "due_date": _iso(nd["due_date"])} if nd else None,
        "next_action": s["next_action"],
        "blockers": blockers,
        "open_tasks": s["open_task_count"],
        "archived": s["archived"],
    }


ProjectRef = Annotated[str, Field(description="Project id (e.g. '3') or slug (e.g. 'quadruped-soccer').")]


# ---------------------------------------------------------------------------- read tools
@mcp.tool(annotations=READ)
async def list_projects(
    ctx: Context,
    stage: Annotated[Stage | None, Field(description="Filter by research stage")] = None,
    health_status: Annotated[Health | None, Field(description="Filter by health")] = None,
    priority: Annotated[Priority | None, Field(description="Filter by priority")] = None,
    archived: Annotated[bool, Field(description="true = archived projects only")] = False,
) -> dict[str, Any]:
    """Portfolio overview: every project's stage, health, milestone progress, next deadline,
    next action and blockers. Read-only."""

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        items, total, *_ = proj_svc.list_projects(
            db, actor, stage=stage, health_status=health_status, priority=priority, archived=archived, limit=100
        )
        return {"total": total, "projects": [_project_brief(s) for s in items]}

    return await _run(ctx, fn)


@mcp.tool(annotations=READ)
async def get_project(
    ctx: Context,
    project: ProjectRef,
    include: Annotated[
        list[Literal["milestones", "tasks", "experiments", "progress", "deadlines"]],
        Field(description="Extra sections to include. Default: concise summary only."),
    ] = [],  # noqa: B006
    limit: Annotated[int, Field(ge=1, le=50, description="Max items per included section")] = 10,
) -> dict[str, Any]:
    """Project details by id or slug: research question, hypothesis, venue, deadline, stage,
    next action, blockers. Optionally include milestones, open tasks, recent experiments,
    recent progress and upcoming deadlines. Use this to restore context on a project."""

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        actor.require_read()
        p = proj_svc.resolve_project(db, project)
        s = proj_svc.project_summary(db, p)
        out: dict[str, Any] = {
            **_project_brief(s),
            "description": p.description,
            "research_question": p.research_question,
            "hypothesis": p.hypothesis,
            "target_venue": p.target_venue,
            "submission_deadline": _iso(p.submission_deadline),
            "repository_url": p.repository_url,
            "last_activity_at": _iso(s["last_activity_at"]),
            "updated_at": _iso(p.updated_at),
            "version": p.version,
        }
        if "milestones" in include:
            out["milestones"] = [
                {"milestone_id": m.id, "title": m.title, "status": m.status, "due_date": _iso(m.due_date),
                 "completed_at": _iso(m.completed_at)}
                for m in ms_svc.list_milestones(db, actor, p.id)[:limit]
            ]
        if "tasks" in include:
            rows, total, *_ = task_svc.list_tasks(db, actor, project_id=p.id, open_only=True, limit=limit)
            out["open_tasks_list"] = [
                {"task_id": t.id, "title": t.title, "status": t.status, "priority": t.priority,
                 "start_date": _iso(t.start_date), "due_date": _iso(t.due_date), "depends_on": t.depends_on,
                 "milestone_id": t.milestone_id} for t in rows]
        if "experiments" in include:
            rows, *_ = exp_svc.list_experiments(db, actor, project_id=p.id, sort="-updated_at", limit=limit)
            out["recent_experiments"] = [
                {"experiment_id": e.id, "experiment_key": e.experiment_key, "name": e.name, "group": e.group_name,
                 "status": e.status, "runs": len(e.runs), "conclusion": e.conclusion,
                 "metrics": {
                     k: ({"mixed_units": v["units"], "n": v["n"]} if v["mixed_units"]
                         else {"mean": round(v["mean"], 6), "std": round(v["std"], 6), "n": v["n"], "unit": v["unit"]})
                     for k, v in exp_svc.metric_summary(list(e.runs)).items()}}
                for e in rows]
        if "progress" in include:
            rows, *_ = act_svc.list_events(db, actor, project_id=p.id, limit=limit)
            out["recent_progress"] = [
                {"event_id": e.id, "at": _iso(e.created_at), "type": e.event_type, "summary": e.summary,
                 "source": e.source} for e in rows]
        if "deadlines" in include:
            out["deadlines"] = [
                {"kind": d["kind"], "id": d["id"], "title": d["title"], "due_date": _iso(d["due_date"]),
                 "overdue": d["overdue"]}
                for d in dash_svc.deadlines_between(db, actor, date.today(), None, project_id=p.id, limit=limit)]
        return out

    return await _run(ctx, fn)


@mcp.tool(annotations=READ)
async def query_work(
    ctx: Context,
    resource_type: Annotated[
        Literal["task", "milestone", "experiment", "deadline"],
        Field(description="What to query. 'deadline' merges submission, milestone and task due dates."),
    ] = "task",
    project: Annotated[str | None, Field(description="Project id or slug; omit for all projects")] = None,
    status: Annotated[str | None, Field(description="Comma-separated statuses. Omit for open/unfinished items.")] = None,
    due_before: Annotated[date | None, Field(description="Inclusive upper bound, YYYY-MM-DD")] = None,
    due_after: Annotated[date | None, Field(description="Inclusive lower bound, YYYY-MM-DD")] = None,
    priority: Annotated[str | None, Field(description="Comma-separated: low,medium,high,critical")] = None,
    keyword: Annotated[str | None, Field(description="Substring match on title/description")] = None,
    limit: Annotated[int, Field(ge=1, le=100)] = 25,
) -> dict[str, Any]:
    """Cross-project query for tasks, milestones, experiments or deadlines. Examples:
    unfinished tasks due in the next 7 days → resource_type='task', due_before=<today+7>;
    blocked tasks → status='blocked'; experiment-related tasks this week → keyword='experiment'.
    Due-date filters do not apply to experiments. Read-only."""

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        pid = proj_svc.resolve_project(db, project).id if project else None
        res = dash_svc.query_work(
            db, actor, resource_type=resource_type, project_id=pid, status=status, due_before=due_before,
            due_after=due_after, priority=priority, keyword=keyword, limit=limit,
        )
        res["items"] = [{k: _iso(v) for k, v in i.items()} for i in res["items"]]
        res["today"] = date.today().isoformat()
        return res

    return await _run(ctx, fn)


# ---------------------------------------------------------------------------- write tools
@mcp.tool(annotations=WRITE_IDEMPOTENT)
async def upsert_task(
    ctx: Context,
    project: ProjectRef,
    task_id: Annotated[int | None, Field(description="Existing task id to update")] = None,
    client_key: Annotated[
        str | None,
        Field(max_length=120, description="Your stable idempotency key; same key in the same project updates the same task"),
    ] = None,
    title: Annotated[str | None, Field(max_length=300, description="Required when creating")] = None,
    description: str | None = None,
    status: TaskStatus | None = None,
    priority: Priority | None = None,
    due_date: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
    start_date: Annotated[date | None, Field(description="YYYY-MM-DD; must not be after due_date. Drives the Gantt bar")] = None,
    depends_on: Annotated[
        list[int] | None,
        Field(description="Task ids in the same project that must finish first (replaces the whole list; [] clears)"),
    ] = None,
    milestone_id: int | None = None,
    tags: list[str] | None = None,
    git_reference: Annotated[str | None, Field(description="Commit SHA, branch or PR URL")] = None,
) -> dict[str, Any]:
    """Create or update a task. Update by task_id, or by client_key; otherwise create.
    Only fields you pass are changed."""

    fields = {k: v for k, v in {
        "title": title, "description": description, "status": status, "priority": priority,
        "due_date": due_date, "start_date": start_date, "depends_on": depends_on,
        "milestone_id": milestone_id, "tags": tags, "git_reference": git_reference,
    }.items() if v is not None}

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        p = proj_svc.resolve_project(db, project)
        t, created = task_svc.upsert_task(db, actor, p.id, task_id, client_key, fields)
        return {
            "task_id": t.id, "project": p.slug, "created": created, "title": t.title, "status": t.status,
            "priority": t.priority, "start_date": _iso(t.start_date), "due_date": _iso(t.due_date),
            "depends_on": t.depends_on, "milestone_id": t.milestone_id,
            "summary": f"{'Created' if created else 'Updated'} task #{t.id} '{t.title}' ({t.status})"
            + ("" if created else f"; fields: {', '.join(sorted(fields)) or 'none'}"),
        }

    return await _run(ctx, fn)


@mcp.tool(annotations=WRITE_IDEMPOTENT)
async def upsert_milestone(
    ctx: Context,
    project: ProjectRef,
    milestone_id: Annotated[int | None, Field(description="Existing milestone id to update; omit to create")] = None,
    title: Annotated[str | None, Field(max_length=200, description="Required when creating")] = None,
    description: Annotated[str | None, Field(description="Include a clear completion criterion")] = None,
    status: MilestoneStatus | None = None,
    due_date: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
) -> dict[str, Any]:
    """Create or update a milestone (a checkpoint with a clear completion criterion).
    Only fields you pass are changed."""

    fields = {k: v for k, v in {"title": title, "description": description, "status": status,
                                "due_date": due_date}.items() if v is not None}

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        p = proj_svc.resolve_project(db, project)
        if milestone_id is None and "title" not in fields:
            raise ToolError("[validation_error] title is required when creating a milestone")
        m, created = ms_svc.upsert_milestone(db, actor, p.id, milestone_id, fields)
        return {
            "milestone_id": m.id, "project": p.slug, "created": created, "title": m.title, "status": m.status,
            "due_date": _iso(m.due_date),
            "summary": f"{'Created' if created else 'Updated'} milestone #{m.id} '{m.title}' ({m.status})",
        }

    return await _run(ctx, fn)


@mcp.tool(annotations=WRITE_IDEMPOTENT)
async def record_experiment(
    ctx: Context,
    project: ProjectRef,
    experiment_key: Annotated[str, Field(max_length=120, description="Stable key for the experiment/condition, e.g. 'ablation-no-world-model'")],
    experiment_name: Annotated[str | None, Field(max_length=300, description="Required when creating")] = None,
    group_name: Annotated[str | None, Field(description="Ablation/experiment group, e.g. 'World-model ablations'")] = None,
    type: Annotated[Literal["main", "ablation", "baseline", "sweep", "sanity_check", "other"] | None, Field()] = None,
    hypothesis: str | None = None,
    baseline: Annotated[str | None, Field(description="What this condition is compared against")] = None,
    variant: Annotated[str | None, Field(description="What is changed in this condition")] = None,
    description: str | None = None,
    status: Annotated[
        Literal["planned", "running", "analyzing", "needs_review", "failed", "cancelled"] | None,
        Field(description="Experiment status. 'verified' is reserved for the researcher."),
    ] = None,
    conclusion: Annotated[str | None, Field(description="Short, evidence-based experiment-level conclusion")] = None,
    external_run_id: Annotated[
        str | None,
        Field(max_length=200, description="Stable run id (W&B/MLflow id or '<commit>-seed<seed>'). Required for run data; re-sending updates the same run."),
    ] = None,
    seed: int | None = None,
    git_commit: Annotated[str | None, Field(max_length=64)] = None,
    git_branch: str | None = None,
    environment: Annotated[str | None, Field(description="Simulator / robot / dataset")] = None,
    config: Annotated[dict[str, Any] | None, Field(description="Key hyper-parameters (small JSON, no secrets)")] = None,
    metrics: Annotated[
        dict[str, Any] | None,
        Field(description='{"success_rate": 0.82} or {"success_rate": {"value": 82, "unit": "%", "description": "..."}}'),
    ] = None,
    artifact_links: Annotated[list[str] | None, Field(description="URLs/paths to logs, videos, checkpoints (not uploads)")] = None,
    run_status: Literal["planned", "running", "completed", "failed", "cancelled"] | None = None,
    run_conclusion: Annotated[str | None, Field(description="Notes on this specific run")] = None,
    confirm_overwrite_verified: Annotated[bool, Field(description="Only after the user explicitly approves changing verified results")] = False,
) -> dict[str, Any]:
    """Create/update an experiment (by experiment_key) and optionally one run (by external_run_id)
    atomically. Idempotent: repeating the same call does not create duplicates. New results are
    marked needs_review; agents cannot mark anything verified."""

    params = {k: v for k, v in locals().items() if k not in ("ctx", "project")}

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        p = proj_svc.resolve_project(db, project)
        res = exp_svc.record_experiment(db, actor, p.id, params)
        e, r = res["experiment"], res["run"]
        out: dict[str, Any] = {
            "project": p.slug,
            "experiment_id": e.id,
            "experiment_key": e.experiment_key,
            "experiment_created": res["experiment_created"],
            "experiment_status": e.status,
            "run_count": len(e.runs),
        }
        parts = [f"{'Created' if res['experiment_created'] else 'Updated'} experiment '{e.name}' ({e.status})"]
        if r is not None:
            out.update(run_id=r.id, external_run_id=r.external_run_id, run_created=res["run_created"],
                       verification_status=r.verification_status, metrics=r.metrics_json)
            parts.append(f"{'recorded new' if res['run_created'] else 'updated existing'} run {r.external_run_id}")
        out["summary"] = "; ".join(parts)
        return out

    return await _run(ctx, fn)


@mcp.tool(annotations=APPEND)
async def log_progress(
    ctx: Context,
    project: ProjectRef,
    summary: Annotated[str, Field(min_length=1, max_length=1000, description="One or two sentences on what was achieved")],
    details: Annotated[str | None, Field(max_length=20000, description="Optional markdown details / next steps")] = None,
    related_resource_type: Literal["task", "milestone", "experiment", "run"] | None = None,
    related_resource_id: int | None = None,
    source: Annotated[AgentSource | None, Field(description="Which agent is writing (defaults from token/header)")] = None,
) -> dict[str, Any]:
    """Append a progress note to the project's research log (never overwrites history).
    Use after meaningful work — not for every small edit."""

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        p = proj_svc.resolve_project(db, project)
        ev = act_svc.add_progress(db, actor, p.id, ProgressCreate(
            summary=summary, details=details or "", related_resource_type=related_resource_type,
            related_resource_id=related_resource_id, source=source,
        ))
        return {"event_id": ev.id, "project": p.slug, "created_at": _iso(ev.created_at), "source": ev.source,
                "summary": f"Logged progress on '{p.title}'"}

    return await _run(ctx, fn)


@mcp.tool(annotations=WRITE_IDEMPOTENT)
async def update_project(
    ctx: Context,
    project: ProjectRef,
    research_stage: Stage | None = None,
    health_status: Health | None = None,
    priority: Priority | None = None,
    next_action: Annotated[str | None, Field(max_length=2000)] = None,
    blocker_summary: Annotated[str | None, Field(max_length=2000, description="Empty string clears blockers")] = None,
    target_venue: str | None = None,
    submission_deadline: Annotated[date | None, Field(description="YYYY-MM-DD")] = None,
    confirm: Annotated[
        bool,
        Field(description="Must be true for high-impact changes (e.g. research_stage='completed'). Ask the user first."),
    ] = False,
) -> dict[str, Any]:
    """Update a project's stage, health, priority, next action, blockers, venue or deadline.
    Only fields you pass are changed."""

    changes = {k: v for k, v in {
        "stage": research_stage, "health_status": health_status, "priority": priority,
        "next_action": next_action, "blocker_summary": blocker_summary, "target_venue": target_venue,
        "submission_deadline": submission_deadline,
    }.items() if v is not None}

    def fn(db: Session, actor: Actor) -> dict[str, Any]:
        p = proj_svc.resolve_project(db, project)
        before = {k: getattr(p, k) for k in changes}
        p = proj_svc.update_project(db, actor, p.id, ProjectUpdate(**changes, confirm=confirm))
        changed = {k: {"from": _iso(before[k]), "to": _iso(getattr(p, k))} for k in changes if before[k] != getattr(p, k)}
        return {"project_id": p.id, "project": p.slug, "changed": changed, "version": p.version,
                "summary": f"Updated {', '.join(changed) or 'nothing (values unchanged)'} on '{p.title}'"}

    return await _run(ctx, fn)
