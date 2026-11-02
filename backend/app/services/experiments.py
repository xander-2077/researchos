"""Experiment registry: experiments (conditions, grouped into ablation groups) and runs.

Scientific-integrity rules enforced here (for every entry point):
  * Only a human session may set ``status=verified`` / ``verification_status=verified``.
  * Changing results/conclusions of a verified experiment or run by an agent requires
    ``confirm_overwrite_verified=True`` and drops it back to ``needs_review``.
  * Runs are idempotent on ``(experiment_id, external_run_id)``.
"""

from __future__ import annotations

import math
import re
from datetime import datetime
from typing import Any

from sqlalchemy import String, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.auth.actor import Actor
from app.core.enums import EXPERIMENT_STATUSES
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import Experiment, ExperimentRun, Project
from app.repositories.base import apply_sort, get_or_404, paginate
from app.schemas.entities import ExperimentCreate, ExperimentUpdate, RunCreate, RunUpdate
from app.services.activity import log_event

SORTABLE = {"name", "status", "group_name", "type", "created_at", "updated_at"}
PROTECTED_EXP_FIELDS = {"status", "conclusion", "hypothesis", "baseline", "variant"}
PROTECTED_RUN_FIELDS = {"metrics_json", "conclusion", "config_json", "verification_status", "status", "git_commit"}


def _unit(u: str | None) -> str:
    if not u:
        return ""
    return u if u in ("%", "°") else f" {u}"


def _key_from_name(name: str) -> str:
    return (re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "experiment")[:100]


def _forbid_agent_verify(actor: Actor, field: str, value: str | None) -> None:
    if value == "verified" and not actor.is_human:
        raise Forbidden(
            f"Agents cannot set {field}='verified'. Record results as 'needs_review'; "
            "the researcher verifies them in the ResearchOS web UI.",
            code="verification_requires_human",
        )


# ------------------------------------------------------------------ read
def metric_summary(runs: list[ExperimentRun]) -> dict[str, dict[str, Any]]:
    """Per-metric mean/std/n across runs (only numeric values)."""
    acc: dict[str, list[float]] = {}
    units: dict[str, str] = {}
    for r in runs:
        for k, m in (r.metrics_json or {}).items():
            v = m.get("value") if isinstance(m, dict) else m
            if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v):
                acc.setdefault(k, []).append(float(v))
                if isinstance(m, dict) and m.get("unit"):
                    units[k] = m["unit"]
    out = {}
    for k, vals in acc.items():
        n = len(vals)
        mean = sum(vals) / n
        std = math.sqrt(sum((x - mean) ** 2 for x in vals) / (n - 1)) if n > 1 else 0.0
        out[k] = {"mean": mean, "std": std, "n": n, "min": min(vals), "max": max(vals), "unit": units.get(k, "")}
    return out


def experiment_to_dict(e: Experiment, include_runs: bool = False) -> dict[str, Any]:
    d = {c.name: getattr(e, c.name) for c in Experiment.__table__.columns}
    runs = list(e.runs)
    d["run_count"] = len(runs)
    d["metric_summary"] = metric_summary(runs)
    d["metric_names"] = sorted(d["metric_summary"].keys())
    d["runs_needing_review"] = sum(1 for r in runs if r.verification_status == "needs_review")
    d["project_slug"] = e.project.slug if e.project else None
    d["project_title"] = e.project.title if e.project else None
    if include_runs:
        d["runs"] = runs
    return d


def list_experiments(
    db: Session,
    actor: Actor,
    *,
    project_id: int | None = None,
    status: str | None = None,
    group_name: str | None = None,
    type: str | None = None,
    metric: str | None = None,
    created_after: datetime | None = None,
    created_before: datetime | None = None,
    q: str | None = None,
    include_archived: bool = False,
    sort: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
):
    actor.require_read()
    stmt = (
        select(Experiment)
        .join(Project)
        .options(joinedload(Experiment.project), selectinload(Experiment.runs))
    )
    if not include_archived:
        stmt = stmt.where(Project.archived.is_(False))
    if project_id is not None:
        stmt = stmt.where(Experiment.project_id == project_id)
    if status:
        vals = status.split(",")
        bad = set(vals) - set(EXPERIMENT_STATUSES)
        if bad:
            raise ValidationFailed(f"Invalid status: {sorted(bad)}", details={"allowed": EXPERIMENT_STATUSES})
        stmt = stmt.where(Experiment.status.in_(vals))
    if group_name is not None:
        stmt = stmt.where(Experiment.group_name == group_name)
    if type:
        stmt = stmt.where(Experiment.type.in_(type.split(",")))
    if created_after:
        stmt = stmt.where(Experiment.created_at >= created_after)
    if created_before:
        stmt = stmt.where(Experiment.created_at <= created_before)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Experiment.name.ilike(like)
            | Experiment.experiment_key.ilike(like)
            | Experiment.description.ilike(like)
            | Experiment.group_name.ilike(like)
        )
    if metric:
        sub = select(ExperimentRun.experiment_id).where(
            cast(ExperimentRun.metrics_json, String).like(f'%"{metric}"%')
        )
        stmt = stmt.where(Experiment.id.in_(sub))
    stmt = apply_sort(stmt, Experiment, sort, SORTABLE, "-updated_at")
    return paginate(db, stmt, limit, offset)


