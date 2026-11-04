"""JSON export (migration aid). Excludes users and token hashes."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.actor import Actor, SYSTEM
from app.services.access import event_filter, project_filter, task_filter
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


def export_all(db: Session, actor: Actor = SYSTEM) -> dict[str, Any]:
    actor.require_read()
    tables = {
        "projects": Project,
        "milestones": Milestone,
        "tasks": Task,
        "experiments": Experiment,
        "experiment_runs": ExperimentRun,
        "progress_events": ProgressEvent,
    }
    conditions = {
        Project: project_filter(actor),
        Milestone: project_filter(actor, Milestone.project_id),
        Task: task_filter(actor),
        Experiment: project_filter(actor, Experiment.project_id),
        ExperimentRun: ExperimentRun.experiment_id.in_(select(Experiment.id).where(project_filter(actor, Experiment.project_id))),
        ProgressEvent: event_filter(actor),
    }
    return {
        "format": "researchos-export",
        "version": EXPORT_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        **{name: [_row(o) for o in db.scalars(select(model).where(conditions[model]).order_by(model.id))] for name, model in tables.items()},
        "task_dependencies": [
            _row(o) for o in db.scalars(select(TaskDependency).where(TaskDependency.task_id.in_(select(Task.id).where(task_filter(actor)))).order_by(TaskDependency.task_id, TaskDependency.depends_on_id))
        ],
    }
