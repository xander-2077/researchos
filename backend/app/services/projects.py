"""Project service: CRUD, portfolio summaries, high-impact change guards."""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.core.enums import OPEN_MILESTONE_STATUSES, OPEN_TASK_STATUSES, PRIORITY_RANK
from app.core.errors import ConfirmationRequired, Conflict, Forbidden, NotFound, ValidationFailed
from app.models import Experiment, Milestone, ProgressEvent, Project, ProjectMember, Task, User
from app.repositories.base import apply_sort, clamp_limit
from app.schemas.entities import ProjectCreate, ProjectUpdate
from app.services.activity import log_event
from app.services.access import project_filter, require_member_management, require_project
from app.services.uploads import share_uploads

SORTABLE = {"title", "stage", "priority", "health_status", "submission_deadline", "updated_at", "created_at"}
HIGH_IMPACT_FIELDS = {"research_question", "hypothesis"}
STAGE_LABEL = {
    "ideation": "Ideation",
    "research_design": "Research Design",
    "implementation": "Implementation",
    "experimentation": "Experimentation",
    "analysis": "Analysis",
    "writing": "Writing",
    "submission": "Submission",
    "revision": "Revision",
    "completed": "Completed",
    "on_hold": "On Hold",
}


def slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    s = (s or "project")[:70].strip("-") or "project"
    # An all-digit slug would be indistinguishable from a project id ("/projects/1").
    return f"project-{s}" if s.isdigit() else s


def _unique_slug(db: Session, base: str) -> str:
    slug, n = base, 2
    while db.scalar(select(Project.id).where(Project.slug == slug)) is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def resolve_project(db: Session, ref: int | str, actor: Actor) -> Project:
    """Find a project by numeric id or slug.

    A reference made only of digits is *always* an id; slugs can never be all digits
    (enforced on create/update and by migration 0002), so the two namespaces cannot collide."""
    project: Project | None = None
    ref_s = str(ref).strip()
    if ref_s.isdigit():
        project = db.get(Project, int(ref_s))
    else:
        project = db.scalar(select(Project).where(Project.slug == ref_s.lower()))
    if project is None:
        raise NotFound(
            f"Project '{ref}' not found. Use list_projects (MCP) or GET /api/v1/projects to see valid ids/slugs."
        )
    return require_project(db, actor, project.id)


def create_project(db: Session, actor: Actor, data: ProjectCreate) -> Project:
    actor.require_write()
    payload = data.model_dump()
    slug = payload.pop("slug") or _unique_slug(db, slugify(data.title))
    if db.scalar(select(Project.id).where(Project.slug == slug)) is not None:
        raise Conflict(f"Slug '{slug}' is already used by another project")
    payload["links"] = [link for link in payload["links"]]
    last = db.scalar(select(func.max(Project.sort_order))) or 0
    project = Project(slug=slug, sort_order=last + 1, owner_id=actor.user_id, **payload)
    db.add(project)
    db.flush()
    if actor.user_id is not None:
        db.add(ProjectMember(project_id=project.id, user_id=actor.user_id))
    share_uploads(db, actor, project.id, project.notes, project.description)
    log_event(
        db, actor, project_id=project.id, event_type="project_created",
        summary=f"Project created: {project.title}", resource_type="project", resource_id=project.id,
    )
    db.commit()
    db.refresh(project)
    return project