def get_experiment(db: Session, actor: Actor, experiment_id: int) -> Experiment:
    actor.require_read()
    return get_or_404(db, Experiment, experiment_id, "Experiment")


def list_runs(db: Session, actor: Actor, experiment_id: int) -> list[ExperimentRun]:
    actor.require_read()
    get_or_404(db, Experiment, experiment_id, "Experiment")
    return list(
        db.scalars(select(ExperimentRun).where(ExperimentRun.experiment_id == experiment_id).order_by(ExperimentRun.id))
    )


# ------------------------------------------------------------------ write
def _apply_experiment_changes(db: Session, actor: Actor, e: Experiment, changes: dict[str, Any], confirm: bool) -> None:
    changes = {k: v for k, v in changes.items() if getattr(e, k) != v}
    if not changes:
        return
    _forbid_agent_verify(actor, "status", changes.get("status"))
    if e.status == "verified" and not actor.is_human and set(changes) & PROTECTED_EXP_FIELDS:
        if not confirm:
            raise Conflict(
                f"Experiment '{e.name}' is verified; refusing to change "
                f"{sorted(set(changes) & PROTECTED_EXP_FIELDS)} without confirm_overwrite_verified=true. "
                "Ask the user first.",
                code="verified_protected",
            )
        changes.setdefault("status", "needs_review")
        if changes["status"] == "verified":  # pragma: no cover - guarded above
            changes["status"] = "needs_review"
    old_status = e.status
    for k, v in changes.items():
        setattr(e, k, v)
    if "status" in changes:
        log_event(db, actor, project_id=e.project_id, event_type="experiment_status_changed",
                  summary=f"Experiment '{e.name}': {old_status} → {e.status}",
                  resource_type="experiment", resource_id=e.id)
    others = sorted(set(changes) - {"status"})
    if others:
        log_event(db, actor, project_id=e.project_id, event_type="experiment_updated",
                  summary=f"Experiment '{e.name}' updated: {', '.join(others)}",
                  resource_type="experiment", resource_id=e.id)


def create_experiment(db: Session, actor: Actor, data: ExperimentCreate, *, commit: bool = True) -> Experiment:
    actor.require_write()
    get_or_404(db, Project, data.project_id, "Project")
    _forbid_agent_verify(actor, "status", data.status)
    key = data.experiment_key or _key_from_name(data.name)
    if db.scalar(select(Experiment.id).where(Experiment.project_id == data.project_id, Experiment.experiment_key == key)):
        raise Conflict(f"Experiment key '{key}' already exists in this project", details={"experiment_key": key})
    e = Experiment(**data.model_dump(exclude={"experiment_key"}), experiment_key=key)
    db.add(e)
    db.flush()
    log_event(db, actor, project_id=e.project_id, event_type="experiment_created",
              summary=f"Experiment recorded: {e.name}" + (f" ({e.group_name})" if e.group_name else ""),
              resource_type="experiment", resource_id=e.id)
    if commit:
        db.commit()
        db.refresh(e)
    return e


def update_experiment(db: Session, actor: Actor, experiment_id: int, data: ExperimentUpdate) -> Experiment:
    actor.require_write()
    e = get_or_404(db, Experiment, experiment_id, "Experiment")
    changes = data.model_dump(exclude_unset=True)
    confirm = changes.pop("confirm_overwrite_verified", False)
    _apply_experiment_changes(db, actor, e, changes, confirm)
    db.commit()
    db.refresh(e)
    return e


