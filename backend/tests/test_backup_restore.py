"""Offline CLI recovery must include the images referenced by the SQLite snapshot."""

from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database.migrate import upgrade_to_head
from app.models import Project

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
IMAGE = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c02"
    "0000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082"
)
IMAGE_NAME = hashlib.sha256(IMAGE).hexdigest()[:32] + ".png"


def cli(data_dir: Path, *args: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if not k.startswith("RESEARCHOS_")}
    env["RESEARCHOS_DATA_DIR"] = str(data_dir)
    return subprocess.run(
        [sys.executable, "-m", "app.cli", *args], cwd=BACKEND,
        env=env, text=True, capture_output=True, timeout=30,
    )


def make_database(data_dir: Path, title: str, *, image: bool = False) -> Path:
    path = data_dir / "researchos.db"
    url = f"sqlite:///{path}"
    upgrade_to_head(url)
    engine = create_engine(url)
    with Session(engine) as db:
        db.add(Project(slug="project", title=title,
                       notes=f"![image](/api/v1/uploads/{IMAGE_NAME})" if image else ""))
        db.commit()
    engine.dispose()
    if image:
        (data_dir / "uploads").mkdir()
        (data_dir / "uploads" / IMAGE_NAME).write_bytes(IMAGE)
    return path


def title(path: Path) -> str:
    with sqlite3.connect(path) as db:
        return db.execute("SELECT title FROM projects").fetchone()[0]


def test_cli_backup_restores_images_into_fresh_data_directory(tmp_path):
    source = tmp_path / "source data"
    make_database(source, "Saved note", image=True)
    backup = tmp_path / "backup files" / "snapshot.db"
    result = cli(source, "backup", str(backup))
    assert result.returncode == 0, result.stderr
    restored = tmp_path / "new empty volume"
    result = cli(restored, "restore", str(backup), "--yes")
    assert result.returncode == 0, result.stderr
    assert title(restored / "researchos.db") == "Saved note"
    assert (restored / "uploads" / IMAGE_NAME).read_bytes() == IMAGE
    assert (backup.parent / "uploads" / IMAGE_NAME).read_bytes() == IMAGE


@pytest.mark.parametrize("damage", ["missing", "corrupt"])
def test_restore_rejects_bad_attachment_before_overwriting_database(tmp_path, damage):
    source = tmp_path / "source"
    backup = make_database(source, "Saved note", image=True)
    image = source / "uploads" / IMAGE_NAME
    if damage == "missing":
        image.unlink()
    else:
        image.write_bytes(b"corrupt")
    target = tmp_path / "target"
    target_db = make_database(target, "Current note")
    before = target_db.read_bytes()
    result = cli(target, "restore", str(backup), "--yes")
    assert result.returncode != 0
    assert IMAGE_NAME in result.stderr
    assert target_db.read_bytes() == before
    assert not list(target.glob("*.pre-restore-*"))


def test_restore_merges_uploads_without_removing_existing_images(tmp_path):
    source = tmp_path / "backup"
    backup = make_database(source, "Saved note", image=True)
    target = tmp_path / "target"
    make_database(target, "Current note")
    (target / "uploads").mkdir()
    existing = target / "uploads" / "existing-image.png"
    existing.write_bytes(b"keep this image")
    result = cli(target, "restore", str(backup), "--yes")
    assert result.returncode == 0, result.stderr
    assert existing.read_bytes() == b"keep this image"
    assert (target / "uploads" / IMAGE_NAME).read_bytes() == IMAGE
    safety = next(target.glob("*.pre-restore-*"))
    assert title(safety) == "Current note"


def test_database_only_backup_without_images_remains_restorable(tmp_path):
    backup = make_database(tmp_path / "old backup", "Old database")
    target = tmp_path / "target"
    result = cli(target, "restore", str(backup), "--yes")
    assert result.returncode == 0, result.stderr
    assert title(target / "researchos.db") == "Old database"


