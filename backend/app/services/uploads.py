"""Ownership, project sharing and housekeeping for images uploaded into Markdown fields.

Uploads are content-addressed files under ``<data_dir>/uploads``. When an image is removed
from a note (or its experiment is deleted), the file stays behind. ``prune_uploads`` deletes
files that no text in the database references any more. A grace period protects images
that were just uploaded into a form that is not saved yet.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import timedelta
from pathlib import Path

from sqlalchemy import JSON, String, Text, cast, select
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.core.errors import NotFound
from app.models import Base, UploadOwner, UploadProject
from app.services.access import project_filter
from app.services.activity import log_event

log = logging.getLogger(__name__)

NAME_PATTERN = r"[0-9a-f]{32}\.(?:png|jpg|gif|webp)"
URL_RE = re.compile(rf"/api/v1/uploads/({NAME_PATTERN})")
FILE_RE = re.compile(rf"^{NAME_PATTERN}$")
DEFAULT_GRACE = timedelta(days=7)


def referenced_uploads(db: Session) -> set[str]:
    """Names of uploads mentioned anywhere in the database (every text and JSON column)."""
    names: set[str] = set()
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            if not isinstance(col.type, (String, Text, JSON)):
                continue
            text = cast(col, Text)
            for value in db.scalars(select(text).where(text.like("%/api/v1/uploads/%"))):
                names.update(URL_RE.findall(value or ""))
    return names


def prune_uploads(db: Session, upload_dir: Path, grace: timedelta = DEFAULT_GRACE, dry_run: bool = False) -> list[str]:
    """Delete unreferenced uploads (and leftover ``.part`` files) older than ``grace``.
    Returns the names removed (or that would be removed with ``dry_run``)."""
    if not upload_dir.is_dir():
        return []
    cutoff = time.time() - grace.total_seconds()
    keep = referenced_uploads(db)
    removed: list[str] = []
    for f in sorted(upload_dir.iterdir()):
        if not f.is_file() or f.stat().st_mtime > cutoff:
            continue
        orphan = FILE_RE.match(f.name) and f.name not in keep
        if orphan or f.name.endswith(".part"):
            removed.append(f.name)
            if not dry_run:
                f.unlink(missing_ok=True)
    if removed and not dry_run:
        log.info("Removed %d unused upload(s)", len(removed))
    return removed


def record_upload(db: Session, actor: Actor, name: str) -> None:
    actor.require_write()
    if actor.user_id is None or db.get(UploadOwner, (name, actor.user_id)) is not None:
        return
    db.add(UploadOwner(name=name, user_id=actor.user_id))
    log_event(db, actor, project_id=None, event_type="image_uploaded", summary="Image uploaded")
    db.commit()


def require_upload(db: Session, actor: Actor, name: str) -> None:
    actor.require_read()
    if actor.is_admin or actor.kind == "system" or (
        actor.user_id is not None and db.get(UploadOwner, (name, actor.user_id)) is not None
    ):
        return
    if db.scalar(select(UploadProject.name).where(
        UploadProject.name == name, project_filter(actor, UploadProject.project_id),
    ).limit(1)) is not None:
        return
    raise NotFound("Upload not found")


def share_uploads(db: Session, actor: Actor, project_id: int | None, *texts: str) -> None:
    """Share only images the editor can already read; text references cannot grant themselves access.
    The calling project/experiment service validates write access and commits the transaction."""
    for name in set(URL_RE.findall("\n".join(texts))):
        require_upload(db, actor, name)
        if project_id is None:
            if actor.user_id is not None and db.get(UploadOwner, (name, actor.user_id)) is None:
                db.add(UploadOwner(name=name, user_id=actor.user_id))
        elif db.get(UploadProject, (name, project_id)) is None:
            db.add(UploadProject(name=name, project_id=project_id))