def delete_experiment(db: Session, actor: Actor, experiment_id: int) -> None:
    actor.require_write()
    e = get_or_404(db, Experiment, experiment_id, "Experiment")
    if not actor.is_human:
        raise Forbidden("Experiments can only be deleted from the web UI.")
    log_event(db, actor, project_id=e.project_id, event_type="experiment_deleted",
              summary=f"Experiment deleted: {e.name}", resource_type="experiment", resource_id=e.id)
    db.delete(e)
    db.commit()


def _run_fields(data: RunCreate | RunUpdate) -> dict[str, Any]:
    raw = data.model_dump(exclude_unset=True, exclude={"external_run_id", "confirm_overwrite_verified"})
    if "config" in raw:
        raw["config_json"] = raw.pop("config") or {}
    if "metrics" in raw:
        raw["metrics_json"] = raw.pop("metrics") or {}
    for k in ("git_commit", "git_branch", "environment", "conclusion"):
        if k in raw and raw[k] is None:
            raw[k] = ""
    if "artifact_links" in raw and raw["artifact_links"] is None:
        raw["artifact_links"] = []
    return raw


def _apply_run_changes(db: Session, actor: Actor, run: ExperimentRun, fields: dict[str, Any], confirm: bool) -> list[str]:
    if "metrics_json" in fields and fields["metrics_json"] is not None:
        # Merge metrics so partial updates don't drop existing ones.
        merged = dict(run.metrics_json or {})
        merged.update(fields["metrics_json"])
        fields["metrics_json"] = merged
    changes = {k: v for k, v in fields.items() if getattr(run, k) != v}
    if not changes:
        return []
    _forbid_agent_verify(actor, "verification_status", changes.get("verification_status"))
    if run.verification_status == "verified" and not actor.is_human and set(changes) & PROTECTED_RUN_FIELDS:
        if not confirm:
            raise Conflict(
                f"Run '{run.external_run_id}' is verified; refusing to change "
                f"{sorted(set(changes) & PROTECTED_RUN_FIELDS)} without confirm_overwrite_verified=true.",
                code="verified_protected",
            )
        changes["verification_status"] = "needs_review"
    for k, v in changes.items():
        setattr(run, k, v)
    return sorted(changes)


def upsert_run(
    db: Session, actor: Actor, experiment_id: int, data: RunCreate, *, commit: bool = True, confirm: bool = False
) -> tuple[ExperimentRun, bool]:
    """Create run or update existing one with same external_run_id. Returns (run, created)."""
    actor.require_write()
    e = get_or_404(db, Experiment, experiment_id, "Experiment")
    fields = _run_fields(data)
    run = db.scalar(
        select(ExperimentRun).where(
            ExperimentRun.experiment_id == experiment_id, ExperimentRun.external_run_id == data.external_run_id
        )
    )
    if run is not None:
        changed = _apply_run_changes(db, actor, run, fields, confirm)
        if changed:
            log_event(db, actor, project_id=e.project_id, event_type="run_updated",
                      summary=f"Run {run.external_run_id} of '{e.name}' updated: {', '.join(changed)}",
                      resource_type="run", resource_id=run.id)
            e.updated_at = run.updated_at = datetime.now().astimezone()
        if commit:
            db.commit()
            db.refresh(run)
        return run, False

    _forbid_agent_verify(actor, "verification_status", fields.get("verification_status"))
    fields.setdefault("verification_status", "needs_review")
    fields.setdefault("status", "completed" if fields.get("metrics_json") else "running")
    run = ExperimentRun(experiment_id=experiment_id, external_run_id=data.external_run_id, **fields)
    db.add(run)
    try:
        db.flush()
    except IntegrityError as exc:  # concurrent duplicate submission
        db.rollback()
        raise Conflict(f"Run '{data.external_run_id}' was created concurrently; retry the call") from exc
    metrics_txt = ", ".join(
        f"{k}={v.get('value')}{_unit(v.get('unit'))}" for k, v in list((run.metrics_json or {}).items())[:4]
    )
    log_event(db, actor, project_id=e.project_id, event_type="run_recorded",
              summary=f"Run {run.external_run_id} recorded for '{e.name}'"
              + (f" (seed {run.seed})" if run.seed is not None else "")
              + (f": {metrics_txt}" if metrics_txt else ""),
              resource_type="run", resource_id=run.id)
    e.updated_at = datetime.now().astimezone()
    if commit:
        db.commit()
        db.refresh(run)
    return run, True


