"""Thin data-access helpers shared by services (lookup, sorting, pagination)."""

from __future__ import annotations

from typing import Any, TypeVar

from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.errors import NotFound, ValidationFailed
from app.models import Base

M = TypeVar("M", bound=Base)


def get_or_404(db: Session, model: type[M], obj_id: int, label: str | None = None) -> M:
    obj = db.get(model, obj_id)
    if obj is None:
        raise NotFound(f"{label or model.__name__} {obj_id} not found")
    return obj


NO_PROJECT = 0  # project_id filter value meaning "items that belong to no project"


def by_project(col: Any, project_id: int) -> Any:
    """Filter clause for a ``project_id`` query parameter (``0`` = no project)."""
    return col.is_(None) if project_id == NO_PROJECT else col == project_id


def clamp_limit(limit: int | None) -> int:
    s = get_settings()
    if limit is None:
        return s.default_page_size
    return max(1, min(int(limit), s.max_page_size))


def apply_sort(stmt: Select, model: type[Base], sort: str | None, allowed: set[str], default: str) -> Select:
    """``sort`` is a comma-separated list of field names, ``-`` prefix for descending.
    NULLs always sort last."""
    spec = sort or default
    order = []
    for part in [p.strip() for p in spec.split(",") if p.strip()]:
        desc = part.startswith("-")
        name = part.lstrip("-+")
        if name not in allowed:
            raise ValidationFailed(
                f"Cannot sort by '{name}'", details={"allowed": sorted(allowed)}
            )
        col = getattr(model, name)
        order.append(col.is_(None))
        order.append(col.desc() if desc else col.asc())
    order.append(model.id.desc() if spec.startswith("-") else model.id.asc())  # type: ignore[attr-defined]
    return stmt.order_by(*order)


def paginate(db: Session, stmt: Select, limit: int | None, offset: int | None) -> tuple[list[Any], int, int, int]:
    lim = clamp_limit(limit)
    off = max(0, int(offset or 0))
    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = list(db.scalars(stmt.limit(lim).offset(off)).unique())
    return rows, total, lim, off
