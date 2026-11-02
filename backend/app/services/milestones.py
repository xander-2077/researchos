from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.models import Milestone, Project, Task, utcnow
from app.repositories.base import get_or_404
from app.schemas.entities import MilestoneCreate, MilestoneUpdate
from app.services.activity import log_event


def list_milestones(db: Session, actor: Actor, project_id: int) -> list[Milestone]:
    actor.require_read()
    get_or_404(db, Project, project_id, "Project")
    stmt = (
        select(Milestone)
        .where(Milestone.project_id == project_id)
        .order_by(Milestone.due_date.is_(None), Milestone.due_date, Milestone.id)
    )
    return list(db.scalars(stmt))


def create_milestone(db: Session, actor: Actor, project_id: int, data: MilestoneCreate) -> Milestone:
    actor.require_write()
    get_or_404(db, Project, project_id, "Project")
    m = Milestone(project_id=project_id, **data.model_dump())
    if m.status == "completed":
        m.completed_at = utcnow()
    db.add(m)
    db.flush()
    log_event(
        db, actor, project_id=project_id, event_type="milestone_created",
        summary=f"Milestone added: {m.title}", resource_type="milestone", resource_id=m.id,
    )
    db.commit()
    db.refresh(m)
    return m


def update_milestone(db: Session, actor: Actor, milestone_id: int, data: MilestoneUpdate) -> Milestone:
    actor.require_write()
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    changes = {k: v for k, v in data.model_dump(exclude_unset=True).items() if getattr(m, k) != v}
    if not changes:
        return m
    old_status = m.status
    for k, v in changes.items():
        setattr(m, k, v)
    if "status" in changes:
        if m.status == "completed" and old_status != "completed":
            m.completed_at = changes.get("completed_at") or utcnow()
            log_event(
                db, actor, project_id=m.project_id, event_type="milestone_completed",
                summary=f"Milestone completed: {m.title}", resource_type="milestone", resource_id=m.id,
            )
        elif m.status != "completed":
            m.completed_at = None
            log_event(
                db, actor, project_id=m.project_id, event_type="milestone_status_changed",
                summary=f"Milestone '{m.title}': {old_status} → {m.status}",
                resource_type="milestone", resource_id=m.id,
            )
    others = sorted(set(changes) - {"status", "completed_at"})
    if others:
        log_event(
            db, actor, project_id=m.project_id, event_type="milestone_updated",
            summary=f"Milestone '{m.title}' updated: {', '.join(others)}",
            resource_type="milestone", resource_id=m.id,
        )
    db.commit()
    db.refresh(m)
    return m


def upsert_milestone(
    db: Session, actor: Actor, project_id: int, milestone_id: int | None, fields: dict
) -> tuple[Milestone, bool]:
    """Used by MCP. Returns (milestone, created)."""
    if milestone_id is not None:
        m = get_or_404(db, Milestone, milestone_id, "Milestone")
        if m.project_id != project_id:
            from app.core.errors import ValidationFailed

            raise ValidationFailed(f"Milestone {milestone_id} belongs to project {m.project_id}, not {project_id}")
        return update_milestone(db, actor, milestone_id, MilestoneUpdate(**fields)), False
    return create_milestone(db, actor, project_id, MilestoneCreate(**fields)), True


def delete_milestone(db: Session, actor: Actor, milestone_id: int) -> None:
    actor.require_write()
    m = get_or_404(db, Milestone, milestone_id, "Milestone")
    # Tasks keep existing; their milestone link is cleared (FK ON DELETE SET NULL).
    for t in db.scalars(select(Task).where(Task.milestone_id == m.id)):
        t.milestone_id = None
    log_event(
        db, actor, project_id=m.project_id, event_type="milestone_deleted",
        summary=f"Milestone deleted: {m.title}", resource_type="milestone", resource_id=m.id,
    )
    db.delete(m)
    db.commit()
