from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import String, case, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.auth.actor import Actor
from app.core.enums import OPEN_TASK_STATUSES, PRIORITIES, TASK_STATUSES
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.models import Project, Task, TaskDependency, utcnow
from app.repositories.base import apply_sort, get_or_404, paginate
from app.schemas.entities import TaskCreate, TaskUpdate
from app.services.activity import log_event
from app.services.projects import validate_milestone_belongs

SORTABLE = {"title", "status", "priority", "sort_order", "start_date", "due_date", "created_at", "updated_at"}
_PRIORITY_ORDER = case({"critical": 0, "high": 1, "medium": 2, "low": 3}, value=Task.priority, else_=9)


def _check_enum(name: str, value: str | None, allowed: tuple[str, ...]) -> list[str] | None:
    if not value:
        return None
    vals = [v for v in value.split(",") if v]
    bad = set(vals) - set(allowed)
    if bad:
        raise ValidationFailed(f"Invalid {name}: {sorted(bad)}", details={"allowed": list(allowed)})
    return vals


def list_tasks(
    db: Session,
    actor: Actor,
    *,
    project_id: int | None = None,
    milestone_id: int | None = None,
    status: str | None = None,
    priority: str | None = None,
    open_only: bool = False,
    due_before: date | None = None,
    due_after: date | None = None,
    overdue: bool = False,
    tag: str | None = None,
    q: str | None = None,
    include_archived: bool = False,
    sort: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
):
    actor.require_read()
    stmt = select(Task).outerjoin(Project).options(joinedload(Task.project), joinedload(Task.milestone))
    if not include_archived:
        stmt = stmt.where(Task.project_id.is_(None) | Project.archived.is_(False))
    if project_id is not None:
        stmt = stmt.where(Task.project_id == project_id)
    if milestone_id is not None:
        stmt = stmt.where(Task.milestone_id == milestone_id)
    if (st := _check_enum("status", status, TASK_STATUSES)) is not None:
        stmt = stmt.where(Task.status.in_(st))
    if open_only or overdue:
        stmt = stmt.where(Task.status.in_(OPEN_TASK_STATUSES))
    if (pr := _check_enum("priority", priority, PRIORITIES)) is not None:
        stmt = stmt.where(Task.priority.in_(pr))
    if due_before:
        stmt = stmt.where(Task.due_date <= due_before)
    if due_after:
        stmt = stmt.where(Task.due_date >= due_after)
    if overdue:
        stmt = stmt.where(Task.due_date < date.today())
    if q:
        like = f"%{q}%"
        stmt = stmt.where(Task.title.ilike(like) | Task.description.ilike(like) | Task.notes.ilike(like))
    if tag:
        # JSON array stored as text; a quoted match is precise enough for single-user scale.
        stmt = stmt.where(cast(Task.tags, String).like(f'%"{tag}"%'))
    s = sort or "priority,due_date"
    parts = [p.strip() for p in s.split(",") if p.strip()]
    if any(p.lstrip("-") == "priority" for p in parts):
        order = []
        for p in parts:
            name, desc = p.lstrip("-"), p.startswith("-")
            if name == "priority":
                order.append(_PRIORITY_ORDER.desc() if desc else _PRIORITY_ORDER)
            elif name in SORTABLE:
                col = getattr(Task, name)
                order += [col.is_(None), col.desc() if desc else col.asc()]
            else:
                raise ValidationFailed(f"Cannot sort by '{name}'", details={"allowed": sorted(SORTABLE)})
        stmt = stmt.order_by(*order, Task.id)
    else:
        stmt = apply_sort(stmt, Task, s, SORTABLE, "due_date")
    return paginate(db, stmt, limit, offset)


def task_to_dict(t: Task) -> dict[str, Any]:
    d = {c.name: getattr(t, c.name) for c in Task.__table__.columns}
    d["project_slug"] = t.project.slug if t.project else None
    d["project_title"] = t.project.title if t.project else None
    d["milestone_title"] = t.milestone.title if t.milestone else None
    d["depends_on"] = t.depends_on
    return d


