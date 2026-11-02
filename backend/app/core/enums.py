"""Enumerations shared by models, schemas, services, REST and MCP.

Values are stored as plain strings in SQLite; validation happens in Pydantic.
"""

from __future__ import annotations

from typing import Literal, get_args

Stage = Literal[
    "ideation",
    "research_design",
    "implementation",
    "experimentation",
    "analysis",
    "writing",
    "submission",
    "revision",
    "completed",
    "on_hold",
]
Health = Literal["on_track", "at_risk", "blocked"]
Priority = Literal["low", "medium", "high", "critical"]
MilestoneStatus = Literal["planned", "in_progress", "completed", "cancelled"]
TaskStatus = Literal["todo", "in_progress", "blocked", "done", "cancelled"]
ExperimentStatus = Literal[
    "planned", "running", "analyzing", "needs_review", "verified", "failed", "cancelled"
]
RunStatus = Literal["planned", "running", "completed", "failed", "cancelled"]
VerificationStatus = Literal["unverified", "needs_review", "verified", "rejected"]
ExperimentType = Literal["main", "ablation", "baseline", "sweep", "sanity_check", "other"]
Source = Literal["manual", "claude_code", "codex", "rest_api", "mcp", "system"]

STAGES: tuple[str, ...] = get_args(Stage)
HEALTHS: tuple[str, ...] = get_args(Health)
PRIORITIES: tuple[str, ...] = get_args(Priority)
TASK_STATUSES: tuple[str, ...] = get_args(TaskStatus)
MILESTONE_STATUSES: tuple[str, ...] = get_args(MilestoneStatus)
EXPERIMENT_STATUSES: tuple[str, ...] = get_args(ExperimentStatus)
SOURCES: tuple[str, ...] = get_args(Source)

PRIORITY_RANK = {"critical": 0, "high": 1, "medium": 2, "low": 3}
OPEN_TASK_STATUSES = ("todo", "in_progress", "blocked")
OPEN_MILESTONE_STATUSES = ("planned", "in_progress")
ACTIVE_EXPERIMENT_STATUSES = ("planned", "running", "analyzing", "needs_review")
