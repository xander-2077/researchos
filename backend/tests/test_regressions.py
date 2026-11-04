"""Regression tests for the security/correctness review findings (P1/P2)."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import cli
from app.auth.actor import SYSTEM, Actor
from app.core.errors import Conflict
from app.database.migrate import alembic_config, upgrade_to_head
from app.models import Project
from app.schemas.entities import ProjectCreate, ProjectUpdate
from tests.conftest import ADMIN_PW, Ctx
from tests.test_api import d, mkproject

NEW_PW = "brand-new-password-1"
TOKEN_BODY = {"name": "persist", "scopes": ["read", "write"]}


# ===================================================================== P1: sessions survive password change
def test_password_change_invalidates_replayed_sessions(ctx: Ctx):
    app = ctx.client.app
    # An attacker copied the cookie + CSRF token before the password change.
    stolen = TestClient(app)
    stolen.cookies.update(ctx.client.cookies)
    assert stolen.post("/api/v1/tokens", json=TOKEN_BODY, headers=ctx.csrf).status_code == 201  # works now

    r = ctx.client.post("/api/v1/auth/password", json={"current_password": ADMIN_PW, "new_password": NEW_PW}, headers=ctx.csrf)
    assert r.status_code == 200
    fresh = {"X-CSRF-Token": r.json()["csrf_token"]}

    # replay of the old credentials is rejected everywhere
    assert stolen.post("/api/v1/tokens", json=TOKEN_BODY, headers=ctx.csrf).status_code == 401
    assert stolen.get("/api/v1/projects").status_code == 401
    assert stolen.get("/api/v1/auth/me").json()["authenticated"] is False
    # the session that changed the password stays logged in, with the rotated CSRF token
    assert ctx.client.post("/api/v1/tokens", json=TOKEN_BODY, headers=fresh).status_code == 201
    assert ctx.client.post("/api/v1/tokens", json=TOKEN_BODY, headers=ctx.csrf).status_code == 403  # old CSRF token
    # login: old password gone, new one works
    other = TestClient(app)
    assert other.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PW}).status_code == 401
    assert other.post("/api/v1/auth/login", json={"username": "admin", "password": NEW_PW}).status_code == 200


def test_cli_password_reset_invalidates_sessions(ctx: Ctx):
    from app.database.session import SessionLocal
    from app.services.auth import set_password

    assert ctx.client.get("/api/v1/projects").status_code == 200
    with SessionLocal() as db:
        set_password(db, "admin", "reset-from-the-cli-1")
    assert ctx.client.get("/api/v1/projects").status_code == 401


# ===================================================================== P1: verified evidence is immutable for agents
def _verified_run(ctx: Ctx):
    p = mkproject(ctx, "Verified evidence")
    e = ctx.client.post("/api/v1/experiments", json={"project_id": p["id"], "name": "Baseline", "group_name": "G", "type": "baseline",
                                                    "hypothesis": "h"}, headers=ctx.rw).json()
    run = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={
        "external_run_id": "run-1", "seed": 1, "git_commit": "abc", "git_branch": "main", "environment": "sim",
        "artifact_links": ["https://wandb.example/run1"], "metrics": {"sr": 0.5}, "config": {"lr": 1},
        "started_at": "2026-01-01T00:00:00Z", "finished_at": "2026-01-01T01:00:00Z"}, headers=ctx.rw).json()
    assert ctx.client.patch(f"/api/v1/runs/{run['id']}", json={"verification_status": "verified"}, headers=ctx.csrf).status_code == 200
    assert ctx.client.patch(f"/api/v1/experiments/{e['id']}", json={"status": "verified"}, headers=ctx.csrf).status_code == 200
    return e, run


@pytest.mark.parametrize("body", [
    {"seed": 42},
    {"artifact_links": ["https://evil.example/replaced"]},
    {"environment": "other-env"},
    {"git_branch": "feature"},
    {"git_commit": "deadbeef"},
    {"config": {"lr": 99}},
    {"metrics": {"sr": 0.99}},
    {"conclusion": "rewritten"},
    {"status": "failed"},
    {"started_at": "2026-02-02T00:00:00Z"},
    {"finished_at": "2026-02-02T01:00:00Z"},
])
def test_agent_cannot_alter_any_field_of_verified_run(ctx: Ctx, body: dict):
    e, run = _verified_run(ctx)
    r = ctx.client.patch(f"/api/v1/runs/{run['id']}", json=body, headers=ctx.rw)
    assert r.status_code == 409 and r.json()["error"]["code"] == "verified_protected", r.text
    # same through the idempotent upsert path used by MCP
    r = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": "run-1", **body}, headers=ctx.rw)
    assert r.status_code == 409
    after = ctx.client.get(f"/api/v1/experiments/{e['id']}/runs", headers=ctx.ro).json()[0]
    assert after["verification_status"] == "verified"
    assert (after["seed"], after["git_commit"], after["environment"], after["artifact_links"], after["config_json"]) == \
           (1, "abc", "sim", [{"label": "", "url": "https://wandb.example/run1"}], {"lr": 1})


@pytest.mark.parametrize("body", [{"name": "Renamed"}, {"group_name": "Other"}, {"type": "ablation"},
                                  {"description": "changed"}, {"hypothesis": "new"}, {"conclusion": "x"}])
def test_agent_cannot_alter_any_field_of_verified_experiment(ctx: Ctx, body: dict):
    e, _ = _verified_run(ctx)
    r = ctx.client.patch(f"/api/v1/experiments/{e['id']}", json=body, headers=ctx.rw)
    assert r.status_code == 409 and r.json()["error"]["code"] == "verified_protected", r.text
    assert ctx.client.get(f"/api/v1/experiments/{e['id']}", headers=ctx.ro).json()["status"] == "verified"


def test_verified_run_resubmission_is_idempotent_and_confirm_downgrades(ctx: Ctx):
    e, run = _verified_run(ctx)
    # exact same data again (agent retry) is a no-op, not an error, and stays verified
    r = ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": "run-1", "seed": 1, "metrics": {"sr": 0.5}}, headers=ctx.rw)
    assert r.status_code == 201 and r.json()["verification_status"] == "verified"
    # explicit confirmation applies the change and sends it back to review
    r = ctx.client.patch(f"/api/v1/runs/{run['id']}", json={"seed": 42, "confirm_overwrite_verified": True}, headers=ctx.rw)
    assert r.status_code == 200 and r.json()["seed"] == 42 and r.json()["verification_status"] == "needs_review"
    # a human may edit freely
    e2, run2 = _verified_run(ctx)
    assert ctx.client.patch(f"/api/v1/runs/{run2['id']}", json={"seed": 7}, headers=ctx.csrf).status_code == 200


# ===================================================================== P1: restore must validate the backup
def _make_db(settings, titles: list[str]) -> Path:
    from app.database.session import SessionLocal, init_engine
    from app.services.projects import create_project

    url = settings.sqlalchemy_url
    upgrade_to_head(url)
    eng = init_engine(url)
    with SessionLocal() as db:
        for t in titles:
            create_project(db, SYSTEM, ProjectCreate(title=t))
    eng.dispose()
    return Path(url.removeprefix("sqlite:///"))


def _titles(path: Path) -> list[str]:
    with sqlite3.connect(path) as c:
        return [r[0] for r in c.execute("SELECT title FROM projects ORDER BY id")]


@pytest.fixture
def restore_env(settings, monkeypatch):
    from app.core import config

    monkeypatch.setattr(config, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    return settings


def test_restore_refuses_unrelated_sqlite_file(restore_env, tmp_path):
    db_path = _make_db(restore_env, ["A", "B", "C"])
    bad = tmp_path / "unrelated.db"
    with sqlite3.connect(bad) as c:
        c.execute("CREATE TABLE notes (id INTEGER PRIMARY KEY, txt TEXT)")
    with pytest.raises(SystemExit) as exc:
        cli.main(["restore", str(bad), "--yes"])
    assert "missing table" in str(exc.value) and "not touched" in str(exc.value)
    assert _titles(db_path) == ["A", "B", "C"]
    assert not list(db_path.parent.glob("*.pre-restore-*"))  # refused before any change


def test_restore_refuses_non_sqlite_and_newer_schema(restore_env, tmp_path):
    db_path = _make_db(restore_env, ["Keep"])
    junk = tmp_path / "junk.db"
    junk.write_bytes(b"this is not a database" * 100)
    with pytest.raises(SystemExit) as exc:
        cli.main(["restore", str(junk), "--yes"])
    assert "not touched" in str(exc.value)

    newer = tmp_path / "newer.db"
    cli.backup_to(newer)
    with sqlite3.connect(newer) as c:
        c.execute("UPDATE alembic_version SET version_num = '9999'")
    with pytest.raises(SystemExit) as exc:
        cli.main(["restore", str(newer), "--yes"])
    assert "unknown to this version" in str(exc.value)
    assert _titles(db_path) == ["Keep"]


def test_restore_preserves_database_if_staged_migration_fails(restore_env, tmp_path, monkeypatch):
    db_path = _make_db(restore_env, ["Current"])
    good = tmp_path / "good.db"
    cli.backup_to(good)  # same content; we only need a valid file
    with sqlite3.connect(good) as c:
        c.execute("UPDATE projects SET title = 'FromBackup'")
    before = db_path.read_bytes()
    monkeypatch.setattr(cli, "upgrade_to_head", lambda url: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(SystemExit) as exc:
        cli.main(["restore", str(good), "--yes"])
    assert "current database was not replaced" in str(exc.value)
    assert db_path.read_bytes() == before
    assert _titles(db_path) == ["Current"]
    assert not list(db_path.parent.glob(".restore-*"))
    assert not list(db_path.parent.glob("*.pre-restore-*"))


def test_restore_accepts_valid_backup(restore_env, tmp_path):
    db_path = _make_db(restore_env, ["Before"])
    good = tmp_path / "good.db"
    cli.backup_to(good)
    with sqlite3.connect(good) as c:
        c.execute("UPDATE projects SET title = 'Restored'")
    cli.main(["restore", str(good), "--yes"])
    assert _titles(db_path) == ["Restored"]
    assert list(db_path.parent.glob("*.pre-restore-*"))


# ===================================================================== P2: mixed units must not be averaged
def test_metrics_with_different_units_are_not_aggregated(ctx: Ctx):
    p = mkproject(ctx, "Units")
    e = ctx.client.post("/api/v1/experiments", json={"project_id": p["id"], "name": "Latency"}, headers=ctx.rw).json()
    for i, (v, u) in enumerate([(1, "s"), (1000, "ms")]):
        ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": f"r{i}", "metrics": {"latency": {"value": v, "unit": u}}}, headers=ctx.rw)
    m = ctx.client.get(f"/api/v1/experiments/{e['id']}", headers=ctx.ro).json()["metric_summary"]["latency"]
    assert m["mixed_units"] is True and m["mean"] is None and m["std"] is None
    assert m["units"] == ["ms", "s"] and m["n"] == 2
    # list endpoint (used by the registry table) behaves the same
    row = ctx.client.get("/api/v1/experiments", headers=ctx.ro).json()["items"][0]
    assert row["metric_summary"]["latency"]["mixed_units"] is True
    # a missing unit next to a real one is also ambiguous
    e2 = ctx.client.post("/api/v1/experiments", json={"project_id": p["id"], "name": "Loss"}, headers=ctx.rw).json()
    for i, u in enumerate(["", "nats"]):
        ctx.client.post(f"/api/v1/experiments/{e2['id']}/runs", json={"external_run_id": f"l{i}", "metrics": {"loss": {"value": 1, "unit": u}}}, headers=ctx.rw)
    assert ctx.client.get(f"/api/v1/experiments/{e2['id']}", headers=ctx.ro).json()["metric_summary"]["loss"]["mixed_units"] is True


def test_metrics_with_same_unit_still_aggregate(ctx: Ctx):
    p = mkproject(ctx, "Units2")
    e = ctx.client.post("/api/v1/experiments", json={"project_id": p["id"], "name": "Latency"}, headers=ctx.rw).json()
    for i, v in enumerate([1, 1000]):
        ctx.client.post(f"/api/v1/experiments/{e['id']}/runs", json={"external_run_id": f"r{i}", "metrics": {"latency": {"value": v, "unit": "ms"}}}, headers=ctx.rw)
    m = ctx.client.get(f"/api/v1/experiments/{e['id']}", headers=ctx.ro).json()["metric_summary"]["latency"]
    assert m["mixed_units"] is False and m["unit"] == "ms" and abs(m["mean"] - 500.5) < 1e-9 and abs(m["std"] - 706.4) < 0.1


# ===================================================================== P2: optimistic locking must be atomic
def _user_actor() -> Actor:
    return Actor(kind="user", name="admin", source="manual")


def test_stale_loaded_project_cannot_overwrite(ctx: Ctx):
    """Reader A holds version 1; writer B commits version 2; A's save (still claiming v1) must conflict."""
    from app.database.session import SessionLocal
    from app.services.projects import update_project

    p = mkproject(ctx, "CAS")
    a, b = SessionLocal(), SessionLocal()
    try:
        held = a.get(Project, p["id"])  # A read version 1; keep a reference (the identity map is weak)
        assert held.version == 1
        update_project(b, _user_actor(), p["id"], ProjectUpdate(notes="B wins", version=1))
        with pytest.raises(Conflict) as exc:
            update_project(a, _user_actor(), p["id"], ProjectUpdate(notes="A loses", version=1))
        assert exc.value.details == {"current_version": 2}
    finally:
        a.close()
        b.close()
    cur = ctx.client.get(f"/api/v1/projects/{p['id']}", headers=ctx.ro).json()
    assert cur["notes"] == "B wins" and cur["version"] == 2


