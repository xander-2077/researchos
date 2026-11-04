#!/usr/bin/env bash
# Consistent online backup of the ResearchOS SQLite database (SQLite backup API; safe in WAL mode
# while the server is running). Writes ./backups/researchos-<UTC timestamp>.db on the host and
# mirrors uploaded images into ./backups/uploads/.
#
#   scripts/backup.sh                # Docker Compose deployment (default)
#   scripts/backup.sh --local        # bare-metal/dev (uses backend/.venv and RESEARCHOS_DATA_DIR)
set -euo pipefail
# Resolve BACKUP_DIR against the caller's directory, then work from the repo root.
OUT_DIR="$(realpath -m "${BACKUP_DIR:-$(dirname "$0")/../backups}")"
cd "$(dirname "$0")/.."
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="researchos-$STAMP.db"

if [[ "${1:-}" == "--local" ]]; then
  (cd backend && .venv/bin/python -m app.cli backup "$OUT_DIR/$NAME")
else
  docker compose exec -T researchos python -m app.cli backup "/data/backups/$NAME" >/dev/null
  STAGE="$(mktemp -d "$OUT_DIR/.backup-XXXXXX")"
  trap 'rm -rf -- "$STAGE"' EXIT
  docker compose cp "researchos:/data/backups/$NAME" "$STAGE/$NAME"
  # Copy the CLI-validated attachments before publishing the host snapshot.
  mkdir -p "$OUT_DIR/uploads"
  docker compose cp "researchos:/data/backups/uploads/." "$OUT_DIR/uploads/"
  mv -- "$STAGE/$NAME" "$OUT_DIR/$NAME"
  # Only remove this temporary database once all host copies succeeded. The
  # shared image archive may be used by older backups and must remain intact.
  docker compose exec -T researchos rm -f -- "/data/backups/$NAME"
fi
echo "Backup written to $OUT_DIR/$NAME"
# Keep the newest 30 local backups
find "$OUT_DIR" -maxdepth 1 -type f -name 'researchos-*.db' -printf '%T@ %p\0' \
  | sort -z -nr | tail -z -n +31 | cut -z -d ' ' -f 2- | xargs -0 -r rm --
