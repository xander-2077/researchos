"""Request/response schemas. ``*Update`` schemas are partial: only fields that are
explicitly sent are applied (``model_dump(exclude_unset=True)``)."""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.enums import (
    ExperimentStatus,
    ExperimentType,
    Health,
    MilestoneStatus,
    Priority,
    RunStatus,
    Source,
    Stage,
    TaskStatus,
    VerificationStatus,
)
from app.schemas.common import Link, ORMModel, clean_tags, normalize_links, normalize_metrics

SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]?$")
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$")


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


# ---------------------------------------------------------------- Project
class ProjectBase(Strict):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=20_000)
    research_question: str = Field(default="", max_length=5_000)
    hypothesis: str = Field(default="", max_length=5_000)
    target_venue: str = Field(default="", max_length=200)
    submission_deadline: date | None = None
    stage: Stage = "ideation"
    health_status: Health = "on_track"
    priority: Priority = "medium"
    repository_url: str = Field(default="", max_length=500)
    next_action: str = Field(default="", max_length=2_000)
    blocker_summary: str = Field(default="", max_length=2_000)
    notes: str = Field(default="", max_length=200_000)
    links: list[Link] = Field(default_factory=list, max_length=50)


class ProjectCreate(ProjectBase):
    slug: str | None = Field(default=None, description="URL-safe id; derived from title if omitted")

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug must be lowercase letters, digits and dashes")
        if v is not None and v.isdigit():
            raise ValueError("slug cannot consist only of digits (it would clash with project ids)")
        return v


class ProjectUpdate(Strict):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    slug: str | None = None
    description: str | None = Field(default=None, max_length=20_000)
    research_question: str | None = Field(default=None, max_length=5_000)
    hypothesis: str | None = Field(default=None, max_length=5_000)
    target_venue: str | None = Field(default=None, max_length=200)
    submission_deadline: date | None = None
    stage: Stage | None = None
    health_status: Health | None = None
    priority: Priority | None = None
    repository_url: str | None = Field(default=None, max_length=500)
    next_action: str | None = Field(default=None, max_length=2_000)
    blocker_summary: str | None = Field(default=None, max_length=2_000)
    notes: str | None = Field(default=None, max_length=200_000)
    links: list[Link] | None = Field(default=None, max_length=50)
    archived: bool | None = None
    version: int | None = Field(default=None, description="Optimistic concurrency check")
    confirm: bool = Field(
        default=False,
        description="Required for agents making high-impact changes (completing/archiving the "
        "project, changing research question or hypothesis).",
    )

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str | None) -> str | None:
        if v is not None and not SLUG_RE.match(v):
            raise ValueError("slug must be lowercase letters, digits and dashes")
        if v is not None and v.isdigit():
            raise ValueError("slug cannot consist only of digits (it would clash with project ids)")
        return v


class MilestoneProgress(BaseModel):
    completed: int
    total: int
    percent: float | None  # None when no milestones defined


class ProjectOut(ORMModel):
    id: int
    slug: str
    title: str
    description: str
    research_question: str
    hypothesis: str
    target_venue: str
    submission_deadline: date | None
    stage: str
    health_status: str
    priority: str
    repository_url: str
    next_action: str
    blocker_summary: str
    notes: str
    links: list[dict[str, Any]]
    archived: bool
    created_at: datetime
    updated_at: datetime
    version: int


class ProjectSummary(ProjectOut):
    milestone_progress: MilestoneProgress
    next_milestone: dict[str, Any] | None
    next_deadline: dict[str, Any] | None
    open_task_count: int
    blocked_task_count: int
    blocked_tasks: list[str]
    experiment_count: int
    last_activity_at: datetime | None


# ---------------------------------------------------------------- Milestone
class MilestoneCreate(Strict):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=10_000)
    status: MilestoneStatus = "planned"
    due_date: date | None = None


class MilestoneUpdate(Strict):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=10_000)
    status: MilestoneStatus | None = None
    due_date: date | None = None
    completed_at: datetime | None = None


class MilestoneOut(ORMModel):
    id: int
    project_id: int
    title: str
    description: str
    status: str
    due_date: date | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------- Task
class TaskCreate(Strict):
    project_id: int
    milestone_id: int | None = None
    client_key: str | None = Field(default=None, max_length=120)
    title: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=20_000)
    status: TaskStatus = "todo"
    priority: Priority = "medium"
    due_date: date | None = None
    tags: list[str] = Field(default_factory=list)
    git_reference: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=50_000)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str] | None) -> list[str] | None:
        return clean_tags(v)


class TaskUpdate(Strict):
    project_id: int | None = None
    milestone_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=300)
    description: str | None = Field(default=None, max_length=20_000)
    status: TaskStatus | None = None
    priority: Priority | None = None
    due_date: date | None = None
    tags: list[str] | None = None
    git_reference: str | None = Field(default=None, max_length=300)
    notes: str | None = Field(default=None, max_length=50_000)

    @field_validator("tags")
    @classmethod
    def _tags(cls, v: list[str] | None) -> list[str] | None:
        return clean_tags(v)


class TaskOut(ORMModel):
    id: int
    project_id: int
    milestone_id: int | None
    client_key: str | None
    title: str
    description: str
    status: str
    priority: str
    due_date: date | None
    tags: list[str]
    git_reference: str
    notes: str
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None
    project_slug: str | None = None
    project_title: str | None = None
    milestone_title: str | None = None