def update_project(db: Session, actor: Actor, project_id: int, data: ProjectUpdate) -> Project:
    actor.require_write()
    project = require_project(db, actor, project_id)
    changes = data.model_dump(exclude_unset=True)
    confirm = changes.pop("confirm", False)
    expected_version = changes.pop("version", None)
    if expected_version is not None and expected_version != project.version:
        raise Conflict(
            "Project was modified by someone else. Reload and retry.",
            details={"current_version": project.version},
        )
    # Drop no-op changes so we only log real edits.
    changes = {k: v for k, v in changes.items() if getattr(project, k) != v}
    if "links" in changes:
        changes["links"] = [dict(link) for link in changes["links"] or []]
    if not changes:
        return project

    if actor.is_agent and not confirm:
        risky = []
        if changes.get("stage") == "completed":
            risky.append("stage=completed")
        if changes.get("archived") is True:
            risky.append("archived=true")
        risky += [f for f in HIGH_IMPACT_FIELDS if f in changes and getattr(project, f)]
        if risky:
            raise ConfirmationRequired(
                "High-impact change requires explicit confirmation: "
                + ", ".join(risky)
                + ". Ask the user, then retry with confirm=true.",
                details={"fields": risky},
            )
    if "slug" in changes:
        if db.scalar(select(Project.id).where(Project.slug == changes["slug"], Project.id != project.id)):
            raise Conflict(f"Slug '{changes['slug']}' is already in use")
    share_uploads(db, actor, project.id, *(changes[k] or "" for k in ("notes", "description") if k in changes))

    old_stage, old_health = project.stage, project.health_status
    if expected_version is not None:
        # Atomic compare-and-swap. The check above only catches *stale reads*; two requests that both
        # read version N would otherwise both pass it. The conditional UPDATE is evaluated by SQLite
        # under the write lock, so exactly one of them wins and the others get a 409.
        res = db.execute(
            update(Project)
            .where(Project.id == project.id, Project.version == expected_version)
            .values(version=Project.version + 1)
            .execution_options(synchronize_session=False)
        )
        if res.rowcount != 1:
            db.rollback()
            current = db.scalar(select(Project.version).where(Project.id == project_id))
            raise Conflict(
                "Project was modified by someone else. Reload and retry.",
                details={"current_version": current},
            )
        db.refresh(project, attribute_names=["version"])
    else:
        project.version = Project.version + 1  # SQL-side increment: concurrent updates never lose a bump
    for k, v in changes.items():
        setattr(project, k, v)

    if "stage" in changes:
        log_event(
            db, actor, project_id=project.id, event_type="stage_changed",
            summary=f"Stage changed: {STAGE_LABEL[old_stage]} → {STAGE_LABEL[project.stage]}",
            resource_type="project", resource_id=project.id,
        )
    if "health_status" in changes:
        log_event(
            db, actor, project_id=project.id, event_type="health_changed",
            summary=f"Health changed: {old_health} → {project.health_status}",
            resource_type="project", resource_id=project.id,
        )
    if "archived" in changes:
        log_event(
            db, actor, project_id=project.id,
            event_type="project_archived" if project.archived else "project_restored",
            summary=("Project archived" if project.archived else "Project restored"),
            resource_type="project", resource_id=project.id,
        )
    other = sorted(set(changes) - {"stage", "health_status", "archived", "notes"})
    if other:
        log_event(
            db, actor, project_id=project.id, event_type="project_updated",
            summary=f"Project updated: {', '.join(other)}", resource_type="project", resource_id=project.id,
        )
    try:
        db.commit()
    except IntegrityError as e:  # pragma: no cover - race on slug
        db.rollback()
        raise Conflict("Update violates a uniqueness constraint") from e
    db.refresh(project)
    return project


def delete_project(db: Session, actor: Actor, project_id: int) -> None:
    actor.require_write()
    project = require_project(db, actor, project_id)
    if actor.kind != "user" or actor.user_id != project.owner_id:
        raise Forbidden("Only the project owner can permanently delete the project")
    log_event(
        db, actor, project_id=None, event_type="project_deleted",
        summary=f"Project deleted: {project.title}", resource_type="project", resource_id=project.id,
    )
    # Foreign-key cascades remove the project's resources in the same transaction.
    db.execute(delete(Project).where(Project.id == project.id))
    db.commit()


def archive_project(db: Session, actor: Actor, project_id: int, *, confirm: bool = False) -> Project:
    """Soft delete."""
    return update_project(db, actor, project_id, ProjectUpdate(archived=True, confirm=confirm))