def _set_dependencies(db: Session, t: Task, ids: list[int]) -> None:
    """Replace the task's prerequisites. Prerequisites must be other tasks of the same project and
    must not create a cycle."""
    want = list(dict.fromkeys(ids))
    if t.id in want:
        raise ValidationFailed("A task cannot depend on itself")
    if want:
        rows = db.execute(select(Task.id, Task.project_id).where(Task.id.in_(want))).all()
        found = {r.id: r.project_id for r in rows}
        missing = [i for i in want if i not in found]
        if missing:
            raise ValidationFailed(f"Unknown prerequisite task id(s): {missing}")
        foreign = [i for i, pid in found.items() if pid != t.project_id]
        if foreign:
            raise ValidationFailed(f"Prerequisite task(s) {foreign} belong to a different project")
        # Cycle check: t must not be reachable from any prerequisite by following "depends on" edges.
        edges: dict[int, list[int]] = {}
        for a, b in db.execute(
            select(TaskDependency.task_id, TaskDependency.depends_on_id).where(TaskDependency.task_id != t.id)
        ):
            edges.setdefault(a, []).append(b)
        seen: set[int] = set()
        stack = list(want)
        while stack:
            cur = stack.pop()
            if cur == t.id:
                raise ValidationFailed("Dependency cycle detected")
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(edges.get(cur, []))
    if sorted(want) == t.depends_on:
        return
    t.dep_links = [TaskDependency(task_id=t.id, depends_on_id=i) for i in sorted(want)]
    db.flush()


def _check_dates(start: date | None, due: date | None) -> None:
    if start and due and start > due:
        raise ValidationFailed("start_date must not be after due_date")


def get_task(db: Session, actor: Actor, task_id: int) -> Task:
    actor.require_read()
    return get_or_404(db, Task, task_id, "Task")


def _status_side_effects(db: Session, actor: Actor, t: Task, old: str | None) -> None:
    if t.status == old:
        return
    if t.status == "done":
        t.completed_at = utcnow()
        log_event(db, actor, project_id=t.project_id, event_type="task_completed",
                  summary=f"Task completed: {t.title}", resource_type="task", resource_id=t.id)
    else:
        if old == "done":
            t.completed_at = None
        if old is not None:
            log_event(db, actor, project_id=t.project_id, event_type="task_status_changed",
                      summary=f"Task '{t.title}': {old} → {t.status}", resource_type="task", resource_id=t.id)


def create_task(db: Session, actor: Actor, data: TaskCreate) -> Task:
    actor.require_write()
    if data.project_id is not None:
        get_or_404(db, Project, data.project_id, "Project")
    validate_milestone_belongs(db, data.project_id, data.milestone_id)
    if data.client_key:
        existing = db.scalar(
            select(Task).where(Task.project_id == data.project_id, Task.client_key == data.client_key)
        )
        if existing is not None:
            # Idempotent retry: update instead of duplicating.
            fields = data.model_dump(exclude_unset=True, exclude={"project_id", "client_key"})
            return update_task(db, actor, existing.id, TaskUpdate(**fields))
    fields = data.model_dump()
    deps = fields.pop("depends_on")
    if fields.get("sort_order") is None:
        fields["sort_order"] = (db.scalar(select(func.max(Task.sort_order))) or 0) + 1024
    t = Task(**fields)
    if t.status == "done":
        t.completed_at = utcnow()
    db.add(t)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent retry with the same client_key
        db.rollback()
        if data.client_key:
            existing = db.scalar(
                select(Task).where(Task.project_id == data.project_id, Task.client_key == data.client_key)
            )
            if existing is not None:
                fields = data.model_dump(exclude_unset=True, exclude={"project_id", "client_key"})
                return update_task(db, actor, existing.id, TaskUpdate(**fields))
        raise Conflict("Task was created concurrently; retry the call") from exc
    if deps:
        _set_dependencies(db, t, deps)
    log_event(db, actor, project_id=t.project_id, event_type="task_created",
              summary=f"Task created: {t.title}", resource_type="task", resource_id=t.id)
    if t.status == "done":
        log_event(db, actor, project_id=t.project_id, event_type="task_completed",
                  summary=f"Task completed: {t.title}", resource_type="task", resource_id=t.id)
    db.commit()
    db.refresh(t)
    return t


