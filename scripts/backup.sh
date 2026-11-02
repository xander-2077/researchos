#!/usr/bin/env bash
# Consistent online backup of the ResearchOS SQLite database (SQLite backup API; safe in WAL mode
# while the server is running). Writes ./backups/researchos-<UTC timestamp>.db on the host and
# mirrors uploaded images into ./backups/uploads/.
#
#   scripts/backup.sh                # Docker Compose deployment (default)
#   scripts/backup.sh --local        # bare-metal/dev (uses backend/.venv and RESEARCHOS_DATA_DIR)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="researchos-$STAMP.db"

if [[ "${1:-}" == "--local" ]]; then
  (cd backend && .venv/bin/python -m app.cli backup "$(realpath -m "../$OUT_DIR/$NAME")")
  UPLOADS="${RESEARCHOS_DATA_DIR:-backend/data}/uploads"
  if [[ -d "$UPLOADS" ]]; then mkdir -p "$OUT_DIR/uploads" && cp -rn "$UPLOADS/." "$OUT_DIR/uploads/"; fi
else
  docker compose exec -T researchos python -m app.cli backup "/data/backups/$NAME" >/dev/null
  docker compose cp "researchos:/data/backups/$NAME" "$OUT_DIR/$NAME"
  # Images attached to notes (content-addressed, so a plain mirror is enough)
  if docker compose exec -T researchos test -d /data/uploads; then
    mkdir -p "$OUT_DIR/uploads" && docker compose cp "researchos:/data/uploads/." "$OUT_DIR/uploads/"
  fi
fi
echo "Backup written to $OUT_DIR/$NAME"
# Keep the newest 30 local backups
ls -1t "$OUT_DIR"/researchos-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