# ------------------------------------------------------------------ summaries
def _summaries(db: Session, projects: list[Project]) -> list[dict[str, Any]]:
    ids = [p.id for p in projects]
    if not ids:
        return []
    today = date.today()

    ms_by_p: dict[int, list[Milestone]] = defaultdict(list)
    for m in db.scalars(select(Milestone).where(Milestone.project_id.in_(ids))):
        ms_by_p[m.project_id].append(m)

    open_tasks: dict[int, list[Task]] = defaultdict(list)
    for t in db.scalars(
        select(Task).where(Task.project_id.in_(ids), Task.status.in_(OPEN_TASK_STATUSES))
    ):
        open_tasks[t.project_id].append(t)

    exp_counts = dict(
        db.execute(
            select(Experiment.project_id, func.count()).where(Experiment.project_id.in_(ids)).group_by(Experiment.project_id)
        ).all()
    )
    last_act = dict(
        db.execute(
            select(ProgressEvent.project_id, func.max(ProgressEvent.created_at))
            .where(ProgressEvent.project_id.in_(ids))
            .group_by(ProgressEvent.project_id)
        ).all()
    )

    out = []
    for p in projects:
        ms = [m for m in ms_by_p[p.id] if m.status != "cancelled"]
        done = sum(1 for m in ms if m.status == "completed")
        open_ms = sorted(
            (m for m in ms if m.status in OPEN_MILESTONE_STATUSES),
            key=lambda m: (m.due_date is None, m.due_date or date.max, m.id),
        )
        nm = open_ms[0] if open_ms else None

        candidates: list[tuple[date, dict[str, Any]]] = []
        if p.submission_deadline and p.submission_deadline >= today:
            candidates.append((p.submission_deadline, {"kind": "submission", "title": p.target_venue or "Submission", "due_date": p.submission_deadline}))
        for m in open_ms:
            if m.due_date and m.due_date >= today:
                candidates.append((m.due_date, {"kind": "milestone", "id": m.id, "title": m.title, "due_date": m.due_date}))
        for t in open_tasks[p.id]:
            if t.due_date and t.due_date >= today:
                candidates.append((t.due_date, {"kind": "task", "id": t.id, "title": t.title, "due_date": t.due_date}))
        candidates.sort(key=lambda c: c[0])

        blocked = [t.title for t in open_tasks[p.id] if t.status == "blocked"]
        ev_last = last_act.get(p.id)
        if ev_last is not None and ev_last.tzinfo is None:
            from datetime import timezone

            ev_last = ev_last.replace(tzinfo=timezone.utc)
        last = max(x for x in [ev_last, p.updated_at] if x is not None)
        d = {c.name: getattr(p, c.name) for c in Project.__table__.columns}
        d.update(
            milestone_progress={
                "completed": done,
                "total": len(ms),
                "percent": round(100 * done / len(ms), 1) if ms else None,
            },
            next_milestone=(
                {"id": nm.id, "title": nm.title, "due_date": nm.due_date, "status": nm.status} if nm else None
            ),
            next_deadline=candidates[0][1] if candidates else None,
            open_task_count=len(open_tasks[p.id]),
            blocked_task_count=len(blocked),
            blocked_tasks=blocked[:5],
            experiment_count=exp_counts.get(p.id, 0),
            last_activity_at=last,
        )
        out.append(d)
    return out


def list_projects(
    db: Session,
    actor: Actor,
    *,
    stage: str | None = None,
    health_status: str | None = None,
    priority: str | None = None,
    archived: bool | None = False,
    q: str | None = None,
    sort: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> tuple[list[dict[str, Any]], int, int, int]:
    actor.require_read()
    stmt = select(Project).where(project_filter(actor))
    if archived is not None:
        stmt = stmt.where(Project.archived == archived)
    for col, val in ((Project.stage, stage), (Project.health_status, health_status), (Project.priority, priority)):
        if val:
            stmt = stmt.where(col.in_(val.split(",")))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Project.title.ilike(like) | Project.description.ilike(like) | Project.slug.ilike(like)
        )
    sort_key = sort or "manual"
    # priority / deadline / last_activity need custom ordering, done in Python (small N).
    python_sort = sort_key.lstrip("-") in {"priority", "next_deadline", "last_activity"}
    if sort_key == "manual":
        stmt = stmt.order_by(Project.sort_order, Project.id)
    elif not python_sort:
        stmt = apply_sort(stmt, Project, sort_key, SORTABLE, "-updated_at")
    projects = list(db.scalars(stmt))
    summaries = _summaries(db, projects)
    if python_sort:
        desc = sort_key.startswith("-")
        key = sort_key.lstrip("-")
        if key == "priority":
            summaries.sort(key=lambda s: (PRIORITY_RANK.get(s["priority"], 9), s["title"].lower()), reverse=desc)
        elif key == "next_deadline":
            summaries.sort(key=lambda s: (s["next_deadline"] is None, s["next_deadline"]["due_date"] if s["next_deadline"] else date.max), reverse=desc)
        else:
            summaries.sort(key=lambda s: s["last_activity_at"], reverse=not desc)
    total = len(summaries)
    lim = clamp_limit(limit)
    off = max(0, offset or 0)
    return summaries[off : off + lim], total, lim, off