def test_failed_backup_does_not_publish_incomplete_snapshot(tmp_path):
    source = tmp_path / "source"
    make_database(source, "Saved note", image=True)
    (source / "uploads" / IMAGE_NAME).unlink()
    backup = tmp_path / "backups" / "snapshot.db"
    result = cli(source, "backup", str(backup))
    assert result.returncode != 0
    assert IMAGE_NAME in result.stderr
    assert not backup.exists()


def test_backup_respects_private_umask(tmp_path):
    source = tmp_path / "source"
    make_database(source, "Saved note", image=True)
    backup = tmp_path / "backups" / "snapshot.db"
    previous = os.umask(0o077)
    try:
        result = cli(source, "backup", str(backup))
    finally:
        os.umask(previous)
    assert result.returncode == 0, result.stderr
    assert backup.stat().st_mode & 0o777 == 0o600
    assert (backup.parent / "uploads" / IMAGE_NAME).stat().st_mode & 0o777 == 0o600


def test_restore_replacement_failure_recovers_original_wal_database(tmp_path, monkeypatch):
    from app import cli as cli_module
    from app.core.config import Settings

    backup = make_database(tmp_path / "backup", "Saved note")
    target = tmp_path / "target"
    target_db = make_database(target, "Current note")
    monkeypatch.setattr(cli_module, "get_settings", lambda: Settings(data_dir=target))
    # Simulate a stopped WAL database whose last committed pages remain in -wal.
    connection = sqlite3.connect(target_db)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("UPDATE projects SET title='Latest committed note'")
    connection.commit()
    original_replace = os.replace
    failed = False

    def fail_first_replace(src, dest):
        nonlocal failed
        if Path(dest) == target_db and not failed:
            failed = True
            raise OSError("simulated replacement failure")
        return original_replace(src, dest)

    monkeypatch.setattr(os, "replace", fail_first_replace)
    try:
        with pytest.raises(SystemExit):
            cli_module.main(["restore", str(backup), "--yes"])
        assert title(target_db) == "Latest committed note"
    finally:
        connection.close()


@pytest.fixture
def fake_docker(tmp_path):
    """Exercise the real shell wrappers without contacting the production daemon."""
    binary_dir = tmp_path / "bin"
    binary_dir.mkdir()
    docker = binary_dir / "docker"
    docker.write_text(f"#!{sys.executable}\n" + '''
import os, pathlib, shutil, subprocess, sys
root = pathlib.Path(os.environ["FAKE_VOLUME"])
args = sys.argv[1:]
assert args.pop(0) == "compose", args
mode = os.environ.get("FAKE_FAILURE", "")
def volume(path):
    assert path.startswith("/data/"), path
    return root / path.removeprefix("/data/")
if args[:3] == ["exec", "-T", "researchos"]:
    command = args[3:]
    if command[:4] == ["python", "-m", "app.cli", "backup"]:
        dest = volume(command[4]); dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text("consistent database")
        for parent in (dest.parent, root):
            uploads = parent / "uploads"; uploads.mkdir(exist_ok=True)
            (uploads / "image.png").write_text("image bytes")
    elif command[:2] == ["test", "-d"]:
        sys.exit(0 if volume(command[2]).is_dir() else 1)
    elif command[0] == "rm":
        for path in command[1:]:
            if not path.startswith("-"):
                volume(path).unlink()
    else:
        raise AssertionError(command)
elif args[0] == "cp":
    source = volume(args[1].split(":", 1)[1]); dest = pathlib.Path(args[2])
    if mode == ("copy-images" if source.is_dir() else "copy-database"):
        sys.exit(24)
    if source.is_dir():
        shutil.copytree(source, dest, dirs_exist_ok=True)
    else:
        shutil.copyfile(source, dest)
elif args[0] in ("stop", "start"):
    (root / "state").write_text("stopped" if args[0] == "stop" else "running")
elif args[0] == "run":
    assert "-T" in args and "-v" not in args, args
    script = args[args.index("sh") + 2]
    script = script.replace("/data/", str(root) + "/")
    sys.exit(subprocess.run(["sh", "-c", script, "sh", args[-1]], stdin=sys.stdin.buffer).returncode)
else:
    raise AssertionError(args)
''')
    docker.chmod(0o755)
    python = binary_dir / "python"
    python.write_text(f"#!{sys.executable}\n" + '''
import os, pathlib, sys
assert sys.argv[1:4] == ["-m", "app.cli", "restore"], sys.argv
backup = pathlib.Path(sys.argv[4])
assert backup.read_text() == "database"
if not os.environ.get("FAKE_NO_IMAGES"):
    assert (backup.parent / "uploads" / "image.png").read_text() == "image"
(pathlib.Path(os.environ["FAKE_VOLUME"]) / "restore-attempt").write_text("validated archive")
sys.exit(25 if os.environ.get("FAKE_FAILURE") == "restore" else 0)
''')
    python.chmod(0o755)
    volume = tmp_path / "fake volume"
    volume.mkdir()
    (volume / "state").write_text("running")
    env = {**os.environ, "PATH": f"{binary_dir}:{os.environ['PATH']}", "FAKE_VOLUME": str(volume)}
    return volume, env


