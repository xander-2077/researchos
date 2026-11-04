"""Shared project permissions for REST, MCP and exports."""

from sqlalchemy import select, true
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.core.errors import Forbidden, NotFound
from app.models import ExperimentRun, ProgressEvent, Project, ProjectMember, Task
from app.repositories.base import get_or_404


def project_filter(actor: Actor, column=Project.id):
    if actor.kind == "system" or actor.is_admin:
        return true()
    return column.in_(select(ProjectMember.project_id).where(ProjectMember.user_id == actor.user_id))


def task_filter(actor: Actor):
    return project_filter(actor, Task.project_id) | (Task.project_id.is_(None) & (Task.owner_id == actor.user_id))


def event_filter(actor: Actor):
    return project_filter(actor, ProgressEvent.project_id) | (
        ProgressEvent.project_id.is_(None) & (ProgressEvent.related_resource_type == "task")
        & (ProgressEvent.user_id == actor.user_id)
    )


def require_project(db: Session, actor: Actor, project_id: int) -> Project:
    actor.require_read()
    project = db.scalar(select(Project).where(Project.id == project_id, project_filter(actor)))
    if project is None:
        raise NotFound("Project not found")
    return project


def project_resource(db: Session, actor: Actor, model, resource_id: int, label: str):
    obj = get_or_404(db, model, resource_id, label)
    project_id = obj.experiment.project_id if isinstance(obj, ExperimentRun) else obj.project_id
    actor.require_read()
    if isinstance(obj, Task) and project_id is None:
        if not (actor.is_admin or actor.kind == "system" or obj.owner_id == actor.user_id):
            raise NotFound(f"{label} not found")
    else:
        require_project(db, actor, project_id)
    return obj


def require_member_management(db: Session, actor: Actor, project_id: int) -> Project:
    project = require_project(db, actor, project_id)
    if actor.kind != "user" or not (actor.is_admin or project.owner_id == actor.user_id):
        raise Forbidden("Only the project owner or an administrator can manage members")
    return project


def require_admin(actor: Actor) -> None:
    actor.require_write()
    if actor.kind != "system" and not (actor.kind == "user" and actor.is_admin):
        raise Forbidden("Administrator access required")
