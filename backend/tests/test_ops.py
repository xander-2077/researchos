"""Migrations, backup/restore, JSON export, demo seed, stdio MCP."""

from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

import pytest
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.database.migrate import current_revision, upgrade_to_head
from app.models import Base
from tests.conftest import Ctx

BACKEND = Path(__file__).resolve().parents[1]


def test_migration_creates_schema_matching_models(tmp_path: Path):
    url = f"sqlite:///{tmp_path / 'm.db'}"
    upgrade_to_head(url)
    assert current_revision(url) == "0003"
    eng = create_engine(url)
    with eng.connect() as conn:
        tables = set(inspect(conn).get_table_names())
        assert {"projects", "milestones", "tasks", "experiments", "experiment_runs", "progress_events",
                "api_tokens", "users", "alembic_version"} <= tables
        diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        assert diff == [], f"Models drifted from migrations: {diff}"
        uniques = {u["name"] for u in inspect(conn).get_unique_constraints("experiment_runs")}
        assert "uq_run_external_id" in uniques
    eng.dispose()
    upgrade_to_head(url)  # idempotent


def test_sqlite_pragmas(ctx: Ctx, settings):
    from app.database.session import get_engine

    with get_engine().connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"
        assert conn.exec_driver_sql("PRAGMA busy_timeout").scalar() == 5000
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def test_backup_and_restore(ctx: Ctx, settings, monkeypatch):
    from app import cli
    from app.core import config

    ctx.client.post("/api/v1/projects", json={"title": "Keep me"}, headers=ctx.rw)
    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    dest = settings.data_dir / "b.db"
    cli.backup_to(dest)  # online, while the app holds connections
    with sqlite3.connect(dest) as conn:
        assert conn.execute("select title from projects").fetchall() == [("Keep me",)]
    ctx.client.post("/api/v1/projects", json={"title": "After backup"}, headers=ctx.rw)
    from app.database.session import get_engine

    get_engine().dispose()
    cli.main(["restore", str(dest), "--yes"])
    with sqlite3.connect(settings.data_dir / "researchos.db") as conn:
        assert [r[0] for r in conn.execute("select title from projects")] == ["Keep me"]
    assert list(settings.data_dir.glob("researchos.db.pre-restore-*"))


def test_seed_demo(tmp_path: Path):
    from app.database.session import SessionLocal, init_engine
    from app.seed import seed_demo

    url = f"sqlite:///{tmp_path / 's.db'}"
    upgrade_to_head(url)
    init_engine(url)
    with SessionLocal() as db:
        assert "Inserted 3" in seed_demo(db)
        assert "not empty" in seed_demo(db)


@pytest.mark.anyio
@pytest.mark.parametrize("anyio_backend", ["asyncio"])
async def test_stdio_transport(ctx: Ctx, settings, anyio_backend):
    from mcp import Client, StdioServerParameters

    ctx.client.post("/api/v1/projects", json={"title": "Stdio Project"}, headers=ctx.rw)
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "app.mcp.stdio"],
        cwd=str(BACKEND),
        env={**os.environ, "RESEARCHOS_TOKEN": ctx.ro_token, "RESEARCHOS_DATA_DIR": str(settings.data_dir)},
    )
    async with Client(params, mode="legacy") as c:
        res = await c.call_tool("list_projects", {})
        assert not res.is_error and "Stdio Project" in res.content[0].text
        res = await c.call_tool("log_progress", {"project": "stdio-project", "summary": "x"})
        assert res.is_error and "insufficient_scope" in res.content[0].text


def test_backup_is_self_contained_and_restorable_from_readonly_dir(ctx: Ctx, settings, monkeypatch, tmp_path):
    from app import cli
    from app.core import config

    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    ctx.client.post("/api/v1/projects", json={"title": "RO"}, headers=ctx.rw)
    ro_dir = tmp_path / "ro"
    ro_dir.mkdir()
    dest = cli.backup_to(ro_dir / "b.db")
    with sqlite3.connect(dest) as conn:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    ro_dir.chmod(0o555)
    try:
        conn = sqlite3.connect(f"file:{dest}?mode=ro&immutable=1", uri=True)
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        conn.close()
    finally:
        ro_dir.chmod(0o755)
