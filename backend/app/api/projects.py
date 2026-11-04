from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_actor
from app.auth.actor import Actor
from app.database.session import get_db
from app.schemas.common import Page
from app.schemas.entities import (
    EventOut,
    MemberCandidate,
    MemberCreate,
    MemberOut,
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    ProgressCreate,
    ProjectCreate,
    ProjectReorder,
    ProjectSummary,
    ProjectUpdate,
)
from app.services import activity as act_svc
from app.services import milestones as ms_svc
from app.services import projects as svc

router = APIRouter(tags=["projects"])


@router.get("/projects/{project_id}/members", response_model=Page[MemberOut])
def list_members(project_id: int, limit: int | None = Query(None, ge=1), offset: int = Query(0, ge=0),
                 actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    rows, total, lim, off = svc.list_members(db, actor, project_id, limit, offset)
    return {"items": rows, "total": total, "limit": lim, "offset": off}


@router.get("/projects/{project_id}/member-candidates", response_model=Page[MemberCandidate])
def list_member_candidates(project_id: int, limit: int | None = Query(None, ge=1), offset: int = Query(0, ge=0),
                           actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    rows, total, lim, off = svc.list_member_candidates(db, actor, project_id, limit, offset)
    return {"items": rows, "total": total, "limit": lim, "offset": off}


@router.post("/projects/{project_id}/members", status_code=204)
def add_member(project_id: int, data: MemberCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    svc.add_member(db, actor, project_id, data.username)


@router.delete("/projects/{project_id}/members/{user_id}", status_code=204)
def remove_member(project_id: int, user_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    svc.remove_member(db, actor, project_id, user_id)


@router.post("/projects/{project_id}/leave", status_code=204)
def leave_project(project_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    svc.leave_project(db, actor, project_id)


@router.get("/projects", response_model=Page[ProjectSummary])
def list_projects(
    stage: str | None = Query(None, description="Comma-separated stages"),
    health_status: str | None = None,
    priority: str | None = None,
    archived: bool | None = Query(False, description="false=active only, true=archived only, omit via 'all'"),
    include_all: bool = Query(False, description="Return active and archived"),
    q: str | None = None,
    sort: str | None = Query(None, description="manual (default, drag order) | priority | next_deadline | last_activity | title | stage | updated_at …; '-' for desc"),
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    items, total, lim, off = svc.list_projects(
        db, actor, stage=stage, health_status=health_status, priority=priority,
        archived=None if include_all else archived, q=q, sort=sort, limit=limit, offset=offset,
    )
    return {"items": items, "total": total, "limit": lim, "offset": off}


@router.post("/projects", response_model=ProjectSummary, status_code=status.HTTP_201_CREATED)
def create_project(data: ProjectCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    p = svc.create_project(db, actor, data)
    return svc.project_summary(db, p)


@router.post("/projects/reorder", status_code=204, description="Save the manual (drag-and-drop) order of projects")
def reorder_projects(data: ProjectReorder, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    svc.reorder_projects(db, actor, data.ids)


@router.get("/projects/{ref}", response_model=ProjectSummary, description="Lookup by numeric id or slug")
def get_project(ref: str, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    actor.require_read()
    return svc.project_summary(db, svc.resolve_project(db, ref, actor))


@router.patch("/projects/{project_id}", response_model=ProjectSummary)
def update_project(project_id: int, data: ProjectUpdate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    p = svc.update_project(db, actor, project_id, data)
    return svc.project_summary(db, p)


@router.delete("/projects/{project_id}/permanent", status_code=204, description="Permanently deletes the project; owner session only")
def permanently_delete_project(project_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    svc.delete_project(db, actor, project_id)


@router.delete("/projects/{project_id}", response_model=ProjectSummary, description="Archives (soft-deletes) the project")
def delete_project(
    project_id: int, confirm: bool = Query(False, description="Explicit confirmation required for agents"),
    actor: Actor = Depends(get_actor), db: Session = Depends(get_db),
):
    p = svc.archive_project(db, actor, project_id, confirm=confirm)
    return svc.project_summary(db, p)


# ---------------------------------------------------------------- milestones
@router.get("/projects/{ref}/milestones", response_model=list[MilestoneOut], tags=["milestones"])
def list_milestones(ref: str, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    actor.require_read()
    return ms_svc.list_milestones(db, actor, svc.resolve_project(db, ref, actor).id)


@router.post("/projects/{ref}/milestones", response_model=MilestoneOut, status_code=201, tags=["milestones"])
def create_milestone(ref: str, data: MilestoneCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return ms_svc.create_milestone(db, actor, svc.resolve_project(db, ref, actor).id, data)


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut, tags=["milestones"])
def update_milestone(milestone_id: int, data: MilestoneUpdate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return ms_svc.update_milestone(db, actor, milestone_id, data)


@router.delete("/milestones/{milestone_id}", status_code=204, tags=["milestones"])
def delete_milestone(milestone_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    ms_svc.delete_milestone(db, actor, milestone_id)


# ---------------------------------------------------------------- progress
@router.get("/projects/{ref}/progress", response_model=Page[EventOut], tags=["progress"],
            description="Project id or slug")
def list_progress(
    ref: str,
    source: str | None = None,
    event_type: str | None = None,
    since: datetime | None = None,
    q: str | None = None,
    limit: int | None = Query(None, ge=1),
    offset: int = Query(0, ge=0),
    actor: Actor = Depends(get_actor),
    db: Session = Depends(get_db),
):
    actor.require_read()
    project_id = svc.resolve_project(db, ref, actor).id
    rows, total, lim, off = act_svc.list_events(
        db, actor, project_id=project_id, source=source, event_type=event_type, since=since, q=q,
        limit=limit, offset=offset,
    )
    return {"items": [act_svc.event_to_dict(e) for e in rows], "total": total, "limit": lim, "offset": off}


@router.post("/projects/{ref}/progress", response_model=EventOut, status_code=201, tags=["progress"],
             description="Append a progress note. Project id or slug.")
def add_progress(ref: str, data: ProgressCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    ev = act_svc.add_progress(db, actor, svc.resolve_project(db, ref, actor).id, data)
    return act_svc.event_to_dict(ev)
