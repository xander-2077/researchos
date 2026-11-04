"""Copy and verify content-addressed attachments belonging to a SQLite snapshot."""

from __future__ import annotations

import hashlib
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from app.services.uploads import URL_RE


def snapshot_uploads(database: Path) -> set[str]:
    """Read actual snapshot columns, including schemas older than the current models."""
    names: set[str] = set()
    conn = sqlite3.connect(database.resolve().as_uri() + "?mode=ro&immutable=1", uri=True)
    try:
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        for (table,) in tables:
            quoted = '"' + table.replace('"', '""') + '"'
            for row in conn.execute(f"SELECT * FROM {quoted}"):
                for value in row:
                    if isinstance(value, str):
                        names.update(URL_RE.findall(value))
    finally:
        conn.close()
    return names


def validate_upload(path: Path, name: str) -> None:
    if not path.is_file():
        raise ValueError(f"Missing attachment: {path}")
    with path.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()[:32]
    if digest != name.split(".", 1)[0]:
        raise ValueError(f"Corrupt attachment (content hash mismatch): {path}")


def copy_snapshot_uploads(database: Path, source: Path, target: Path) -> None:
    """Validate every reference before copying; merge without removing existing images.

    Missing/corrupt backup files are errors even if the target has its own copy: a
    successful restore must establish that the supplied backup is complete.
    """
    names = snapshot_uploads(database)
    for name in sorted(names):
        validate_upload(source / name, name)
        if (target / name).exists():
            validate_upload(target / name, name)
    if not names:
        return
    target.mkdir(parents=True, exist_ok=True)
    for name in sorted(names):
        dest = target / name
        if dest.exists():
            continue
        with tempfile.NamedTemporaryFile(dir=target, suffix=".part") as staged:
            shutil.copyfile(source / name, staged.name)
            validate_upload(Path(staged.name), name)
            # Link only if absent: never overwrite an existing image, even on a race.
            try:
                os.link(staged.name, dest)
            except FileExistsError:
                validate_upload(dest, name)