def test_concurrent_saves_with_same_version_exactly_one_wins(ctx: Ctx):
    from app.database.session import SessionLocal
    from app.services.projects import update_project

    p = mkproject(ctx, "Race")
    n = 8
    barrier = threading.Barrier(n)
    results: list[tuple[str, int]] = []

    def worker(i: int) -> None:
        db = SessionLocal()
        try:
            held = db.get(Project, p["id"])  # everybody has read version 1 (held: identity map is weak)
            barrier.wait()
            update_project(db, _user_actor(), p["id"], ProjectUpdate(notes=f"note-{i}", version=1))
            results.append(("ok", i))
        except Conflict:
            results.append(("conflict", i))
        finally:
            del held
            db.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    [t.start() for t in threads]
    [t.join(20) for t in threads]
    assert len(results) == n
    winners = [i for s, i in results if s == "ok"]
    assert len(winners) == 1, results
    cur = ctx.client.get(f"/api/v1/projects/{p['id']}", headers=ctx.ro).json()
    assert cur["version"] == 2 and cur["notes"] == f"note-{winners[0]}"


def test_unversioned_concurrent_updates_do_not_lose_version_bumps(ctx: Ctx):
    from app.database.session import SessionLocal
    from app.services.projects import update_project

    p = mkproject(ctx, "Bumps")
    n = 6
    barrier = threading.Barrier(n)
    errors: list[Exception] = []

    def worker(i: int) -> None:
        db = SessionLocal()
        try:
            held = db.get(Project, p["id"])
            barrier.wait()
            update_project(db, _user_actor(), p["id"], ProjectUpdate(next_action=f"step {i}"))
        except Exception as e:  # noqa: BLE001
            errors.append(e)
        finally:
            db.close()

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    [t.start() for t in threads]
    [t.join(20) for t in threads]
    assert not errors, errors
    assert ctx.client.get(f"/api/v1/projects/{p['id']}", headers=ctx.ro).json()["version"] == 1 + n