def test_docker_backup_removes_volume_snapshot_and_retains_30_host_copies(tmp_path, fake_docker):
    volume, env = fake_docker
    backups = tmp_path / "host backups with spaces"
    backups.mkdir()
    for i in range(31):
        path = backups / f"researchos-202601{i + 1:02}T000000Z.db"
        path.write_text(f"old {i}")
        os.utime(path, (1000 + i, 1000 + i))
    result = subprocess.run([str(ROOT / "scripts/backup.sh")], env={**env, "BACKUP_DIR": str(backups)},
                            text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert len(list(backups.glob("researchos-*.db"))) == 30
    assert not (backups / "researchos-20260101T000000Z.db").exists()
    assert not (backups / "researchos-20260102T000000Z.db").exists()
    assert not list((volume / "backups").glob("*.db"))
    assert (backups / "uploads" / "image.png").read_text() == "image bytes"
    assert (volume / "backups" / "uploads" / "image.png").exists()


@pytest.mark.parametrize("failure", ["copy-database", "copy-images"])
def test_docker_backup_copy_failure_keeps_recoverable_volume_copy(tmp_path, fake_docker, failure):
    volume, env = fake_docker
    backups = tmp_path / "host backups"
    result = subprocess.run([str(ROOT / "scripts/backup.sh")],
                            env={**env, "BACKUP_DIR": str(backups), "FAKE_FAILURE": failure},
                            text=True, capture_output=True, timeout=15)
    assert result.returncode != 0
    assert len(list((volume / "backups").glob("*.db"))) == 1
    assert not list(backups.glob("*.db"))


@pytest.mark.parametrize("failure", ["", "restore"])
@pytest.mark.parametrize("with_images", [False, True])
def test_docker_restore_streams_private_backup_and_restarts_on_failure(tmp_path, fake_docker, failure, with_images):
    volume, env = fake_docker
    backup_dir = tmp_path / "backup files"
    backup_dir.mkdir()
    (backup_dir / "snapshot.db").write_text("database")
    backup_dir.chmod(0o700)
    (backup_dir / "snapshot.db").chmod(0o600)
    if with_images:
        (backup_dir / "uploads").mkdir(mode=0o700)
        (backup_dir / "uploads" / "image.png").write_text("image")
        (backup_dir / "uploads" / "image.png").chmod(0o600)
    backup_arg = str(backup_dir / "snapshot.db") if failure else "backup files/snapshot.db"
    result = subprocess.run([str(ROOT / "scripts/restore.sh"), backup_arg],
                            cwd=tmp_path, env={**env, "FAKE_FAILURE": failure, "FAKE_NO_IMAGES": "" if with_images else "1"},
                            text=True, capture_output=True, timeout=15)
    assert (result.returncode == 0) == (not failure), result.stderr
    assert (volume / "state").read_text() == "running"
    assert (volume / "restore-attempt").read_text() == "validated archive"
    assert not list(volume.glob(".restore-input-*"))
    assert backup_dir.stat().st_mode & 0o777 == 0o700
    assert (backup_dir / "snapshot.db").stat().st_mode & 0o777 == 0o600
