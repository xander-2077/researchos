"""ResearchOS command line: ``python -m app.cli <command>``.

Commands:
  migrate                      Upgrade the database schema to the latest version
  db-version                   Show the current schema revision
  set-password [--username U]  Create the admin user or reset its password (prompts)
  create-token NAME [--write] [--days N]   Print a new API token (shown once)
  list-tokens / revoke-token ID
  backup [PATH]                Consistent online backup via the SQLite backup API
  restore PATH [--yes]         Restore a backup (stop the server first)
  export [PATH]                JSON export of all research data
  seed-demo                    Insert demo projects (only into an empty database)
"""

from __future__ import annotations

import argparse
import getpass
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.auth.actor import SYSTEM
from app.core.config import get_settings
from app.database.migrate import current_revision, upgrade_to_head
from app.database.session import SessionLocal, init_engine


def _db_path() -> Path:
    url = get_settings().sqlalchemy_url
    if not url.startswith("sqlite:///"):
        sys.exit("backup/restore only support SQLite")
    return Path(url.removeprefix("sqlite:///"))


def _setup() -> None:
    s = get_settings()
    init_engine(s.sqlalchemy_url)
    upgrade_to_head(s.sqlalchemy_url)


def cmd_migrate(_: argparse.Namespace) -> None:
    s = get_settings()
    before = current_revision(s.sqlalchemy_url) if _db_path().exists() else None
    upgrade_to_head(s.sqlalchemy_url)
    print(f"Database at revision {current_revision(s.sqlalchemy_url)} (was {before})")


def cmd_db_version(_: argparse.Namespace) -> None:
    print(current_revision(get_settings().sqlalchemy_url) or "(empty database)")


def cmd_set_password(a: argparse.Namespace) -> None:
    from app.services.auth import set_password

    _setup()
    pw = a.password or getpass.getpass("New admin password (min 10 chars): ")
    if not a.password and pw != getpass.getpass("Repeat: "):
        sys.exit("Passwords do not match")
    with SessionLocal() as db:
        set_password(db, a.username, pw)
    print(f"Password set for '{a.username}'.")


def cmd_create_token(a: argparse.Namespace) -> None:
    from app.schemas.entities import TokenCreate
    from app.services.auth import create_token

    _setup()
    with SessionLocal() as db:
        tok, plain = create_token(db, SYSTEM, TokenCreate(
            name=a.name, scopes=["read", "write"] if a.write else ["read"], expires_in_days=a.days or None,
        ))
    print(f"# token id={tok.id} name={tok.name} scopes={tok.scopes} expires={tok.expires_at}", file=sys.stderr)
    print(plain)


def cmd_list_tokens(_: argparse.Namespace) -> None:
    from app.services.auth import list_tokens

    _setup()
    with SessionLocal() as db:
        for t in list_tokens(db, SYSTEM):
            state = "revoked" if t.revoked_at else "active"
            print(f"{t.id}\t{t.name}\t{t.token_prefix}…\t{t.scopes}\t{state}\texpires={t.expires_at}\tlast_used={t.last_used_at}")


def cmd_revoke_token(a: argparse.Namespace) -> None:
    from app.services.auth import revoke_token

    _setup()
    with SessionLocal() as db:
        t = revoke_token(db, SYSTEM, a.id)
    print(f"Revoked token {t.id} ({t.name})")


def backup_to(dest: Path) -> Path:
    """Online, WAL-safe backup using sqlite3's backup API."""
    src_path = _db_path()
    if not src_path.exists():
        sys.exit(f"No database at {src_path}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(dest)
    try:
        with dst:
            src.backup(dst)
        # Make the backup a self-contained single file (no -wal/-shm needed to read it,
        # e.g. from a read-only mount).
        dst.execute("PRAGMA journal_mode=DELETE")
        ok = dst.execute("PRAGMA integrity_check").fetchone()[0]
        if ok != "ok":
            raise RuntimeError(f"integrity check failed: {ok}")
    finally:
        src.close()
        dst.close()
    return dest


def cmd_backup(a: argparse.Namespace) -> None:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = Path(a.path) if a.path else get_settings().data_dir / "backups" / f"researchos-{stamp}.db"
    if dest.is_dir():
        dest = dest / f"researchos-{stamp}.db"
    print(backup_to(dest))


def cmd_restore(a: argparse.Namespace) -> None:
    src = Path(a.path)
    if not src.exists():
        sys.exit(f"Backup not found: {src}")
    conn = sqlite3.connect(f"file:{src.resolve()}?mode=ro&immutable=1", uri=True)
    try:
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            sys.exit("Backup failed integrity check; refusing to restore")
    finally:
        conn.close()
    target = _db_path()
    if not a.yes:
        ans = input(f"Restore {src} over {target}? Stop the server first. [y/N] ")
        if ans.lower() != "y":
            sys.exit("Aborted")
    if target.exists():
        safety = target.with_name(target.name + f".pre-restore-{datetime.now(timezone.utc):%Y%m%dT%H%M%SZ}")
        backup_to(safety)
        print(f"Saved current database to {safety}")
    for suffix in ("-wal", "-shm"):
        Path(str(target) + suffix).unlink(missing_ok=True)
    shutil.copyfile(src, target)
    upgrade_to_head(get_settings().sqlalchemy_url)
    print(f"Restored {src} → {target}")


def cmd_export(a: argparse.Namespace) -> None:
    from app.services.export import export_all

    _setup()
    with SessionLocal() as db:
        data = export_all(db)
    text = json.dumps(data, indent=2, ensure_ascii=False)
    if a.path:
        Path(a.path).write_text(text)
        print(a.path)
    else:
        print(text)


def cmd_seed_demo(_: argparse.Namespace) -> None:
    from app.seed import seed_demo

    _setup()
    with SessionLocal() as db:
        print(seed_demo(db))


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="researchos", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    sub.add_parser("db-version").set_defaults(fn=cmd_db_version)
    sp = sub.add_parser("set-password")
    sp.add_argument("--username", default=get_settings().admin_username)
    sp.add_argument("--password", help="non-interactive (avoid: ends up in shell history)")
    sp.set_defaults(fn=cmd_set_password)
    sp = sub.add_parser("create-token")
    sp.add_argument("name")
    sp.add_argument("--write", action="store_true", help="read/write (default read-only)")
    sp.add_argument("--days", type=int, default=90, help="expiry in days (0 = never)")
    sp.set_defaults(fn=cmd_create_token)
    sub.add_parser("list-tokens").set_defaults(fn=cmd_list_tokens)
    sp = sub.add_parser("revoke-token")
    sp.add_argument("id", type=int)
    sp.set_defaults(fn=cmd_revoke_token)
    sp = sub.add_parser("backup")
    sp.add_argument("path", nargs="?")
    sp.set_defaults(fn=cmd_backup)
    sp = sub.add_parser("restore")
    sp.add_argument("path")
    sp.add_argument("--yes", action="store_true")
    sp.set_defaults(fn=cmd_restore)
    sp = sub.add_parser("export")
    sp.add_argument("path", nargs="?")
    sp.set_defaults(fn=cmd_export)
    sub.add_parser("seed-demo").set_defaults(fn=cmd_seed_demo)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
