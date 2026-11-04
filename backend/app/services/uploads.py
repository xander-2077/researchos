"""Housekeeping for images uploaded into Markdown fields.

Uploads are content-addressed files under ``<data_dir>/uploads``. Nothing links a file to the
record that uses it, so when an image is removed from a note (or its experiment is deleted) the
file stays behind. ``prune_uploads`` deletes files that no text in the database references any
more. A grace period protects images that were just uploaded into a form that is not saved yet.
"""

from __future__ import annotations

import logging
import re
import time
from datetime import timedelta
from pathlib import Path

from sqlalchemy import JSON, String, Text, cast, select
from sqlalchemy.orm import Session

from app.models import Base

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