def update_task(db: Session, actor: Actor, task_id: int, data: TaskUpdate) -> Task:
    actor.require_write()
    t = get_or_404(db, Task, task_id, "Task")
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if getattr(t, k) != v}
    if changes.get("sort_order", 0) is None:
        del changes["sort_order"]
    if not changes:
        return t
    if "project_id" in changes:
        if changes["project_id"] is not None:
            get_or_404(db, Project, changes["project_id"], "Project")
        if "milestone_id" not in changes:
            changes["milestone_id"] = None
        if "depends_on" not in changes and t.depends_on:
            changes["depends_on"] = []  # prerequisites live in the old project
    validate_milestone_belongs(db, changes.get("project_id", t.project_id), changes.get("milestone_id"))
    _check_dates(changes.get("start_date", t.start_date), changes.get("due_date", t.due_date))
    old_status = t.status
    new_deps = changes.pop("depends_on", None)
    for k, v in changes.items():
        setattr(t, k, v)
    if "project_id" in changes:
        # Tasks elsewhere that depended on this one would now point across projects.
        db.query(TaskDependency).filter(TaskDependency.depends_on_id == t.id).delete()
        db.flush()
        db.expire(t, ["dep_links"])
    if new_deps is not None:
        _set_dependencies(db, t, new_deps)
    if new_deps is not None:
        changes["depends_on"] = new_deps
    _status_side_effects(db, actor, t, old_status)
    others = sorted(set(changes) - {"status", "sort_order"})  # reordering is not worth an event
    if others:
        log_event(db, actor, project_id=t.project_id, event_type="task_updated",
                  summary=f"Task '{t.title}' updated: {', '.join(others)}", resource_type="task", resource_id=t.id)
    db.commit()
    db.refresh(t)
    return t


def upsert_task(
    db: Session, actor: Actor, project_id: int | None, task_id: int | None, client_key: str | None, fields: dict
) -> tuple[Task, bool]:
    """MCP entry point: update by id, else by (project, client_key), else create.
    project_id=None means "not given" for an id update and "no project" otherwise.
    Only explicitly provided fields are changed. Returns (task, created)."""
    actor.require_write()
    if task_id is not None:
        t = db.get(Task, task_id)
        if t is None:
            raise NotFound(f"Task {task_id} not found")
        # project is optional when updating by id; if given it must match.
        if project_id is not None and t.project_id != project_id:
            raise ValidationFailed(f"Task {task_id} belongs to project {t.project_id}, not {project_id}")
        return update_task(db, actor, task_id, TaskUpdate(**fields)), False
    if client_key:
        t = db.scalar(select(Task).where(Task.project_id == project_id, Task.client_key == client_key))
        if t is not None:
            return update_task(db, actor, t.id, TaskUpdate(**fields)), False
    if "title" not in fields:
        raise ValidationFailed("title is required when creating a new task")
    return create_task(db, actor, TaskCreate(project_id=project_id, client_key=client_key, **fields)), True


def delete_task(db: Session, actor: Actor, task_id: int) -> None:
    actor.require_write()
    t = get_or_404(db, Task, task_id, "Task")
    log_event(db, actor, project_id=t.project_id, event_type="task_deleted",
              summary=f"Task deleted: {t.title}", resource_type="task", resource_id=t.id)
    db.delete(t)
    db.commit()