def update_run(db: Session, actor: Actor, run_id: int, data: RunUpdate) -> ExperimentRun:
    actor.require_write()
    run = get_or_404(db, ExperimentRun, run_id, "Run")
    changed = _apply_run_changes(db, actor, run, _run_fields(data), data.confirm_overwrite_verified)
    if changed:
        e = run.experiment
        event = "run_verified" if run.verification_status == "verified" and "verification_status" in changed else "run_updated"
        log_event(db, actor, project_id=e.project_id, event_type=event,
                  summary=f"Run {run.external_run_id} of '{e.name}' "
                  + ("verified" if event == "run_verified" else f"updated: {', '.join(changed)}"),
                  resource_type="run", resource_id=run.id)
    db.commit()
    db.refresh(run)
    return run


def delete_run(db: Session, actor: Actor, run_id: int) -> None:
    actor.require_write()
    run = get_or_404(db, ExperimentRun, run_id, "Run")
    if not actor.is_human:
        raise Forbidden("Runs can only be deleted from the web UI.")
    e = run.experiment
    log_event(db, actor, project_id=e.project_id, event_type="run_deleted",
              summary=f"Run {run.external_run_id} of '{e.name}' deleted", resource_type="run", resource_id=run.id)
    db.delete(run)
    db.commit()


def record_experiment(db: Session, actor: Actor, project_id: int, p: dict[str, Any]) -> dict[str, Any]:
    """Upsert an experiment (by experiment_key) and optionally one run (by external_run_id)
    in a single transaction. Agent-created experiments default to ``needs_review``."""
    actor.require_write()
    get_or_404(db, Project, project_id, "Project")
    key = p.get("experiment_key")
    if not key:
        raise ValidationFailed("experiment_key is required (a stable id such as 'no-world-model-ablation')")
    exp_fields = {
        k: p[k]
        for k in ("group_name", "hypothesis", "baseline", "variant", "description", "type", "status", "conclusion")
        if p.get(k) is not None
    }
    if p.get("experiment_name"):
        exp_fields["name"] = p["experiment_name"]
    run_keys = ("seed", "git_commit", "git_branch", "config", "metrics", "artifact_links", "environment",
                "run_status", "run_conclusion", "started_at", "finished_at")
    wants_run = any(p.get(k) is not None for k in run_keys)
    if wants_run and not p.get("external_run_id"):
        raise ValidationFailed(
            "external_run_id is required when recording run data (use e.g. the W&B/MLflow run id, "
            "or '<git_commit>-seed<seed>'). Re-sending the same id updates the run instead of duplicating it."
        )

    e = db.scalar(select(Experiment).where(Experiment.project_id == project_id, Experiment.experiment_key == key))
    created_exp = False
    try:
        if e is None:
            if "name" not in exp_fields:
                raise ValidationFailed("experiment_name is required when creating a new experiment")
            exp_fields.setdefault("status", "needs_review" if (p.get("metrics") or p.get("conclusion")) else "planned")
            e = create_experiment(
                db, actor, ExperimentCreate(project_id=project_id, experiment_key=key, **exp_fields), commit=False
            )
            created_exp = True
        else:
            validated = ExperimentUpdate(**exp_fields).model_dump(exclude_unset=True)
            _apply_experiment_changes(db, actor, e, validated, bool(p.get("confirm_overwrite_verified")))

        run = None
        created_run = False
        if p.get("external_run_id"):
            run_payload = {k: p[k] for k in run_keys if p.get(k) is not None}
            if "run_status" in run_payload:
                run_payload["status"] = run_payload.pop("run_status")
            if "run_conclusion" in run_payload:
                run_payload["conclusion"] = run_payload.pop("run_conclusion")
            rc = RunCreate(external_run_id=p["external_run_id"], **run_payload)
            run, created_run = upsert_run(
                db, actor, e.id, rc, commit=False, confirm=bool(p.get("confirm_overwrite_verified"))
            )
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(e)
    return {
        "experiment": e,
        "experiment_created": created_exp,
        "run": run,
        "run_created": created_run,
    }


def find_experiment(db: Session, project_id: int, key: str) -> Experiment:
    e = db.scalar(select(Experiment).where(Experiment.project_id == project_id, Experiment.experiment_key == key))
    if e is None:
        raise NotFound(f"Experiment '{key}' not found in project {project_id}")
    return e


def count_needing_review(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(Experiment).where(Experiment.status == "needs_review")) or 0
