"""Activity logging and reversible cleanup by administrators."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth.actor import Actor
from app.core.enums import SOURCES
from app.core.errors import ValidationFailed
from app.models import ProgressEvent, ProjectMember, utcnow
from app.repositories.base import apply_sort, by_project, get_or_404, paginate
from app.schemas.entities import ProgressCreate
from app.services.access import event_filter, require_admin, require_project

RESOURCE_TYPES = {"", "project", "task", "milestone", "experiment", "run"}


def log_event(
    db: Session,
    actor: Actor,
    *,
    project_id: int | None,
    event_type: str,
    summary: str,
    details: str = "",
    resource_type: str = "",
    resource_id: int | None = None,
) -> ProgressEvent:
    ev = ProgressEvent(
        project_id=project_id,
        user_id=actor.user_id,
        event_type=event_type,
        summary=summary[:1000],
        details=details,
        related_resource_type=resource_type,
        related_resource_id=resource_id,
        source=actor.source,
        actor=actor.name,
    )
    db.add(ev)
    return ev


def add_progress(db: Session, actor: Actor, project_id: int, data: ProgressCreate) -> ProgressEvent:
    """Append a progress note (never overwrites history)."""
    actor.require_write()
    project = require_project(db, actor, project_id)
    rtype = data.related_resource_type or ""
    if rtype not in RESOURCE_TYPES:
        raise ValidationFailed(
            f"related_resource_type must be one of {sorted(RESOURCE_TYPES - {''})}"
        )
    if rtype and data.related_resource_id is None:
        raise ValidationFailed("related_resource_id is required when related_resource_type is set")
    event_type = data.event_type or "progress_note"
    if not event_type.replace("_", "").isalnum():
        raise ValidationFailed("event_type must be snake_case")
    from app.services.uploads import share_uploads

    share_uploads(db, actor, project.id, data.details)
    ev = log_event(
        db,
        actor.with_source(data.source),
        project_id=project.id,
        event_type=event_type,
        summary=data.summary,
        details=data.details,
        resource_type=rtype,
        resource_id=data.related_resource_id,
    )
    db.commit()
    db.refresh(ev)
    return ev


def list_events(
    db: Session,
    actor: Actor,
    *,
    project_id: int | None = None,
    source: str | None = None,
    event_type: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    q: str | None = None,
    sort: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
    deleted: bool = False,
):
    actor.require_read()
    if deleted:
        require_admin(actor)
    stmt = select(ProgressEvent).where(
        event_filter(actor),
        ProgressEvent.deleted_at.is_not(None) if deleted else ProgressEvent.deleted_at.is_(None),
        ProgressEvent.event_type.not_in({"user_invited", "user_registered", "user_updated", "user_deleted", "activity_deleted", "activity_restored"}),
    ).options(joinedload(ProgressEvent.project))
    if actor.user_id is not None:
        # The personal feed follows participation even for administrators.
        stmt = stmt.where(
            ProgressEvent.project_id.in_(select(ProjectMember.project_id).where(ProjectMember.user_id == actor.user_id))
            | (ProgressEvent.project_id.is_(None) & (ProgressEvent.related_resource_type == "task")
               & (ProgressEvent.user_id == actor.user_id))
        )
    if project_id is not None:
        stmt = stmt.where(by_project(ProgressEvent.project_id, project_id))
    if source:
        sources = [s for s in source.split(",") if s]
        bad = set(sources) - set(SOURCES)
        if bad:
            raise ValidationFailed(f"Unknown source(s): {sorted(bad)}", details={"allowed": SOURCES})
        stmt = stmt.where(ProgressEvent.source.in_(sources))
    if event_type:
        stmt = stmt.where(ProgressEvent.event_type.in_(event_type.split(",")))
    if since:
        stmt = stmt.where(ProgressEvent.created_at >= since)
    if until:
        stmt = stmt.where(ProgressEvent.created_at <= until)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(ProgressEvent.summary.ilike(like) | ProgressEvent.details.ilike(like))
    stmt = apply_sort(stmt, ProgressEvent, sort, {"created_at", "event_type", "source"}, "-created_at")
    return paginate(db, stmt, limit, offset)


def set_deleted(db: Session, actor: Actor, event_id: int, *, deleted: bool) -> None:
    require_admin(actor)
    ev = get_or_404(db, ProgressEvent, event_id, "Activity")
    if (ev.deleted_at is not None) == deleted:
        return
    ev.deleted_at = utcnow() if deleted else None
    log_event(
        db, actor, project_id=ev.project_id,
        event_type="activity_deleted" if deleted else "activity_restored",
        summary=f"Activity {'deleted' if deleted else 'restored'}: {ev.id}",
    )
    db.commit()


def event_to_dict(ev: ProgressEvent) -> dict:
    return {
        "id": ev.id,
        "project_id": ev.project_id,
        "related_resource_type": ev.related_resource_type,
        "related_resource_id": ev.related_resource_id,
        "event_type": ev.event_type,
        "summary": ev.summary,
        "details": ev.details,
        "source": ev.source,
        "actor": ev.actor,
        "created_at": ev.created_at,
        "deleted_at": ev.deleted_at,
        "project_slug": ev.project.slug if ev.project else None,
        "project_title": ev.project.title if ev.project else None,
    }
