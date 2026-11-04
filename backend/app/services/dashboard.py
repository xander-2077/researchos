"""Cross-project aggregation: summary cards, deadlines, unified work query."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.auth.actor import Actor
from app.core.enums import OPEN_MILESTONE_STATUSES, OPEN_TASK_STATUSES, PRIORITY_RANK
from app.core.errors import ValidationFailed
from app.models import Experiment, Milestone, Project, Task
from app.repositories.base import clamp_limit
from app.services import experiments as exp_svc
from app.services import tasks as task_svc

DEADLINE_KINDS = ("submission", "milestone", "task")


def summary(db: Session, actor: Actor, horizon_days: int = 14) -> dict[str, int]:
    actor.require_read()
    today = date.today()
    horizon = today + timedelta(days=horizon_days)
    live = Project.archived.is_(False)
    live_task = Task.project_id.is_(None) | live

    def count(stmt) -> int:  # noqa: ANN001
        return db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    deadlines = deadlines_between(db, actor, today, horizon, include_overdue=False, limit=10_000)
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    return {
        "active_projects": count(select(Project.id).where(live, Project.stage != "completed")),
        "open_tasks": count(select(Task.id).outerjoin(Project).where(live_task, Task.status.in_(OPEN_TASK_STATUSES))),
        "running_experiments": count(
            select(Experiment.id).join(Project).where(live, Experiment.status == "running")
        ),
        "upcoming_deadlines": len(deadlines),
        "blocked_projects": count(select(Project.id).where(live, Project.health_status == "blocked")),
        "overdue_tasks": count(
            select(Task.id).outerjoin(Project).where(live_task, Task.status.in_(OPEN_TASK_STATUSES), Task.due_date < today)
        ),
        "experiments_needing_review": count(
            select(Experiment.id).join(Project).where(live, Experiment.status == "needs_review")
        ),
        "milestones_completed_last_7d": count(
            select(Milestone.id).join(Project).where(
                live, Milestone.status == "completed", Milestone.completed_at >= week_ago
            )
        ),
    }


def deadlines_between(
    db: Session,
    actor: Actor,
    start: date | None,
    end: date | None,
    *,
    include_overdue: bool = True,
    project_id: int | None = None,
    kinds: tuple[str, ...] = DEADLINE_KINDS,
    limit: int | None = 100,
) -> list[dict[str, Any]]:
    """Open deadlines (submission, open milestones, open tasks), sorted by date.
    With ``include_overdue``, open items before ``start`` are included and flagged."""
    actor.require_read()
    bad = set(kinds) - set(DEADLINE_KINDS)
    if bad:
        raise ValidationFailed(f"Unknown deadline kind(s): {sorted(bad)}", details={"allowed": DEADLINE_KINDS})
    today = date.today()
    lo = None if include_overdue else start

    def in_range(col):  # noqa: ANN001, ANN202
        conds = [col.is_not(None)]
        if lo is not None:
            conds.append(col >= lo)
        if end is not None:
            conds.append(col <= end)
        return conds

    items: list[dict[str, Any]] = []
    proj_filter = [Project.archived.is_(False)]
    if project_id is not None:
        proj_filter.append(Project.id == project_id)

    def item(kind: str, obj_id: int, title: str, due: date, p: Project | None, status=None, priority=None):  # noqa: ANN001
        return {
            "kind": kind, "id": obj_id, "title": title, "due_date": due, "status": status,
            "priority": priority, "project_id": p.id if p else None,
            "project_slug": p.slug if p else None, "project_title": p.title if p else None,
            "overdue": due < today, "days_left": (due - today).days,
        }

    if "submission" in kinds:
        for p in db.scalars(
            select(Project).where(*proj_filter, Project.stage.not_in(("completed",)), *in_range(Project.submission_deadline))
        ):
            items.append(item("submission", p.id, f"{p.target_venue or 'Paper'} submission", p.submission_deadline, p,
                              status=p.stage, priority=p.priority))
    if "milestone" in kinds:
        for m in db.scalars(
            select(Milestone).join(Project).options(joinedload(Milestone.project))
            .where(*proj_filter, Milestone.status.in_(OPEN_MILESTONE_STATUSES), *in_range(Milestone.due_date))
        ):
            items.append(item("milestone", m.id, m.title, m.due_date, m.project, status=m.status))
    if "task" in kinds:
        task_filter = [Task.project_id.is_(None) | Project.archived.is_(False)]
        if project_id is not None:
            task_filter.append(Task.project_id == project_id)
        for t in db.scalars(
            select(Task).outerjoin(Project).options(joinedload(Task.project))
            .where(*task_filter, Task.status.in_(OPEN_TASK_STATUSES), *in_range(Task.due_date))
        ):
            items.append(item("task", t.id, t.title, t.due_date, t.project, status=t.status, priority=t.priority))
    items.sort(key=lambda i: (i["due_date"], DEADLINE_KINDS.index(i["kind"]), PRIORITY_RANK.get(i["priority"] or "", 9)))
    return items[: clamp_limit(limit)] if limit is not None and limit < 10_000 else items


def needs_review(db: Session, actor: Actor, limit: int = 10) -> list[dict[str, Any]]:
    rows, *_ = exp_svc.list_experiments(db, actor, status="needs_review", sort="-updated_at", limit=limit)
    return [exp_svc.experiment_to_dict(e) for e in rows]


def query_work(
    db: Session,
    actor: Actor,
    *,
    resource_type: str = "task",
    project_id: int | None = None,
    status: str | None = None,
    due_before: date | None = None,
    due_after: date | None = None,
    priority: str | None = None,
    keyword: str | None = None,
    open_only: bool = True,
    limit: int = 25,
) -> dict[str, Any]:
    """Unified read-only query used by the MCP ``query_work`` tool."""
    actor.require_read()
    limit = max(1, min(limit, 100))
    if resource_type == "task":
        rows, total, *_ = task_svc.list_tasks(
            db, actor, project_id=project_id, status=status, priority=priority,
            open_only=open_only and not status, due_before=due_before, due_after=due_after,
            q=keyword, sort="due_date,priority", limit=limit,
        )
        return {"resource_type": "task", "total": total, "items": [
            {"task_id": t.id, "project": t.project.slug if t.project else None, "title": t.title, "status": t.status,
             "priority": t.priority, "due_date": t.due_date, "milestone_id": t.milestone_id,
             "tags": t.tags, "overdue": bool(t.due_date and t.due_date < date.today() and t.status in OPEN_TASK_STATUSES)}
            for t in rows]}
    if resource_type == "milestone":
        stmt = select(Milestone).join(Project).options(joinedload(Milestone.project)).where(Project.archived.is_(False))
        if project_id is not None:
            stmt = stmt.where(Milestone.project_id == project_id)
        if status:
            stmt = stmt.where(Milestone.status.in_(status.split(",")))
        elif open_only:
            stmt = stmt.where(Milestone.status.in_(OPEN_MILESTONE_STATUSES))
        if due_before:
            stmt = stmt.where(Milestone.due_date <= due_before)
        if due_after:
            stmt = stmt.where(Milestone.due_date >= due_after)
        if keyword:
            stmt = stmt.where(Milestone.title.ilike(f"%{keyword}%") | Milestone.description.ilike(f"%{keyword}%"))
        total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = db.scalars(stmt.order_by(Milestone.due_date.is_(None), Milestone.due_date).limit(limit))
        return {"resource_type": "milestone", "total": total, "items": [
            {"milestone_id": m.id, "project": m.project.slug, "title": m.title, "status": m.status,
             "due_date": m.due_date} for m in rows]}
    if resource_type == "experiment":
        if not status and open_only:
            status = "planned,running,analyzing,needs_review"
        rows, total, *_ = exp_svc.list_experiments(
            db, actor, project_id=project_id, status=status, q=keyword, sort="-updated_at", limit=limit
        )
        return {"resource_type": "experiment", "total": total, "items": [
            {"experiment_id": e.id, "project": e.project.slug, "experiment_key": e.experiment_key,
             "name": e.name, "group": e.group_name, "status": e.status, "runs": len(e.runs),
             "updated_at": e.updated_at} for e in rows]}
    if resource_type == "deadline":
        # Fetch *all* matching dates first (limit=None); priority/keyword/status filters and `total` must
        # be computed before truncating to `limit`, otherwise matching items beyond the first `limit`
        # dates are silently dropped.
        items = deadlines_between(
            db, actor, due_after or date.today(), due_before, include_overdue=due_after is None,
            project_id=project_id, limit=None,
        )
        if priority:
            wanted = set(priority.split(","))
            items = [i for i in items if i["priority"] in wanted]
        if status:
            wanted_status = set(status.split(","))
            items = [i for i in items if i["status"] in wanted_status]
        if keyword:
            items = [i for i in items if keyword.lower() in i["title"].lower()]
        total = len(items)
        items = items[:limit]
        return {"resource_type": "deadline", "total": total, "items": [
            {"kind": i["kind"], "id": i["id"], "project": i["project_slug"], "title": i["title"],
             "due_date": i["due_date"], "status": i["status"], "overdue": i["overdue"], "days_left": i["days_left"]}
            for i in items]}
    raise ValidationFailed("resource_type must be one of task, milestone, experiment, deadline")