# ===================================================================== P2: numeric slugs
def test_numeric_title_never_shadows_project_ids(ctx: Ctx):
    a = mkproject(ctx, "Alpha")
    assert a["id"] == 1
    b = mkproject(ctx, "1")
    assert b["id"] == 2 and b["slug"] == "project-1"
    assert ctx.client.get("/api/v1/projects/1", headers=ctx.ro).json()["id"] == 1
    assert ctx.client.get("/api/v1/projects/2", headers=ctx.ro).json()["id"] == 2
    assert ctx.client.get("/api/v1/projects/project-1", headers=ctx.ro).json()["id"] == 2
    # a second "1" gets a distinct, non-numeric slug
    assert mkproject(ctx, "1")["slug"] == "project-1-2"
    # all-digit slugs are rejected on create and rename
    r = ctx.client.post("/api/v1/projects", json={"title": "X", "slug": "7"}, headers=ctx.rw)
    assert r.status_code == 422
    r = ctx.client.patch(f"/api/v1/projects/{a['id']}", json={"slug": "42"}, headers=ctx.rw)
    assert r.status_code == 422
    assert ctx.client.get("/api/v1/projects/99", headers=ctx.ro).status_code == 404


def test_migration_renames_legacy_numeric_slugs(tmp_path):
    from alembic import command

    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    cfg = alembic_config(url)
    command.upgrade(cfg, "0001")
    with sqlite3.connect(tmp_path / "legacy.db") as c:
        for slug in ("1", "real-slug", "project-2"):
            c.execute(
                "INSERT INTO projects (slug,title,description,research_question,hypothesis,target_venue,stage,health_status,"
                "priority,repository_url,next_action,blocker_summary,notes,links,archived,version,created_at,updated_at) "
                "VALUES (?,?,'','','','','ideation','on_track','medium','','','','','[]',0,1,'2026-01-01','2026-01-01')",
                (slug, f"P {slug}"),
            )
    command.upgrade(cfg, "head")
    with sqlite3.connect(tmp_path / "legacy.db") as c:
        rows = dict(c.execute("SELECT id, slug FROM projects"))
        assert rows[1] == "project-1" and rows[2] == "real-slug" and rows[3] == "project-2"
        assert c.execute("SELECT session_version FROM users").fetchall() == []


# ===================================================================== rename-user (RESEARCHOS_ADMIN_USERNAME is first-start only)
def test_rename_user_changes_login_and_signs_out_sessions(ctx: Ctx):
    from app.database.session import SessionLocal
    from app.services.auth import rename_user

    assert ctx.client.get("/api/v1/projects").status_code == 200
    with SessionLocal() as db:
        rename_user(db, "admin", "researcher")
    assert ctx.client.get("/api/v1/projects").status_code == 401  # old session signed out
    other = TestClient(ctx.client.app)
    assert other.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PW}).status_code == 401
    assert other.post("/api/v1/auth/login", json={"username": "researcher", "password": ADMIN_PW}).status_code == 200
    with SessionLocal() as db, pytest.raises(Exception, match="not found"):
        rename_user(db, "admin", "x")