# ---------------------------------------------------------------- Experiment
class ExperimentCreate(Strict):
    project_id: int
    experiment_key: str | None = Field(default=None, description="Stable key; derived from name if omitted")
    group_name: str = Field(default="", max_length=200)
    name: str = Field(min_length=1, max_length=300)
    type: ExperimentType = "main"
    hypothesis: str = Field(default="", max_length=10_000)
    baseline: str = Field(default="", max_length=5_000)
    variant: str = Field(default="", max_length=5_000)
    description: str = Field(default="", max_length=20_000)
    status: ExperimentStatus = "planned"
    conclusion: str = Field(default="", max_length=10_000)

    @field_validator("experiment_key")
    @classmethod
    def _key(cls, v: str | None) -> str | None:
        if v is not None and not KEY_RE.match(v):
            raise ValueError("experiment_key may contain letters, digits and . _ : / -")
        return v


class ExperimentUpdate(Strict):
    group_name: str | None = Field(default=None, max_length=200)
    name: str | None = Field(default=None, min_length=1, max_length=300)
    type: ExperimentType | None = None
    hypothesis: str | None = Field(default=None, max_length=10_000)
    baseline: str | None = Field(default=None, max_length=5_000)
    variant: str | None = Field(default=None, max_length=5_000)
    description: str | None = Field(default=None, max_length=20_000)
    status: ExperimentStatus | None = None
    conclusion: str | None = Field(default=None, max_length=10_000)
    confirm_overwrite_verified: bool = False


class RunBase(Strict):
    seed: int | None = None
    git_commit: str | None = Field(default=None, max_length=64)
    git_branch: str | None = Field(default=None, max_length=200)
    config: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    environment: str | None = Field(default=None, max_length=300)
    artifact_links: list[Any] | None = Field(default=None, max_length=50)
    status: RunStatus | None = None
    verification_status: VerificationStatus | None = None
    conclusion: str | None = Field(default=None, max_length=10_000)
    started_at: datetime | None = None
    finished_at: datetime | None = None

    @field_validator("metrics")
    @classmethod
    def _metrics(cls, v: dict[str, Any] | None) -> dict[str, Any] | None:
        return None if v is None else normalize_metrics(v)

    @field_validator("artifact_links")
    @classmethod
    def _links(cls, v: list[Any] | None) -> list[Any] | None:
        return None if v is None else normalize_links(v)


class RunCreate(RunBase):
    external_run_id: str = Field(
        min_length=1,
        max_length=200,
        description="Stable id (e.g. W&B run id or '<commit>-seed<seed>'). Re-posting the same id updates the run.",
    )


class RunUpdate(RunBase):
    confirm_overwrite_verified: bool = False


class RunOut(ORMModel):
    id: int
    experiment_id: int
    external_run_id: str
    seed: int | None
    git_commit: str
    git_branch: str
    config_json: dict[str, Any]
    metrics_json: dict[str, Any]
    environment: str
    artifact_links: list[Any]
    status: str
    verification_status: str
    conclusion: str
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime


class ExperimentOut(ORMModel):
    id: int
    project_id: int
    experiment_key: str
    group_name: str
    name: str
    type: str
    hypothesis: str
    baseline: str
    variant: str
    description: str
    status: str
    conclusion: str
    created_at: datetime
    updated_at: datetime
    run_count: int = 0
    metric_names: list[str] = []
    metric_summary: dict[str, Any] = {}
    runs_needing_review: int = 0
    project_slug: str | None = None
    project_title: str | None = None


class ExperimentDetail(ExperimentOut):
    runs: list[RunOut] = []


# ---------------------------------------------------------------- Progress / events
class ProgressCreate(Strict):
    summary: str = Field(min_length=1, max_length=1000)
    details: str = Field(default="", max_length=20_000)
    related_resource_type: str | None = Field(default=None, max_length=32)
    related_resource_id: int | None = None
    event_type: str = Field(default="progress_note", max_length=48)
    source: Source | None = None


class EventOut(ORMModel):
    id: int
    project_id: int | None
    related_resource_type: str
    related_resource_id: int | None
    event_type: str
    summary: str
    details: str
    source: str
    actor: str
    created_at: datetime
    project_slug: str | None = None
    project_title: str | None = None


# ---------------------------------------------------------------- Tokens / auth
class TokenCreate(Strict):
    name: str = Field(min_length=1, max_length=120)
    scopes: list[str] = Field(default_factory=lambda: ["read"])
    expires_in_days: int | None = Field(default=90, ge=1, le=3650)

    @field_validator("scopes")
    @classmethod
    def _scopes(cls, v: list[str]) -> list[str]:
        s = set(v)
        if not s <= {"read", "write"} or not s:
            raise ValueError("scopes must be ['read'] or ['read', 'write']")
        s.add("read")
        return sorted(s)


class TokenOut(ORMModel):
    id: int
    name: str
    token_prefix: str
    scopes: list[str]
    created_at: datetime
    expires_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None


class TokenCreated(TokenOut):
    token: str  # plaintext, shown once


class LoginRequest(Strict):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=256)


class PasswordChange(Strict):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)
