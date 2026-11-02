"""JSON export (migration aid). Excludes users and token hashes."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Experiment, ExperimentRun, Milestone, ProgressEvent, Project, Task, TaskDependency

EXPORT_VERSION = 1


def _row(obj: Any) -> dict[str, Any]:
    out = {}
    for c in obj.__table__.columns:
        v = getattr(obj, c.name)
        if isinstance(v, (datetime, date)):
            v = v.isoformat()
        out[c.name] = v
    return out


def export_all(db: Session) -> dict[str, Any]:
    tables = {
        "projects": Project,
        "milestones": Milestone,
        "tasks": Task,
        "experiments": Experiment,
        "experiment_runs": ExperimentRun,
        "progress_events": ProgressEvent,
    }
    return {
        "format": "researchos-export",
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        **{name: [_row(o) for o in db.scalars(select(model).order_by(model.id))] for name, model in tables.items()},
        "task_dependencies": [
            _row(o) for o in db.scalars(select(TaskDependency).order_by(TaskDependency.task_id, TaskDependency.depends_on_id))
        ],
    }
