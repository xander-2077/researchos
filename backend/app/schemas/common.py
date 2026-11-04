from __future__ import annotations

from datetime import date, datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field, field_validator

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class Link(BaseModel):
    label: str = Field(default="", max_length=200)
    url: str = Field(max_length=2000)


class MetricValue(BaseModel):
    value: float | int | None = None
    unit: str = ""
    description: str = ""


def normalize_metrics(raw: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Accept ``{"sr": 0.8}`` or ``{"sr": {"value": 0.8, "unit": "%"}}``; store the latter."""
    if not raw:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for key, val in raw.items():
        key = str(key).strip()
        if not key:
            continue
        if isinstance(val, dict):
            out[key] = MetricValue.model_validate(val).model_dump()
        elif isinstance(val, (int, float)) and not isinstance(val, bool):
            out[key] = {"value": val, "unit": "", "description": ""}
        else:
            raise ValueError(f"metric '{key}' must be a number or an object with 'value'")
    return out


def normalize_links(raw: list[Any] | None) -> list[dict[str, str]]:
    if not raw:
        return []
    out = []
    for item in raw:
        if isinstance(item, str):
            out.append({"label": "", "url": item})
        else:
            out.append(Link.model_validate(item).model_dump())
    return out


def clean_tags(v: list[str] | None) -> list[str] | None:
    if v is None:
        return None
    seen: list[str] = []
    for t in v:
        t = str(t).strip()
        if t and t not in seen:
            seen.append(t[:50])
    return seen[:20]


class DeadlineItem(BaseModel):
    kind: str  # submission | milestone | task
    id: int
    title: str
    due_date: date
    status: str | None = None
    priority: str | None = None
    project_id: int | None
    project_slug: str | None
    project_title: str | None
    overdue: bool = False
    days_left: int


class DashboardSummary(BaseModel):
    active_projects: int
    open_tasks: int
    running_experiments: int
    upcoming_deadlines: int
    blocked_projects: int
    overdue_tasks: int
    experiments_needing_review: int
    milestones_completed_last_7d: int


class EventRef(BaseModel):
    type: str = Field(description="task | milestone | experiment | run | project")
    id: int

    @field_validator("type")
    @classmethod
    def _valid_type(cls, v: str) -> str:
        if v not in {"task", "milestone", "experiment", "run", "project"}:
            raise ValueError("type must be one of task, milestone, experiment, run, project")
        return v


__all__ = ["datetime"]