def reorder_projects(db: Session, actor: Actor, ids: list[int]) -> None:
    """Persist a manual order. ``ids`` lists projects in the desired order; projects not listed keep
    their relative order after the listed ones. Does not bump ``version``/``updated_at`` (a reorder
    is not an edit of the project and must not invalidate open edit forms)."""
    actor.require_write()
    want = list(dict.fromkeys(ids))
    known = set(db.scalars(select(Project.id).where(Project.id.in_(want), project_filter(actor))))
    missing = [i for i in want if i not in known]
    if missing:
        raise NotFound(f"Unknown project id(s): {missing}")
    rest = [i for i in db.scalars(select(Project.id).where(project_filter(actor)).order_by(Project.sort_order, Project.id)) if i not in set(want)]
    for pos, pid in enumerate(want + rest, start=1):
        db.execute(
            update(Project).where(Project.id == pid)
            .values(sort_order=pos, updated_at=Project.updated_at)
            .execution_options(synchronize_session=False)
        )
    db.commit()
    db.expire_all()


def project_summary(db: Session, project: Project) -> dict[str, Any]:
    return _summaries(db, [project])[0]


def validate_milestone_belongs(db: Session, project_id: int | None, milestone_id: int | None) -> None:
    if milestone_id is None:
        return
    m = db.get(Milestone, milestone_id)
    if m is None or m.project_id != project_id:
        raise ValidationFailed(f"Milestone {milestone_id} does not belong to project {project_id}")


def list_members(db: Session, actor: Actor, project_id: int, limit: int | None = None, offset: int = 0):
    from app.repositories.base import paginate

    project = require_project(db, actor, project_id)
    rows, total, lim, off = paginate(db, select(User).join(ProjectMember).where(
        ProjectMember.project_id == project_id,
    ).order_by(User.id), limit, offset)
    return [{"user_id": u.id, "username": u.username, "is_active": u.is_active,
             "is_owner": u.id == project.owner_id} for u in rows], total, lim, off


def list_member_candidates(db: Session, actor: Actor, project_id: int, limit: int | None = None, offset: int = 0):
    from app.repositories.base import paginate

    require_member_management(db, actor, project_id)
    rows, total, lim, off = paginate(db, select(User).where(
        User.is_active.is_(True), User.password_hash != "", User.username != "admin",
        User.id.not_in(select(ProjectMember.user_id).where(ProjectMember.project_id == project_id)),
    ).order_by(User.username, User.id), limit, offset)
    return [{"user_id": u.id, "username": u.username} for u in rows], total, lim, off


def add_member(db: Session, actor: Actor, project_id: int, username: str) -> None:
    actor.require_write()
    require_member_management(db, actor, project_id)
    user = db.scalar(select(User).where(User.username == username, User.is_active.is_(True)))
    if user is None:
        raise NotFound("Enabled user not found")
    if db.get(ProjectMember, (project_id, user.id)) is not None:
        return
    db.add(ProjectMember(project_id=project_id, user_id=user.id))
    log_event(db, actor, project_id=project_id, event_type="member_added", summary=f"Member added: {user.username}")
    db.commit()


def leave_project(db: Session, actor: Actor, project_id: int) -> None:
    actor.require_write()
    if actor.kind != "user":
        raise Forbidden("Only a logged-in user can leave a project")
    project = require_project(db, actor, project_id)
    if project.owner_id == actor.user_id:
        raise ValidationFailed("The project owner cannot leave the project")
    member = db.get(ProjectMember, (project_id, actor.user_id))
    if member is None:
        raise NotFound("Member not found")
    db.delete(member)
    log_event(db, actor, project_id=project_id, event_type="member_left", summary=f"Member left: {actor.name}")
    db.commit()


def remove_member(db: Session, actor: Actor, project_id: int, user_id: int) -> None:
    actor.require_write()
    project = require_member_management(db, actor, project_id)
    if project.owner_id == user_id:
        raise ValidationFailed("The project owner cannot be removed")
    member = db.get(ProjectMember, (project_id, user_id))
    if member is None:
        raise NotFound("Member not found")
    user = db.get(User, user_id)
    db.delete(member)
    log_event(db, actor, project_id=project_id, event_type="member_removed", summary=f"Member removed: {user.username}")
    db.commit()
