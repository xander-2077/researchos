"""Append-only activity log. Called by every mutating service inside its transaction."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth.actor import Actor
from app.core.enums import SOURCES
from app.core.errors import ValidationFailed
from app.models import ProgressEvent, Project
from app.repositories.base import apply_sort, get_or_404, paginate
from app.schemas.entities import ProgressCreate

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
    project = get_or_404(db, Project, project_id, "Project")
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
):
    actor.require_read()
    stmt = select(ProgressEvent).options(joinedload(ProgressEvent.project))
    if project_id is not None:
        stmt = stmt.where(ProgressEvent.project_id == project_id)
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
        "project_slug": ev.project.slug if ev.project else None,
        "project_title": ev.project.title if ev.project else None,
    }
