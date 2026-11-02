"""Tasks, experiments/runs, dashboard and activity routes."""

from __future__ import annotations

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_actor
from app.auth.actor import Actor
from app.database.session import get_db
from app.schemas.common import DashboardSummary, DeadlineItem, Page
from app.schemas.entities import (
    EventOut,
    ExperimentCreate,
    ExperimentDetail,
    ExperimentOut,
    ExperimentUpdate,
    RunCreate,
    RunOut,
    RunUpdate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
)
from app.services import activity as act_svc
from app.services import dashboard as dash_svc
from app.services import experiments as exp_svc
from app.services import tasks as task_svc

router = APIRouter()


# ---------------------------------------------------------------- tasks
@router.get("/tasks", response_model=Page[TaskOut], tags=["tasks"])
def list_tasks(
    project_id: int | None = None,
    milestone_id: int | None = None,
    status: str | None = Query(None, description="Comma-separated: todo,in_progress,blocked,done,cancelled"),
    priority: str | None = None,
    open_only: bool = False,
    overdue: bool = False,
    due_before: date | None = None,
    due_after: date | None = None,
    tag: str | None = None,
    q: str | None = None,
    sort: str | None = Query(None, description="e.g. 'priority,due_date' or '-updated_at'"),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    rows, total, lim, off = task_svc.list_tasks(
        db, actor, project_id=project_id, milestone_id=milestone_id, status=status, priority=priority,
        open_only=open_only, overdue=overdue, due_before=due_before, due_after=due_after, tag=tag, q=q,
        sort=sort, limit=limit, offset=offset,
    )
    return {"items": [task_svc.task_to_dict(t) for t in rows], "total": total, "limit": lim, "offset": off}


@router.post("/tasks", response_model=TaskOut, status_code=201, tags=["tasks"],
             description="If client_key matches an existing task in the project, that task is updated (idempotent).")
def create_task(data: TaskCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return task_svc.task_to_dict(task_svc.create_task(db, actor, data))


@router.get("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def get_task(task_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return task_svc.task_to_dict(task_svc.get_task(db, actor, task_id))


@router.patch("/tasks/{task_id}", response_model=TaskOut, tags=["tasks"])
def update_task(task_id: int, data: TaskUpdate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return task_svc.task_to_dict(task_svc.update_task(db, actor, task_id, data))


@router.delete("/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    task_svc.delete_task(db, actor, task_id)


# ---------------------------------------------------------------- experiments
@router.get("/experiments", response_model=Page[ExperimentOut], tags=["experiments"])
def list_experiments(
    project_id: int | None = None,
    status: str | None = None,
    group_name: str | None = None,
    type: str | None = None,
    metric: str | None = Query(None, description="Only experiments whose runs report this metric"),
    created_after: datetime | None = None,
    created_before: datetime | None = None,
    q: str | None = None,
    sort: str | None = None,
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    rows, total, lim, off = exp_svc.list_experiments(
        db, actor, project_id=project_id, status=status, group_name=group_name, type=type, metric=metric,
        created_after=created_after, created_before=created_before, q=q, sort=sort, limit=limit, offset=offset,
    )
    return {"items": [exp_svc.experiment_to_dict(e) for e in rows], "total": total, "limit": lim, "offset": off}


@router.post("/experiments", response_model=ExperimentDetail, status_code=201, tags=["experiments"])
def create_experiment(data: ExperimentCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return exp_svc.experiment_to_dict(exp_svc.create_experiment(db, actor, data), include_runs=True)


@router.get("/experiments/{experiment_id}", response_model=ExperimentDetail, tags=["experiments"])
def get_experiment(experiment_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return exp_svc.experiment_to_dict(exp_svc.get_experiment(db, actor, experiment_id), include_runs=True)


@router.patch("/experiments/{experiment_id}", response_model=ExperimentDetail, tags=["experiments"])
def update_experiment(experiment_id: int, data: ExperimentUpdate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return exp_svc.experiment_to_dict(exp_svc.update_experiment(db, actor, experiment_id, data), include_runs=True)


@router.delete("/experiments/{experiment_id}", status_code=204, tags=["experiments"])
def delete_experiment(experiment_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    exp_svc.delete_experiment(db, actor, experiment_id)


@router.get("/experiments/{experiment_id}/runs", response_model=list[RunOut], tags=["experiments"])
def list_runs(experiment_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return exp_svc.list_runs(db, actor, experiment_id)


@router.post("/experiments/{experiment_id}/runs", response_model=RunOut, status_code=201, tags=["experiments"],
             description="Idempotent on external_run_id: re-posting updates the existing run.")
def upsert_run(experiment_id: int, data: RunCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    run, _ = exp_svc.upsert_run(db, actor, experiment_id, data)
    return run


@router.patch("/runs/{run_id}", response_model=RunOut, tags=["experiments"])
def update_run(run_id: int, data: RunUpdate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return exp_svc.update_run(db, actor, run_id, data)


@router.delete("/runs/{run_id}", status_code=204, tags=["experiments"])
def delete_run(run_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    exp_svc.delete_run(db, actor, run_id)


# ---------------------------------------------------------------- dashboard
@router.get("/dashboard/summary", response_model=DashboardSummary, tags=["dashboard"])
def dashboard_summary(horizon_days: int = Query(14, ge=1, le=365), actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return dash_svc.summary(db, actor, horizon_days)


@router.get("/dashboard/deadlines", response_model=list[DeadlineItem], tags=["dashboard"])
def dashboard_deadlines(
    days: int = Query(30, ge=1, le=730, description="Look-ahead window in days"),
    include_overdue: bool = True,
    project_id: int | None = None,
    kinds: str = Query("submission,milestone,task"),
    limit: int = Query(100, ge=1, le=500),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    today = date.today()
    return dash_svc.deadlines_between(
        db, actor, today, today + timedelta(days=days), include_overdue=include_overdue,
        project_id=project_id, kinds=tuple(k for k in kinds.split(",") if k), limit=limit,
    )


@router.get("/dashboard/activity", response_model=Page[EventOut], tags=["dashboard"])
def dashboard_activity(
    project_id: int | None = None,
    source: str | None = None,
    event_type: str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    q: str | None = None,
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    rows, total, lim, off = act_svc.list_events(
        db, actor, project_id=project_id, source=source, event_type=event_type, since=since, until=until, q=q,
        limit=limit, offset=offset,
    )
    return {"items": [act_svc.event_to_dict(e) for e in rows], "total": total, "limit": lim, "offset": off}


@router.get("/dashboard/needs-review", response_model=list[ExperimentOut], tags=["dashboard"])
def dashboard_needs_review(limit: int = Query(10, ge=1, le=50), actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return dash_svc.needs_review(db, actor, limit)
